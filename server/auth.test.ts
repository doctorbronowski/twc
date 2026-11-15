import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { describe, it } from 'node:test'
import {
  type AuthAccount,
  AuthError,
  type AuthenticatedSession,
  AuthenticationService,
  type AuthMailer,
  type AuthRepository,
} from './auth.ts'

interface StoredToken {
  accountId: number
  expiresAt: number
}

interface StoredSession {
  sessionId: number
  accountId: number
  expiresAt: number
}

interface StoredEmailChangeToken extends StoredToken {
  pendingEmail: string
}

function hashKey(value: Buffer): string {
  return value.toString('hex')
}

class MemoryAuthRepository implements AuthRepository {
  readonly accounts = new Map<number, AuthAccount>()
  readonly emailTokens = new Map<string, StoredToken>()
  readonly resetTokens = new Map<string, StoredToken>()
  readonly emailChangeTokens = new Map<string, StoredEmailChangeToken>()
  readonly sessions = new Map<string, StoredSession>()
  private nextAccountId = 1
  private nextSessionId = 1

  async findAccountByUsername(username: string): Promise<AuthAccount | null> {
    return (
      [...this.accounts.values()].find(
        (account) => account.username === username,
      ) ?? null
    )
  }

  async findAccountById(id: number): Promise<AuthAccount | null> {
    return this.accounts.get(id) ?? null
  }

  async createAccount(
    username: string,
    passwordHash: string,
  ): Promise<number | null> {
    if (await this.findAccountByUsername(username)) {
      return null
    }
    const id = this.nextAccountId++
    this.accounts.set(id, {
      id,
      username,
      pendingEmail: null,
      passwordHash,
      emailVerifiedAt: null,
      disabledAt: null,
    })
    return id
  }

  async storeEmailVerificationToken(
    accountId: number,
    tokenHash: Buffer,
    expiresAfterSeconds: number,
  ): Promise<void> {
    for (const [hash, token] of this.emailTokens) {
      if (token.accountId === accountId) {
        this.emailTokens.delete(hash)
      }
    }
    this.emailTokens.set(hashKey(tokenHash), {
      accountId,
      expiresAt: Date.now() + expiresAfterSeconds * 1000,
    })
  }

  async consumeEmailVerificationToken(tokenHash: Buffer): Promise<boolean> {
    const hash = hashKey(tokenHash)
    const token = this.emailTokens.get(hash)
    if (!token || token.expiresAt <= Date.now()) {
      return false
    }
    this.emailTokens.delete(hash)
    const account = this.accounts.get(token.accountId)
    if (!account) {
      return false
    }
    account.emailVerifiedAt = new Date().toISOString()
    return true
  }

  async storePasswordResetToken(
    accountId: number,
    tokenHash: Buffer,
    expiresAfterSeconds: number,
  ): Promise<void> {
    for (const [hash, token] of this.resetTokens) {
      if (token.accountId === accountId) {
        this.resetTokens.delete(hash)
      }
    }
    this.resetTokens.set(hashKey(tokenHash), {
      accountId,
      expiresAt: Date.now() + expiresAfterSeconds * 1000,
    })
  }

  async resetPasswordWithToken(
    tokenHash: Buffer,
    passwordHash: string,
  ): Promise<boolean> {
    const hash = hashKey(tokenHash)
    const token = this.resetTokens.get(hash)
    if (!token || token.expiresAt <= Date.now()) {
      return false
    }
    this.resetTokens.delete(hash)
    const account = this.accounts.get(token.accountId)
    if (!account) {
      return false
    }
    account.passwordHash = passwordHash
    for (const [sessionHash, session] of this.sessions) {
      if (session.accountId === account.id) {
        this.sessions.delete(sessionHash)
      }
    }
    return true
  }

  async changePassword(
    accountId: number,
    currentPasswordHash: string,
    passwordHash: string,
    currentSessionTokenHash: Buffer,
  ): Promise<boolean> {
    const account = this.accounts.get(accountId)
    if (!account || account.passwordHash !== currentPasswordHash) {
      return false
    }
    account.passwordHash = passwordHash
    const keepHash = hashKey(currentSessionTokenHash)
    for (const [sessionHash, session] of this.sessions) {
      if (session.accountId === accountId && sessionHash !== keepHash) {
        this.sessions.delete(sessionHash)
      }
    }
    return true
  }

