import assert from 'node:assert/strict'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import { after, before, describe, it } from 'node:test'
import type { ActivityRepository } from './activityRepository.ts'
import { createApp } from './app.ts'
import type { AuthAccount, AuthRepository } from './auth.ts'
import { AuthenticationService } from './auth.ts'
import { hashPassword } from './password.ts'

describe('Authentication API', () => {
  const allowedOrigin = 'http://127.0.0.1:5174'
  const account: AuthAccount = {
    id: 8,
    username: 'owner@example.com',
    pendingEmail: null,
    passwordHash: '',
    emailVerifiedAt: new Date().toISOString(),
    disabledAt: null,
  }
  const sessions = new Map<
    string,
    { sessionId: number; accountId: number; expiresAt: number }
  >()
  let baseUrl: string
  let server: ReturnType<ReturnType<typeof createApp>['listen']>

  const authRepository: AuthRepository = {
    async findAccountByUsername(username) {
      return username === account.username ? account : null
    },
    async findAccountById(id) {
      return id === account.id ? account : null
    },
    async createAccount() {
      return null
    },
    async storeEmailVerificationToken() {},
    async consumeEmailVerificationToken() {
      return false
    },
    async storePasswordResetToken() {},
    async resetPasswordWithToken() {
      return false
    },
    async changePassword() {
      return false
    },
    async deactivateAccount(accountId, currentPasswordHash) {
      if (
        accountId !== account.id ||
        account.disabledAt !== null ||
        account.passwordHash !== currentPasswordHash
      ) {
        return false
      }
      account.disabledAt = new Date().toISOString()
      account.pendingEmail = null
      for (const [hash, session] of sessions) {
        if (session.accountId === account.id) {
          sessions.delete(hash)
        }
      }
      return true
    },
    async requestEmailChange() {
      return 'stored'
    },
    async resendEmailChangeToken() {
      return false
    },
    async cancelEmailChange() {},
    async completeEmailChange() {
      return { status: 'invalid-token' }
    },
    async createSession(accountId, tokenHash) {
      sessions.set(tokenHash.toString('hex'), {
        sessionId: sessions.size + 1,
        accountId,
        expiresAt: Date.now() + 15 * 60 * 1000,
      })
    },
    async getAndTouchSession(tokenHash) {
      const session = sessions.get(tokenHash.toString('hex'))
      if (
        !session ||
        account.disabledAt !== null ||
        session.expiresAt <= Date.now()
      ) {
        return null
      }
      session.expiresAt = Date.now() + 15 * 60 * 1000
      return {
        sessionId: session.sessionId,
        id: account.id,
        username: account.username,
      }
    },
    async revokeSession(tokenHash) {
      sessions.delete(tokenHash.toString('hex'))
    },
  }

  const activityRepository: ActivityRepository = {
    async createActivity(_accountId) {
      return 1
    },
    async updateActivity(_accountId, _id) {
      return true
    },
    async deleteActivity() {
      return true
    },
    async listActivities(_accountId, page, pageSize) {
      return {
        activities: [],
        page,
        pageSize,
        totalRecords: 0,
        totalPages: 0,
      }
    },
    async getActivitiesByIds() {
      return []
    },
  }

  let service: AuthenticationService

  before(async () => {
    account.passwordHash = await hashPassword('SecurePassword123')
    service = new AuthenticationService(authRepository, {
      async sendVerificationEmail() {},
      async sendPasswordResetEmail() {},
      async sendEmailChangeVerificationEmail() {},
      async sendEmailChangeNotification() {},
    })
    server = createApp(activityRepository, {
      authService: service,
      allowedOrigins: new Set([allowedOrigin]),
      registrationEnabled: true,
    }).listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address() as AddressInfo
    baseUrl = `http://127.0.0.1:${address.port}`
  })

  after(async () => {
    server.close()
    await once(server, 'close')
  })

  it('rejects auth requests from untrusted or missing origins', async () => {
    for (const origin of [undefined, 'https://attacker.example']) {
      const headers = new Headers({ 'Content-Type': 'application/json' })
      if (origin) {
        headers.set('Origin', origin)
      }
      const response = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          email: account.username,
          password: 'SecurePassword123',
        }),
      })
      assert.equal(response.status, 403)
    }
    assert.equal(sessions.size, 0)
  })

  it('sets a protected sliding session cookie and revokes it on logout', async () => {
    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: allowedOrigin,
      },
      body: JSON.stringify({
        email: account.username,
        password: 'SecurePassword123',
      }),
    })

    assert.equal(login.status, 200)
    assert.deepEqual(await login.json(), {
      user: { id: account.id, username: account.username },
    })
    const setCookie = login.headers.get('set-cookie')
    assert.ok(setCookie)
    assert.match(setCookie, /HttpOnly/)
    assert.match(setCookie, /SameSite=Lax/)
    assert.match(setCookie, /Max-Age=900/)
    assert.doesNotMatch(setCookie, /Secure/)

    const cookie = setCookie.split(';')[0]
    const session = await fetch(`${baseUrl}/api/auth/session`, {
      headers: { Cookie: cookie },
    })
    assert.deepEqual(await session.json(), {
      authenticated: true,
      user: { id: account.id, username: account.username },
    })
    assert.match(session.headers.get('set-cookie') ?? '', /Max-Age=900/)

    const logout = await fetch(`${baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: { Cookie: cookie, Origin: allowedOrigin },
    })
    assert.equal(logout.status, 204)
    assert.match(logout.headers.get('set-cookie') ?? '', /Max-Age=0/)
    assert.equal(sessions.size, 0)
  })

  it('requires authentication and returns only safe account details', async () => {
    const unauthenticated = await fetch(`${baseUrl}/api/auth/account`)
    assert.equal(unauthenticated.status, 401)

    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: allowedOrigin,
      },
      body: JSON.stringify({
        email: account.username,
        password: 'SecurePassword123',
      }),
    })
    assert.equal(login.status, 200)

    const cookie = login.headers.get('set-cookie')?.split(';')[0]
    assert.ok(cookie)
    const response = await fetch(`${baseUrl}/api/auth/account`, {
      headers: { Cookie: cookie },
    })
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), {
      account: {
        email: account.username,
        emailVerified: true,
        pendingEmail: null,
      },
    })
  })

  it('requires authentication and a trusted origin to request an email change', async () => {
    const requestBody = JSON.stringify({
      email: ' NewAddress@Example.com ',
      currentPassword: 'SecurePassword123',
    })
    const unauthenticated = await fetch(`${baseUrl}/api/auth/email-change`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: allowedOrigin,
      },
      body: requestBody,
    })
    assert.equal(unauthenticated.status, 401)

    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: allowedOrigin,
      },
      body: JSON.stringify({
        email: account.username,
        password: 'SecurePassword123',
      }),
    })
    const cookie = login.headers.get('set-cookie')?.split(';')[0]
    assert.ok(cookie)

    const response = await fetch(`${baseUrl}/api/auth/email-change`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: allowedOrigin,
        Cookie: cookie,
      },
      body: requestBody,
    })
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), {
      message: 'A verification email was sent to the new address.',
      pendingEmail: 'newaddress@example.com',
    })
  })

  it('sets a restrictive referrer policy and rate-limits registration', async () => {
    const health = await fetch(`${baseUrl}/api/health`)
    assert.equal(health.headers.get('referrer-policy'), 'no-referrer')

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const response = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: allowedOrigin,
        },
        body: JSON.stringify({
          email: 'invalid',
          password: 'SecurePassword123',
          confirmPassword: 'SecurePassword123',
        }),
      })
      assert.equal(response.status, 400)
    }

    const limited = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: allowedOrigin,
      },
      body: JSON.stringify({
        email: 'invalid',
        password: 'SecurePassword123',
        confirmPassword: 'SecurePassword123',
      }),
    })
    assert.equal(limited.status, 429)
    assert.ok(Number(limited.headers.get('retry-after')) > 0)
  })

  it('keeps public registration disabled unless explicitly enabled', async () => {
    const disabledServer = createApp(activityRepository, {
      authService: service,
      allowedOrigins: new Set([allowedOrigin]),
    }).listen(0, '127.0.0.1')
    await once(disabledServer, 'listening')
    const address = disabledServer.address() as AddressInfo
    try {
      const response = await fetch(
        `http://127.0.0.1:${address.port}/api/auth/register`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: allowedOrigin,
          },
          body: JSON.stringify({
            email: 'new@example.com',
            password: 'SecurePassword123',
            confirmPassword: 'SecurePassword123',
          }),
        },
      )
      assert.equal(response.status, 403)
    } finally {
      disabledServer.close()
      await once(disabledServer, 'close')
    }
  })

  it('uses the same password-reset response for known and unknown emails', async () => {
    const responses = []
    for (const email of [account.username, 'missing@example.com']) {
      const response = await fetch(
        `${baseUrl}/api/auth/password-reset/request`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: allowedOrigin,
          },
          body: JSON.stringify({ email }),
        },
      )
      responses.push({
        status: response.status,
        body: await response.json(),
      })
    }

    assert.deepEqual(responses[0], responses[1])
    assert.equal(responses[0].status, 202)
  })

  it('requires an authenticated session for password changes', async () => {
    const response = await fetch(`${baseUrl}/api/auth/password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: allowedOrigin,
      },
      body: JSON.stringify({
        currentPassword: 'SecurePassword123',
        password: 'NewSecurePassword456',
        confirmPassword: 'NewSecurePassword456',
      }),
    })
    assert.equal(response.status, 401)
  })

  it('requires confirmation and the current password, then revokes all access when deactivated', async () => {
    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: allowedOrigin,
      },
      body: JSON.stringify({
        email: account.username,
        password: 'SecurePassword123',
      }),
    })
    const cookie = login.headers.get('set-cookie')?.split(';')[0]
    assert.ok(cookie)

    const unconfirmed = await fetch(`${baseUrl}/api/auth/account/deactivate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: allowedOrigin,
        Cookie: cookie,
      },
      body: JSON.stringify({
        currentPassword: 'SecurePassword123',
        confirmed: false,
      }),
    })
    assert.equal(unconfirmed.status, 400)
    assert.equal(account.disabledAt, null)

    const wrongPassword = await fetch(
      `${baseUrl}/api/auth/account/deactivate`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: allowedOrigin,
          Cookie: cookie,
        },
        body: JSON.stringify({
          currentPassword: 'IncorrectPassword123',
          confirmed: true,
        }),
      },
    )
    assert.equal(wrongPassword.status, 401)
    assert.equal(account.disabledAt, null)

    const deactivated = await fetch(`${baseUrl}/api/auth/account/deactivate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: allowedOrigin,
        Cookie: cookie,
      },
      body: JSON.stringify({
        currentPassword: 'SecurePassword123',
        confirmed: true,
      }),
    })
    assert.equal(deactivated.status, 200)
    assert.match(deactivated.headers.get('set-cookie') ?? '', /Max-Age=0/)
    assert.ok(account.disabledAt)

    const session = await fetch(`${baseUrl}/api/auth/session`, {
      headers: { Cookie: cookie },
    })
    assert.deepEqual(await session.json(), { authenticated: false })
    assert.equal(
      (
        await fetch(`${baseUrl}/api/activities`, {
          headers: { Cookie: cookie },
        })
      ).status,
      401,
    )
    assert.equal(
      (
        await fetch(`${baseUrl}/api/auth/login`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: allowedOrigin,
          },
          body: JSON.stringify({
            email: account.username,
            password: 'SecurePassword123',
          }),
        })
      ).status,
      401,
    )
  })
})
