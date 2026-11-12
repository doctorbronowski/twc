import assert from 'node:assert/strict'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import { after, before, describe, it } from 'node:test'
import type { ActivityInput } from './activityInput.ts'
import type { ActivityRepository } from './activityRepository.ts'
import { createApp } from './app.ts'

describe('Activity API', () => {
  let baseUrl: string
  let server: ReturnType<ReturnType<typeof createApp>['listen']>
  let savedActivity: ActivityInput | undefined
  let repositoryFailure = false

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

  it('creates an activity and normalizes phone and empty dates', async () => {
    const response = await fetch(`${baseUrl}/api/activities`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        activity_date: '2026-11-12',
        employer_zip: '00123',
        employer_phone: '(512) 555-0123',
        start_date: '',
        application_filed: true,
        hiring_result: 'hired',
      }),
    })

    assert.equal(response.status, 201)
    assert.deepEqual(await response.json(), { id: 42 })
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