  async deactivateAccount(
    accountId: number,
    currentPasswordHash: string,
  ): Promise<boolean> {
    const account = this.accounts.get(accountId)
    if (
      !account ||
      account.disabledAt !== null ||
      account.passwordHash !== currentPasswordHash
    ) {
      return false
    }

    account.disabledAt = new Date().toISOString()
    account.pendingEmail = null
    for (const tokens of [
      this.emailTokens,
      this.resetTokens,
      this.emailChangeTokens,
    ]) {
      for (const [hash, token] of tokens) {
        if (token.accountId === accountId) {
          tokens.delete(hash)
        }
      }
    }
    for (const [hash, session] of this.sessions) {
      if (session.accountId === accountId) {
        this.sessions.delete(hash)
      }
    }
    return true
  }

  async requestEmailChange(
    accountId: number,
    currentPasswordHash: string,
    pendingEmail: string,
    tokenHash: Buffer,
    expiresAfterSeconds: number,
  ) {
    const account = this.accounts.get(accountId)
    if (!account || account.passwordHash !== currentPasswordHash) {
      return 'account-changed' as const
    }
    if (
      [...this.accounts.values()].some(
        (candidate) =>
          candidate.id !== accountId &&
          (candidate.username === pendingEmail ||
            candidate.pendingEmail === pendingEmail),
      )
    ) {
      return 'email-in-use' as const
    }

    account.pendingEmail = pendingEmail
    for (const [hash, token] of this.emailChangeTokens) {
      if (token.accountId === accountId) {
        this.emailChangeTokens.delete(hash)
      }
    }
    this.emailChangeTokens.set(hashKey(tokenHash), {
      accountId,
      pendingEmail,
      expiresAt: Date.now() + expiresAfterSeconds * 1000,
    })
    return 'stored' as const
  }

  async resendEmailChangeToken(
    accountId: number,
    pendingEmail: string,
    tokenHash: Buffer,
    expiresAfterSeconds: number,
  ): Promise<boolean> {
    const account = this.accounts.get(accountId)
    if (!account || account.pendingEmail !== pendingEmail) {
      return false
    }
    for (const [hash, token] of this.emailChangeTokens) {
      if (token.accountId === accountId) {
        this.emailChangeTokens.delete(hash)
      }
    }
    this.emailChangeTokens.set(hashKey(tokenHash), {
      accountId,
      pendingEmail,
      expiresAt: Date.now() + expiresAfterSeconds * 1000,
    })
    return true
  }

  async cancelEmailChange(accountId: number): Promise<void> {
    const account = this.accounts.get(accountId)
    if (account) {
      account.pendingEmail = null
    }
    for (const [hash, token] of this.emailChangeTokens) {
      if (token.accountId === accountId) {
        this.emailChangeTokens.delete(hash)
      }
    }
  }

  async completeEmailChange(
    tokenHash: Buffer,
    currentSessionTokenHash: Buffer | null,
  ) {
    const tokenKey = hashKey(tokenHash)
    const token = this.emailChangeTokens.get(tokenKey)
    if (!token || token.expiresAt <= Date.now()) {
      return { status: 'invalid-token' } as const
    }
    const account = this.accounts.get(token.accountId)
    if (!account || account.pendingEmail !== token.pendingEmail) {
      return { status: 'invalid-token' } as const
    }
    if (
      [...this.accounts.values()].some(
        (candidate) =>
          candidate.id !== account.id &&
          (candidate.username === token.pendingEmail ||
            candidate.pendingEmail === token.pendingEmail),
      )
    ) {
      return { status: 'email-in-use' } as const
    }

    const oldEmail = account.username
    account.username = token.pendingEmail
    account.pendingEmail = null
    account.emailVerifiedAt = new Date().toISOString()
    this.emailChangeTokens.delete(tokenKey)

    const currentSessionKey = currentSessionTokenHash
      ? hashKey(currentSessionTokenHash)
      : null
    const currentSession = currentSessionKey
      ? this.sessions.get(currentSessionKey)
      : undefined
    const keepCurrentSession =
      currentSession?.accountId === account.id &&
      currentSession.expiresAt > Date.now()
    for (const [sessionHash, session] of this.sessions) {
      if (
        session.accountId === account.id &&
        (!keepCurrentSession || sessionHash !== currentSessionKey)
      ) {
        this.sessions.delete(sessionHash)
      }
    }

    return {
      status: 'completed',
      oldEmail,
      newEmail: token.pendingEmail,
    } as const
  }

  async createSession(accountId: number, tokenHash: Buffer): Promise<void> {
    this.sessions.set(hashKey(tokenHash), {
      sessionId: this.nextSessionId++,
      accountId,
      expiresAt: Date.now() + 15 * 60 * 1000,
    })
  }

