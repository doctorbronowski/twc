import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'
import type { ActivityInput } from './activityInput.ts'
import type {
  ActivityPage,
  ActivityRecord,
  ActivityRepository,
} from './activityRepository.ts'
import { createApp } from './app.ts'
import type { AuthAccount, AuthRepository } from './auth.ts'
import { AuthenticationService, sessionCookieName } from './auth.ts'

const authenticatedAccount: AuthAccount = {
  id: 8,
  username: 'activity-owner@example.com',
  pendingEmail: null,
  passwordHash: 'unused-by-session-test',
  emailVerifiedAt: new Date().toISOString(),
  disabledAt: null,
}
const sessionToken = 'A'.repeat(43)
const sessionTokenHash = createHash('sha256').update(sessionToken).digest()
const allowedOrigin = 'http://127.0.0.1:5174'

function createActivityRecord(id: number): ActivityRecord {
  return {
    id,
    activity_date: null,
    job_source: null,
    job_source_url: null,
    job_title: null,
    employer_name: null,
    employer_address1: null,
    employer_address2: null,
    employer_city: null,
    employer_state: null,
    employer_zip: null,
    employer_phone: null,
    employer_contact: null,
    employer_email: null,
    hiring_result: null,
    start_date: null,
    application_filed: false,
    result_other: null,
    notes: null,
  }
}

