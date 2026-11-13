import assert from 'node:assert/strict'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import { after, before, describe, it } from 'node:test'
import type { ActivityInput } from './activityInput.ts'
import type {
  ActivityRecord,
  ActivityRepository,
} from './activityRepository.ts'
import { createApp } from './app.ts'

describe('Activity API', () => {
  let baseUrl: string
  let server: ReturnType<ReturnType<typeof createApp>['listen']>
  let savedActivity: ActivityInput | undefined
  let activities: ActivityRecord[] = []
  let repositoryFailure = false
  let listFailure = false
  let updateFailure = false

  const repository: ActivityRepository = {
    async createActivity(activity) {
      if (repositoryFailure) {
        throw new Error(
          'Database connection details must not reach the response.',
        )
      }
      savedActivity = activity
      return 42
    },
    async updateActivity(id, activity) {
      if (updateFailure) {
        throw new Error(
          'Database connection details must not reach the response.',
        )
      }
      if (id !== 42) {
        return false
      }
      savedActivity = activity
      return true
    },
    async listActivities() {
      if (listFailure) {
        throw new Error(
          'Database connection details must not reach the response.',
        )
      }
      return activities
    },
  }

  before(async () => {
    server = createApp(repository).listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address() as AddressInfo
    baseUrl = `http://127.0.0.1:${address.port}`
  })

  after(async () => {
    server.close()
    await once(server, 'close')
  })

  it('reports API health', async () => {
    const response = await fetch(`${baseUrl}/api/health`)

    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { status: 'ok' })
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
    assert.deepEqual(await response.json(), { activities })
    activities = []
  })

  it('returns an empty list when there are no activities', async () => {
    const response = await fetch(`${baseUrl}/api/activities`)

    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { activities: [] })
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
        employer_zip: '00123',
        employer_phone: '(512) 555-0123',
        start_date: '',
        application_filed: true,
        hiring_result: 'hired',
      }),
    })

    assert.equal(response.status, 201)
    assert.deepEqual(await response.json(), { id: 42 })
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
    assert.equal(savedActivity?.job_source_url, 'https://jobs.example.com/456')
    assert.equal(savedActivity?.job_title, 'Engineer')
    assert.equal(savedActivity?.employer_phone, '5125550199')
    assert.equal(savedActivity?.employer_zip, '00123')
    assert.equal(savedActivity?.hiring_result, 'not_hired')
    assert.equal(savedActivity?.start_date, null)
    assert.equal(savedActivity?.notes, null)
    assert.equal(savedActivity?.application_filed, true)
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