  async getAndTouchSession(
    tokenHash: Buffer,
  ): Promise<AuthenticatedSession | null> {
    const hash = hashKey(tokenHash)
    const session = this.sessions.get(hash)
    const account = session ? this.accounts.get(session.accountId) : undefined
    if (
      !session ||
      !account ||
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
  }

  async revokeSession(tokenHash: Buffer): Promise<void> {
    this.sessions.delete(hashKey(tokenHash))
  }
}

class MemoryMailer implements AuthMailer {
  readonly verificationEmails: { username: string; token: string }[] = []
  readonly resetEmails: { username: string; token: string }[] = []
  readonly emailChangeVerificationEmails: { email: string; token: string }[] =
    []
  readonly emailChangeNotifications: { oldEmail: string; newEmail: string }[] =
    []
  failVerification = false
  failEmailChangeVerification = false

  async sendVerificationEmail(username: string, token: string): Promise<void> {
    if (this.failVerification) {
      throw new Error('Mail service unavailable.')
    }
    this.verificationEmails.push({ username, token })
  }

  async sendPasswordResetEmail(username: string, token: string): Promise<void> {
    this.resetEmails.push({ username, token })
  }

  async sendEmailChangeVerificationEmail(
    email: string,
    token: string,
  ): Promise<void> {
    if (this.failEmailChangeVerification) {
      throw new Error('Mail service unavailable.')
    }
    this.emailChangeVerificationEmails.push({ email, token })
  }