describe('Activity API', () => {
  let baseUrl: string
  let staticDirectory: string
  let server: ReturnType<ReturnType<typeof createApp>['listen']>
  let savedActivity: ActivityInput | undefined
  let activities: ActivityRecord[] = []
  let repositoryFailure = false
  let listFailure = false
  let exportFailure = false
  let updateFailure = false
  let lastAccountId: number | undefined
  const activityOwners = new Map<number, number>()

  const authRepository: AuthRepository = {
    async findAccountByUsername(username) {
      return username === authenticatedAccount.username
        ? authenticatedAccount
        : null
    },
    async findAccountById(id) {
      return id === authenticatedAccount.id ? authenticatedAccount : null
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
    async deactivateAccount(accountId) {
      if (accountId !== authenticatedAccount.id) {
        return false
      }
      authenticatedAccount.disabledAt = new Date().toISOString()
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
    async createSession() {},
    async getAndTouchSession(tokenHash) {
      if (
        !tokenHash.equals(sessionTokenHash) ||
        authenticatedAccount.disabledAt !== null
      ) {
        return null
      }
      return {
        sessionId: 1,
        id: authenticatedAccount.id,
        username: authenticatedAccount.username,
      }
    },
    async revokeSession() {},
  }

  const repository: ActivityRepository = {
    async createActivity(accountId, activity) {
      if (repositoryFailure) {
        throw new Error(
          'Database connection details must not reach the response.',
        )
      }
      lastAccountId = accountId
      savedActivity = activity
      return 42
    },
    async updateActivity(accountId, id, activity) {
      if (updateFailure) {
        throw new Error(
          'Database connection details must not reach the response.',
        )
      }
      lastAccountId = accountId
      if (
        (activityOwners.get(id) ?? authenticatedAccount.id) !== accountId ||
        id !== 42
      ) {
        return false
      }
      savedActivity = activity
      return true
    },
    async listActivities(accountId, page, pageSize): Promise<ActivityPage> {
      if (listFailure) {
        throw new Error(
          'Database connection details must not reach the response.',
        )
      }
      lastAccountId = accountId
      const ownedActivities = activities.filter(
        (activity) =>
          (activityOwners.get(activity.id) ?? authenticatedAccount.id) ===
          accountId,
      )
      const totalRecords = ownedActivities.length
      const totalPages = Math.ceil(totalRecords / pageSize)
      const currentPage = Math.min(page, Math.max(totalPages, 1))
      const start = (currentPage - 1) * pageSize
      return {
        activities: ownedActivities.slice(start, start + pageSize),
        page: currentPage,
        pageSize,
        totalRecords,
        totalPages,
      }
    },
    async getActivitiesByIds(accountId, ids) {
      if (exportFailure) {
        throw new Error(
          'Database connection details must not reach the response.',
        )
      }
      lastAccountId = accountId
      return activities.filter(
        (activity) =>
          ids.includes(activity.id) &&
          (activityOwners.get(activity.id) ?? authenticatedAccount.id) ===
            accountId,
      )
    },
  }

  async function fetch(
    input: string | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const headers = new Headers(init?.headers)
    headers.set('Cookie', `${sessionCookieName}=${sessionToken}`)
    if (init?.method && init.method !== 'GET' && init.method !== 'HEAD') {
      headers.set('Origin', allowedOrigin)
    }
    return globalThis.fetch(input, { ...init, headers })
  }

  before(async () => {
    staticDirectory = await mkdtemp(path.join(tmpdir(), 'twc-static-'))
    await writeFile(
      path.join(staticDirectory, 'index.html'),
      '<!doctype html><title>TWC production test</title>',
    )
    const authService = new AuthenticationService(authRepository, {
      async sendVerificationEmail() {},
      async sendPasswordResetEmail() {},
      async sendEmailChangeVerificationEmail() {},
      async sendEmailChangeNotification() {},
    })
    server = createApp(repository, {
      authService,
      allowedOrigins: new Set([allowedOrigin]),
      staticDirectory,
    }).listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address() as AddressInfo
    baseUrl = `http://127.0.0.1:${address.port}`
  })

  after(async () => {
    server.close()
    await once(server, 'close')
    await rm(staticDirectory, { recursive: true, force: true })
  })

  it('reports API health', async () => {
    const response = await fetch(`${baseUrl}/api/health`)

    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { status: 'ok' })
  })

  it('requires authentication for every activity API operation', async () => {
    const response = await globalThis.fetch(`${baseUrl}/api/activities`)
    assert.equal(response.status, 401)
    assert.deepEqual(await response.json(), {
      error: 'Authentication is required.',
    })

    for (const [url, method] of [
      ['/api/activities/export', 'POST'],
      ['/api/activities', 'POST'],
      ['/api/activities/42', 'PUT'],
    ]) {
      const protectedResponse = await globalThis.fetch(`${baseUrl}${url}`, {
        method,
      })
      assert.equal(protectedResponse.status, 401)
    }
  })

  it('rejects cookie-authenticated writes without a trusted origin', async () => {
    const response = await globalThis.fetch(`${baseUrl}/api/activities`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `${sessionCookieName}=${sessionToken}`,
      },
      body: JSON.stringify({}),
    })

    assert.equal(response.status, 403)
    assert.deepEqual(await response.json(), {
      error: 'Request origin is not allowed.',
    })
  })

  it('serves the React app on direct page loads without treating API paths as pages', async () => {
    for (const path of ['/export/print', '/account']) {
      const pageResponse = await fetch(`${baseUrl}${path}`)
      assert.equal(pageResponse.status, 200)
      assert.match(await pageResponse.text(), /TWC production test/)
    }

    const unknownApiResponse = await fetch(`${baseUrl}/api/unknown`)
    assert.equal(unknownApiResponse.status, 404)
    assert.deepEqual(await unknownApiResponse.json(), {
      error: 'API route was not found.',
    })
  })

  it('lists activities with the complete activity data', async () => {
    activities = [
      {
        id: 42,
        activity_date: '2026-11-12',
        job_source: 'Online application',
        job_source_url: 'https://jobs.example.com/123',
        job_title: 'Developer',
        employer_name: 'Example Employer',
        employer_address1: '100 Main Street',
        employer_address2: null,
        employer_city: 'Austin',
        employer_state: 'TX',
        employer_zip: '00123',
        employer_phone: '5125550123',
        employer_contact: 'Jane Doe',
        employer_email: 'jane@example.com',
        hiring_result: 'not_hired',
        start_date: null,
        application_filed: true,
        result_other: null,
        notes: 'Follow up next week',
      },
    ]

    const response = await fetch(`${baseUrl}/api/activities`)

    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), {
      activities,
      page: 1,
      pageSize: 5,
      totalRecords: 1,
      totalPages: 1,
    })
    assert.equal(lastAccountId, authenticatedAccount.id)
    activities = []
  })

  it('filters activity rows and counts by the authenticated account', async () => {
    activities = [createActivityRecord(1), createActivityRecord(2)]
    activityOwners.set(2, authenticatedAccount.id + 1)

    const response = await fetch(`${baseUrl}/api/activities`)
    const body = (await response.json()) as ActivityPage

    assert.equal(response.status, 200)
    assert.deepEqual(
      body.activities.map((activity) => activity.id),
      [1],
    )
    assert.equal(body.totalRecords, 1)
    assert.equal(lastAccountId, authenticatedAccount.id)
    activities = []
    activityOwners.delete(2)
  })

  it('returns an empty list when there are no activities', async () => {
    const response = await fetch(`${baseUrl}/api/activities`)

    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), {
      activities: [],
      page: 1,
      pageSize: 5,
      totalRecords: 0,
      totalPages: 0,
    })
  })

  it('paginates through all records and clamps pages past the end', async () => {
    activities = Array.from({ length: 12 }, (_, index) =>
      createActivityRecord(index + 1),
    )

    const firstPageResponse = await fetch(`${baseUrl}/api/activities`)
    const firstPage = (await firstPageResponse.json()) as ActivityPage
    assert.deepEqual(
      firstPage.activities.map((activity: ActivityRecord) => activity.id),
      [1, 2, 3, 4, 5],
    )
    assert.equal(firstPage.totalRecords, 12)
    assert.equal(firstPage.totalPages, 3)

    const secondPageResponse = await fetch(`${baseUrl}/api/activities?page=2`)
    const secondPage = (await secondPageResponse.json()) as ActivityPage
    assert.deepEqual(
      secondPage.activities.map((activity: ActivityRecord) => activity.id),
      [6, 7, 8, 9, 10],
    )

    const lastPageResponse = await fetch(`${baseUrl}/api/activities?page=3`)
    const lastPage = (await lastPageResponse.json()) as ActivityPage
    assert.deepEqual(
      lastPage.activities.map((activity: ActivityRecord) => activity.id),
      [11, 12],
    )

    const beyondLastPageResponse = await fetch(
      `${baseUrl}/api/activities?page=99`,
    )
    const beyondLastPage = (await beyondLastPageResponse.json()) as ActivityPage
    assert.equal(beyondLastPage.page, 3)
    assert.deepEqual(
      beyondLastPage.activities.map((activity: ActivityRecord) => activity.id),
      [11, 12],
    )
    activities = []
  })

  it('uses the requested page size', async () => {
    activities = Array.from({ length: 12 }, (_, index) =>
      createActivityRecord(index + 1),
    )

    const firstPageResponse = await fetch(
      `${baseUrl}/api/activities?pageSize=10`,
    )
    const firstPage = (await firstPageResponse.json()) as ActivityPage
    assert.equal(firstPage.pageSize, 10)
    assert.equal(firstPage.totalPages, 2)
    assert.deepEqual(
      firstPage.activities.map((activity) => activity.id),
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    )

    const lastPageResponse = await fetch(
      `${baseUrl}/api/activities?page=2&pageSize=10`,
    )
    const lastPage = (await lastPageResponse.json()) as ActivityPage
    assert.deepEqual(
      lastPage.activities.map((activity) => activity.id),
      [11, 12],
    )
    activities = []
  })

  it('rejects invalid page values', async () => {
    for (const page of ['0', '-1', '1.5', 'abc', '9007199254740992']) {
      const response = await fetch(
        `${baseUrl}/api/activities?page=${encodeURIComponent(page)}`,
      )
      assert.equal(response.status, 400, `expected invalid page ${page}`)
      assert.deepEqual(await response.json(), {
        error: 'Page must be a positive integer.',
      })
    }
  })

  it('rejects unsupported page sizes', async () => {
    for (const pageSize of ['0', '7', '1.5', 'abc', '101']) {
      const response = await fetch(
        `${baseUrl}/api/activities?pageSize=${encodeURIComponent(pageSize)}`,
      )
      assert.equal(
        response.status,
        400,
        `expected invalid page size ${pageSize}`,
      )
      assert.deepEqual(await response.json(), {
        error: 'Page size must be one of 5, 10, 25, 50, or 100.',
      })
    }
  })

  it('returns the complete details for one selected activity', async () => {
    activities = [createActivityRecord(2), createActivityRecord(1)]
    const response = await fetch(`${baseUrl}/api/activities/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [1] }),
    })

    assert.equal(response.status, 200)
    const body = (await response.json()) as { activities: ActivityRecord[] }
    assert.deepEqual(
      body.activities.map((activity) => activity.id),
      [1],
    )
    assert.deepEqual(Object.keys(body.activities[0]).sort(), [
      'activity_date',
      'application_filed',
      'employer_address1',
      'employer_address2',
      'employer_city',
      'employer_contact',
      'employer_email',
      'employer_name',
      'employer_phone',
      'employer_state',
      'employer_zip',
      'hiring_result',
      'id',
      'job_source',
      'job_source_url',
      'job_title',
      'notes',
      'result_other',
      'start_date',
    ])
    assert.equal(lastAccountId, authenticatedAccount.id)
    activities = []
  })

  it('does not export an activity owned by another account', async () => {
    activities = [createActivityRecord(77)]
    activityOwners.set(77, authenticatedAccount.id + 1)
    const response = await fetch(`${baseUrl}/api/activities/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [77] }),
    })

    assert.equal(response.status, 404)
    assert.deepEqual(await response.json(), {
      error: 'One or more selected activities could not be found.',
    })
    assert.equal(lastAccountId, authenticatedAccount.id)
    activities = []
    activityOwners.delete(77)
  })

  it('returns up to 10 selected activities in repository order', async () => {
    activities = Array.from({ length: 10 }, (_, index) =>
      createActivityRecord(index + 1),
    )
    const response = await fetch(`${baseUrl}/api/activities/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [10, 9, 8, 7, 6, 5, 4, 3, 2, 1] }),
    })

    assert.equal(response.status, 200)
    const body = (await response.json()) as { activities: ActivityRecord[] }
    assert.equal(body.activities.length, 10)
    assert.deepEqual(
      body.activities.map((activity) => activity.id),
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    )
    activities = []
  })

  it('rejects invalid export selections', async () => {
    const invalidSelections: unknown[] = [
      {},
      { ids: [] },
      { ids: Array.from({ length: 11 }, (_, index) => index + 1) },
      { ids: [1, 1] },
      { ids: [0] },
      { ids: [-1] },
      { ids: [1.5] },
      { ids: ['1'] },
    ]

    for (const selection of invalidSelections) {
      const response = await fetch(`${baseUrl}/api/activities/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(selection),
      })
      assert.equal(response.status, 400)
      assert.deepEqual(await response.json(), {
        error:
          'Select between 1 and 10 activities using unique positive integer IDs.',
      })
    }
  })

  it('returns not found when a selected activity no longer exists', async () => {
    const response = await fetch(`${baseUrl}/api/activities/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [999] }),
    })

    assert.equal(response.status, 404)
    assert.deepEqual(await response.json(), {
      error: 'One or more selected activities could not be found.',
    })
  })

  it('returns a generic server error when selected activities fail to load', async () => {
    exportFailure = true
    const response = await fetch(`${baseUrl}/api/activities/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [1] }),
    })
    exportFailure = false

    assert.equal(response.status, 500)
    assert.deepEqual(await response.json(), {
      error: 'Selected activities could not be loaded. Please try again.',
    })
  })

  it('returns a generic server error if listing activities fails', async () => {
    listFailure = true
    const response = await fetch(`${baseUrl}/api/activities`)
    listFailure = false

    assert.equal(response.status, 500)
    assert.deepEqual(await response.json(), {
      error: 'Activities could not be loaded. Please try again.',
    })
  })

  it('creates an activity and normalizes phone and empty dates', async () => {
    const response = await fetch(`${baseUrl}/api/activities`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        activity_date: '2026-11-12',
        job_source: 'Online application',
        job_source_url: 'https://jobs.example.com/123',
        job_title: 'Developer',
        account_id: 999,
        employer_zip: '00123',
        employer_phone: '(512) 555-0123',
        start_date: '',
        application_filed: true,
        hiring_result: 'hired',
      }),
    })

    assert.equal(response.status, 201)
    assert.deepEqual(await response.json(), { id: 42 })
    assert.equal(lastAccountId, authenticatedAccount.id)
    assert.equal(savedActivity?.job_source, 'Online application')
    assert.equal(savedActivity?.job_source_url, 'https://jobs.example.com/123')
    assert.equal(savedActivity?.job_title, 'Developer')
    assert.equal(savedActivity?.employer_zip, '00123')
    assert.equal(savedActivity?.employer_phone, '5125550123')
    assert.equal(savedActivity?.activity_date, '2026-11-12')
    assert.equal(savedActivity?.start_date, null)
    assert.equal(savedActivity?.application_filed, true)
  })

  it('accepts empty optional fields and defaults the checkbox to false', async () => {
    const response = await fetch(`${baseUrl}/api/activities`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })

    assert.equal(response.status, 201)
    assert.equal(savedActivity?.activity_date, null)
    assert.equal(savedActivity?.hiring_result, null)
    assert.equal(savedActivity?.application_filed, false)
  })

  it('rejects malformed or out-of-range field values', async () => {
    const response = await fetch(`${baseUrl}/api/activities`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        activity_date: '2026-02-30',
        employer_phone: '512555012345',
      }),
    })

    assert.equal(response.status, 400)
    assert.deepEqual(await response.json(), {
      error: 'Activity data is invalid.',
    })
  })

  it('rejects a job source URL longer than the supported field size', async () => {
    const response = await fetch(`${baseUrl}/api/activities`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ job_source_url: 'x'.repeat(2049) }),
    })

    assert.equal(response.status, 400)
    assert.deepEqual(await response.json(), {
      error: 'Activity data is invalid.',
    })
  })

  it('updates all activity fields and normalizes blank values', async () => {
    const response = await fetch(`${baseUrl}/api/activities/42`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        activity_date: '2026-11-12',
        job_source: 'Company website',
        job_source_url: 'https://jobs.example.com/456',
        job_title: 'Engineer',
        employer_phone: '(512) 555-0199',
        employer_zip: '00123',
        hiring_result: 'not_hired',
        start_date: '',
        application_filed: true,
        notes: '',
      }),
    })

    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { id: 42 })
    assert.equal(lastAccountId, authenticatedAccount.id)
    assert.equal(savedActivity?.job_source_url, 'https://jobs.example.com/456')
    assert.equal(savedActivity?.job_title, 'Engineer')
    assert.equal(savedActivity?.employer_phone, '5125550199')
    assert.equal(savedActivity?.employer_zip, '00123')
    assert.equal(savedActivity?.hiring_result, 'not_hired')
    assert.equal(savedActivity?.start_date, null)
    assert.equal(savedActivity?.notes, null)
    assert.equal(savedActivity?.application_filed, true)
  })

  it('does not update an activity owned by another account', async () => {
    activityOwners.set(99, authenticatedAccount.id + 1)
    const response = await fetch(`${baseUrl}/api/activities/99`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })

    assert.equal(response.status, 404)
    assert.deepEqual(await response.json(), {
      error: 'Activity was not found.',
    })
    assert.equal(lastAccountId, authenticatedAccount.id)
    activityOwners.delete(99)
  })

  it('rejects invalid activity IDs and update data', async () => {
    const invalidIdResponse = await fetch(`${baseUrl}/api/activities/0`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    assert.equal(invalidIdResponse.status, 400)
    assert.deepEqual(await invalidIdResponse.json(), {
      error: 'Activity ID is invalid.',
    })

    const invalidDataResponse = await fetch(`${baseUrl}/api/activities/42`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ activity_date: '2026-02-30' }),
    })
    assert.equal(invalidDataResponse.status, 400)
    assert.deepEqual(await invalidDataResponse.json(), {
      error: 'Activity data is invalid.',
    })
  })

  it('returns not found when updating a missing activity', async () => {
    const response = await fetch(`${baseUrl}/api/activities/99`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })

    assert.equal(response.status, 404)
    assert.deepEqual(await response.json(), {
      error: 'Activity was not found.',
    })
  })

  it('returns a generic server error if updating an activity fails', async () => {
    updateFailure = true
    const response = await fetch(`${baseUrl}/api/activities/42`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    updateFailure = false

    assert.equal(response.status, 500)
    assert.deepEqual(await response.json(), {
      error: 'The activity could not be updated. Please try again.',
    })
  })

  it('returns a client error for invalid JSON', async () => {
    const response = await fetch(`${baseUrl}/api/activities`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{',
    })

    assert.equal(response.status, 400)
    assert.deepEqual(await response.json(), {
      error: 'Request body must be valid JSON.',
    })
  })

  it('returns a generic server error if persistence fails', async () => {
    repositoryFailure = true
    const response = await fetch(`${baseUrl}/api/activities`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    repositoryFailure = false

    assert.equal(response.status, 500)
    assert.deepEqual(await response.json(), {
      error: 'The activity could not be saved. Please try again.',
    })
  })
})