  async sendEmailChangeNotification(
    oldEmail: string,
    newEmail: string,
  ): Promise<void> {
    this.emailChangeNotifications.push({ oldEmail, newEmail })
  }
}

describe('authentication service', () => {
  it('creates an unverified account and consumes its verification token once', async () => {
    const repository = new MemoryAuthRepository()
    const mailer = new MemoryMailer()
    const service = new AuthenticationService(repository, mailer)

    await service.register('  Larry@HoffmanIts.com ', 'SecurePassword123')

    const account = await repository.findAccountByUsername(
      'larry@hoffmanits.com',
    )
    assert.ok(account)
    assert.equal(account.emailVerifiedAt, null)
    assert.notEqual(account.passwordHash, 'SecurePassword123')
    assert.equal(mailer.verificationEmails.length, 1)

    const mailedToken = mailer.verificationEmails[0].token
    const storedHash = createHash('sha256').update(mailedToken).digest('hex')
    assert.equal(repository.emailTokens.has(storedHash), true)
    assert.equal(await service.verifyEmail(mailedToken), true)
    assert.equal(await service.verifyEmail(mailedToken), false)
  })

  it('uses generic login errors and rotates the previous session on success', async () => {
    const repository = new MemoryAuthRepository()
    const service = new AuthenticationService(repository, new MemoryMailer())
    await service.register('person@example.com', 'SecurePassword123')

    await assert.rejects(
      service.login('person@example.com', 'SecurePassword123', null),
      (error: unknown) =>
        error instanceof AuthError && error.code === 'invalid-credentials',
    )
    const account = await repository.findAccountByUsername('person@example.com')
    assert.ok(account)
    account.emailVerifiedAt = new Date().toISOString()

    await assert.rejects(
      service.login('missing@example.com', 'SecurePassword123', null),
      (error: unknown) =>
        error instanceof AuthError && error.code === 'invalid-credentials',
    )

    const first = await service.login(
      'person@example.com',
      'SecurePassword123',
      null,
    )
    const second = await service.login(
      'person@example.com',
      'SecurePassword123',
      first.sessionToken,
    )
    assert.notEqual(first.sessionToken, second.sessionToken)
    assert.equal(await service.authenticate(first.sessionToken), null)
    assert.equal(
      (await service.authenticate(second.sessionToken))?.id,
      account.id,
    )
    assert.equal(repository.sessions.size, 1)
  })

  it('resets passwords once and revokes all existing sessions', async () => {
    const repository = new MemoryAuthRepository()
    const mailer = new MemoryMailer()
    const service = new AuthenticationService(repository, mailer)
    await service.register('person@example.com', 'SecurePassword123')
    const account = await repository.findAccountByUsername('person@example.com')
    assert.ok(account)
    account.emailVerifiedAt = new Date().toISOString()

    const session = await service.login(
      'person@example.com',
      'SecurePassword123',
      null,
    )
    await service.requestPasswordReset('person@example.com')
    const resetToken = mailer.resetEmails[0].token

    assert.equal(
      await service.resetPassword(resetToken, 'NewSecurePassword456'),
      true,
    )
    assert.equal(
      await service.resetPassword(resetToken, 'OtherPassword789'),
      false,
    )
    assert.equal(await service.authenticate(session.sessionToken), null)

    const newSession = await service.login(
      'person@example.com',
      'NewSecurePassword456',
      null,
    )
    assert.ok(newSession.sessionToken)
  })

  it('revokes other sessions after an authenticated password change', async () => {
    const repository = new MemoryAuthRepository()
    const service = new AuthenticationService(repository, new MemoryMailer())
    await service.register('person@example.com', 'SecurePassword123')
    const account = await repository.findAccountByUsername('person@example.com')
    assert.ok(account)
    account.emailVerifiedAt = new Date().toISOString()

    const currentSession = await service.login(
      'person@example.com',
      'SecurePassword123',
      null,
    )
    const otherSession = await service.login(
      'person@example.com',
      'SecurePassword123',
      null,
    )
    await service.changePassword(
      account.id,
      'SecurePassword123',
      'NewSecurePassword456',
      currentSession.sessionToken,
    )

    assert.ok(await service.authenticate(currentSession.sessionToken))
    assert.equal(await service.authenticate(otherSession.sessionToken), null)
    await assert.rejects(
      service.login('person@example.com', 'SecurePassword123', null),
      (error: unknown) =>
        error instanceof AuthError && error.code === 'invalid-credentials',
    )
  })

  it('deactivates an account only with its current password and preserves its email', async () => {
    const repository = new MemoryAuthRepository()
    const mailer = new MemoryMailer()
    const service = new AuthenticationService(repository, mailer)
    await service.register('person@example.com', 'SecurePassword123')
    const account = await repository.findAccountByUsername('person@example.com')
    assert.ok(account)
    account.emailVerifiedAt = new Date().toISOString()

    const currentSession = await service.login(
      'person@example.com',
      'SecurePassword123',
      null,
    )
    await service.requestEmailChange(
      account.id,
      'SecurePassword123',
      'pending@example.com',
    )
    await service.requestPasswordReset('person@example.com')
    const resetToken = mailer.resetEmails[0].token

    await assert.rejects(
      service.deactivateAccount(account.id, 'IncorrectPassword123'),
      (error: unknown) =>
        error instanceof AuthError && error.code === 'invalid-credentials',
    )
    assert.equal(account.disabledAt, null)

    await service.deactivateAccount(account.id, 'SecurePassword123')

    assert.ok(account.disabledAt)
    assert.equal(account.username, 'person@example.com')
    assert.equal(account.pendingEmail, null)
    assert.equal(repository.emailChangeTokens.size, 0)
    assert.equal(repository.sessions.size, 0)
    assert.equal(await service.authenticate(currentSession.sessionToken), null)
    assert.deepEqual(
      await service.resetPassword(resetToken, 'NewSecurePassword456'),
      false,
    )
    await assert.rejects(
      service.login('person@example.com', 'SecurePassword123', null),
      (error: unknown) =>
        error instanceof AuthError && error.code === 'invalid-credentials',
    )

    const resetEmailCount = mailer.resetEmails.length
    await service.requestPasswordReset('person@example.com')
    assert.equal(mailer.resetEmails.length, resetEmailCount)
  })

  it('keeps the old login until the new email is verified, then keeps only the verifying session', async () => {
    const repository = new MemoryAuthRepository()
    const mailer = new MemoryMailer()
    const service = new AuthenticationService(repository, mailer)
    await service.register('person@example.com', 'SecurePassword123')
    const account = await repository.findAccountByUsername('person@example.com')
    assert.ok(account)
    account.emailVerifiedAt = new Date().toISOString()

    const currentSession = await service.login(
      'person@example.com',
      'SecurePassword123',
      null,
    )
    const otherSession = await service.login(
      'person@example.com',
      'SecurePassword123',
      null,
    )
    const pendingEmail = await service.requestEmailChange(
      account.id,
      'SecurePassword123',
      '  NewAddress@Example.com ',
    )

    assert.equal(pendingEmail, 'newaddress@example.com')
    assert.equal(account.username, 'person@example.com')
    assert.equal(account.pendingEmail, 'newaddress@example.com')
    assert.equal(mailer.emailChangeVerificationEmails[0].email, pendingEmail)
    await assert.rejects(
      service.login('newaddress@example.com', 'SecurePassword123', null),
      (error: unknown) =>
        error instanceof AuthError && error.code === 'invalid-credentials',
    )
    assert.ok(
      await service.login('person@example.com', 'SecurePassword123', null),
    )

    const result = await service.verifyEmailChange(
      mailer.emailChangeVerificationEmails[0].token,
      currentSession.sessionToken,
    )
    assert.deepEqual(result, {
      status: 'completed',
      oldEmail: 'person@example.com',
      newEmail: pendingEmail,
    })
    assert.equal(
      await repository.findAccountByUsername('person@example.com'),
      null,
    )
    assert.equal(
      (await repository.findAccountByUsername(pendingEmail))?.id,
      account.id,
    )
    assert.equal(account.pendingEmail, null)
    assert.ok(await service.authenticate(currentSession.sessionToken))
    assert.equal(await service.authenticate(otherSession.sessionToken), null)
    assert.deepEqual(mailer.emailChangeNotifications, [
      { oldEmail: 'person@example.com', newEmail: pendingEmail },
    ])
    assert.deepEqual(
      await service.verifyEmailChange(
        mailer.emailChangeVerificationEmails[0].token,
        currentSession.sessionToken,
      ),
      { status: 'invalid-token' },
    )
  })

  it('rejects incorrect passwords and used addresses, and cancellation invalidates the token', async () => {
    const repository = new MemoryAuthRepository()
    const mailer = new MemoryMailer()
    const service = new AuthenticationService(repository, mailer)
    await service.register('person@example.com', 'SecurePassword123')
    await service.register('other@example.com', 'SecurePassword123')
    const account = await repository.findAccountByUsername('person@example.com')
    assert.ok(account)
    account.emailVerifiedAt = new Date().toISOString()

    await assert.rejects(
      service.requestEmailChange(
        account.id,
        'IncorrectPassword123',
        'new@example.com',
      ),
      (error: unknown) =>
        error instanceof AuthError && error.code === 'invalid-credentials',
    )
    await assert.rejects(
      service.requestEmailChange(
        account.id,
        'SecurePassword123',
        'other@example.com',
      ),
      (error: unknown) =>
        error instanceof AuthError && error.code === 'duplicate-email',
    )
    assert.equal(account.pendingEmail, null)

    await service.requestEmailChange(
      account.id,
      'SecurePassword123',
      'new@example.com',
    )
    const token = mailer.emailChangeVerificationEmails[0].token
    await service.cancelEmailChange(account.id)

    assert.equal(account.pendingEmail, null)
    assert.deepEqual(await service.verifyEmailChange(token, null), {
      status: 'invalid-token',
    })
  })

  it('invalidates prior and expired email-change verification tokens', async () => {
    const repository = new MemoryAuthRepository()
    const mailer = new MemoryMailer()
    const service = new AuthenticationService(repository, mailer)
    await service.register('person@example.com', 'SecurePassword123')
    const account = await repository.findAccountByUsername('person@example.com')
    assert.ok(account)

    await service.requestEmailChange(
      account.id,
      'SecurePassword123',
      'new@example.com',
    )
    const previousToken = mailer.emailChangeVerificationEmails[0].token
    await service.resendEmailChange(account.id)
    const currentToken = mailer.emailChangeVerificationEmails[1].token

    assert.deepEqual(await service.verifyEmailChange(previousToken, null), {
      status: 'invalid-token',
    })
    const currentTokenHash = createHash('sha256')
      .update(currentToken)
      .digest('hex')
    const storedToken = repository.emailChangeTokens.get(currentTokenHash)
    assert.ok(storedToken)
    storedToken.expiresAt = Date.now() - 1
    assert.deepEqual(await service.verifyEmailChange(currentToken, null), {
      status: 'invalid-token',
    })
  })

  it('reports verification email delivery failures without losing the account', async () => {
    const repository = new MemoryAuthRepository()
    const mailer = new MemoryMailer()
    mailer.failVerification = true
    const service = new AuthenticationService(repository, mailer)

    await assert.rejects(
      service.register('person@example.com', 'SecurePassword123'),
      (error: unknown) =>
        error instanceof AuthError && error.code === 'email-delivery',
    )
    assert.ok(await repository.findAccountByUsername('person@example.com'))
  })

  it('rejects malformed or expired session tokens without database access', async () => {
    const repository = new MemoryAuthRepository()
    const service = new AuthenticationService(repository, new MemoryMailer())
    assert.equal(await service.authenticate('not-a-token'), null)
    assert.equal(repository.sessions.size, 0)
  })
})
