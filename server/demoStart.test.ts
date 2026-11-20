import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import { after, before, beforeEach, describe, it } from 'node:test'
import type { ResultSetHeader, RowDataPacket } from 'mysql2'
import { createPool, type Pool } from 'mysql2/promise'
import { MySqlActivityRepository } from './activityRepository.ts'
import { createApp } from './app.ts'
import { AuthenticationService, demoSessionTag } from './auth.ts'
import { MySqlAuthRepository } from './authRepository.ts'
import {
  accountSchemaStatements,
  activitySchemaStatement,
} from './databaseSchema.ts'
import { getDemoClientIp, loadDemoClientIpConfig } from './demoClientIp.ts'
import { configureDemoStart } from './demoStart.ts'

const key = () => randomBytes(32).toString('base64url')

describe('demo client IP configuration', () => {
  it('requires explicit verified production configuration', () => {
    assert.throws(
      () => loadDemoClientIpConfig({ NODE_ENV: 'production' }),
      /VERIFIED/,
    )
    assert.throws(() => loadDemoClientIpConfig({}), /SOURCE/)
    assert.throws(
      () => loadDemoClientIpConfig({ DEMO_CLIENT_IP_SOURCE: 'forwarded' }),
      /PROXY/,
    )
  })

  it('ignores untrusted forwarded headers and rejects private production clients', () => {
    const config = loadDemoClientIpConfig({
      NODE_ENV: 'production',
      DEMO_CLIENT_IP_SOURCE: 'direct',
      DEMO_CLIENT_IP_VERIFIED: 'true',
    })
    assert.equal(
      getDemoClientIp('198.51.100.1', '203.0.113.1', config),
      '198.51.100.1',
    )
    assert.equal(getDemoClientIp('127.0.0.1', '203.0.113.1', config), null)
    assert.equal(getDemoClientIp('::ffff:10.1.2.3', undefined, config), null)
  })

  it('uses only the last forwarded address from the exact trusted proxy', () => {
    const config = loadDemoClientIpConfig({
      NODE_ENV: 'production',
      DEMO_CLIENT_IP_SOURCE: 'forwarded',
      DEMO_CLIENT_IP_VERIFIED: 'true',
      DEMO_TRUSTED_PROXY_IP: '127.0.0.1',
    })
    assert.equal(
      getDemoClientIp('::ffff:127.0.0.1', '203.0.113.99, 198.51.100.1', config),
      '198.51.100.1',
    )
    assert.equal(getDemoClientIp('198.51.100.2', '203.0.113.1', config), null)
    assert.equal(
      getDemoClientIp('127.0.0.1', '203.0.113.1, 10.0.0.1', config),
      null,
    )
    assert.equal(getDemoClientIp('127.0.0.1', 'invalid', config), null)
    assert.equal(getDemoClientIp('127.0.0.1', undefined, config), null)
  })
})

const socketPath = process.env.DEMO_API_TEST_SOCKET
const database = 'twc_demo_api_test'

describe('demo start API with MySQL', {
  skip: !socketPath && 'requires an isolated MySQL test socket',
}, () => {
  let pool: Pool
  let secondPool: Pool
  let templateId: number
  let baseUrls: string[]
  let servers: ReturnType<ReturnType<typeof createApp>['listen']>[]
  const origin = 'http://127.0.0.1:5174'

  before(async () => {
    assert.ok(socketPath)
    const poolOptions = {
      socketPath,
      user: 'root',
      database,
      connectionLimit: 8,
      dateStrings: true,
    }
    pool = createPool(poolOptions)
    secondPool = createPool(poolOptions)
    const [tables] = await pool.query('SHOW TABLES')
    assert.deepEqual(tables, [], 'test database must be empty')
    for (const statement of accountSchemaStatements) {
      await pool.query(statement)
    }
    await pool.query(activitySchemaStatement)
    await pool.query(
      'ALTER TABLE work_search_activities ADD COLUMN account_id INT UNSIGNED NOT NULL',
    )
    await pool.query(
      'ALTER TABLE work_search_activities ADD FOREIGN KEY (account_id) REFERENCES `account`(id)',
    )
    const [template] = await pool.execute<ResultSetHeader>(
      `INSERT INTO \`account\` (username, password_hash, email_verified_at)
        VALUES ('template@example.invalid', 'hash', CURRENT_TIMESTAMP(3))`,
    )
    templateId = template.insertId
    await pool.execute(
      'INSERT INTO work_search_activities (account_id, job_title) VALUES (?, ?)',
      [templateId, 'sample'],
    )

    const env = {
      DEMO_ENABLED: 'true',
      DEMO_TEMPLATE_EMAIL: 'template@example.invalid',
      DEMO_ACCOUNT_LIMIT: '10',
      DEMO_ACTIVITY_LIMIT: '20',
      DEMO_IP_HASH_SECRET: randomBytes(32).toString('base64url'),
      DEMO_CLIENT_IP_SOURCE: 'direct',
    }
    const mailer = {
      async sendVerificationEmail() {},
      async sendPasswordResetEmail() {},
      async sendEmailChangeVerificationEmail() {},
      async sendEmailChangeNotification() {},
    }
    servers = []
    baseUrls = []
    for (const [db, enabled] of [
      [pool, true],
      [secondPool, true],
      [pool, false],
    ] as const) {
      const app = createApp(new MySqlActivityRepository(db, 20), {
        authService: new AuthenticationService(
          new MySqlAuthRepository(db),
          mailer,
        ),
        allowedOrigins: new Set([origin]),
        demoStart: configureDemoStart(
          db,
          enabled ? env : { DEMO_ENABLED: 'false' },
        ),
      })
      const server = app.listen(0, '127.0.0.1')
      await once(server, 'listening')
      servers.push(server)
      baseUrls.push(
        `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
      )
    }
  })

  beforeEach(async () => {
    await pool.query('DELETE FROM demo_start_attempts')
    await pool.query(
      'DELETE FROM work_search_activities WHERE account_id <> ?',
      [templateId],
    )
    await pool.query('DELETE FROM `account` WHERE id <> ?', [templateId])
    await pool.query('DELETE FROM sessions WHERE account_id = ?', [templateId])
    await pool.query('UPDATE `account` SET disabled_at = NULL WHERE id = ?', [
      templateId,
    ])
  })

  after(async () => {
    for (const server of servers ?? []) {
      server.close()
      await once(server, 'close')
    }
    await pool?.end()
    await secondPool?.end()
  })

  function start(
    index: number,
    requestKey: string,
    extra: Record<string, string> = {},
  ) {
    return fetch(`${baseUrls[index]}/api/auth/demo`, {
      method: 'POST',
      headers: { Origin: origin, 'Idempotency-Key': requestKey, ...extra },
    })
  }

  it('fails closed for missing or invalid enabled configuration', () => {
    assert.equal(configureDemoStart(pool, {}), undefined)
    assert.equal(configureDemoStart(pool, { DEMO_ENABLED: 'false' }), undefined)
    assert.throws(
      () => configureDemoStart(pool, { DEMO_ENABLED: 'yes' }),
      /DEMO_ENABLED/,
    )
    assert.throws(
      () => configureDemoStart(pool, { DEMO_ENABLED: 'true' }),
      /DEMO_TEMPLATE_EMAIL/,
    )
    assert.throws(
      () =>
        configureDemoStart(pool, {
          DEMO_ENABLED: 'true',
          DEMO_TEMPLATE_EMAIL: 'template@example.invalid',
          DEMO_ACCOUNT_LIMIT: '10',
          DEMO_ACTIVITY_LIMIT: '20',
          DEMO_IP_HASH_SECRET: 'invalid',
        }),
      /DEMO_IP_HASH_SECRET/,
    )
  })

  it('exposes availability without exposing configuration details', async () => {
    for (const [index, enabled] of [
      [0, true],
      [2, false],
    ] as const) {
      const response = await fetch(`${baseUrls[index]}/api/auth/capabilities`)
      assert.equal(response.status, 200)
      assert.deepEqual(await response.json(), { demo: enabled })
    }
  })

  it('rejects disabled, untrusted, malformed and non-POST requests without creating accounts', async () => {
    assert.equal((await start(2, key())).status, 503)
    assert.equal(
      (await start(0, key(), { Origin: 'https://attacker.example' })).status,
      403,
    )
    assert.equal((await start(0, 'invalid')).status, 400)
    assert.equal((await fetch(`${baseUrls[0]}/api/auth/demo`)).status, 404)
    assert.equal((await fetch(`${baseUrls[0]}/?logmein`)).status, 404)
    const [rows] = await pool.query<(RowDataPacket & { count: number })[]>(
      "SELECT COUNT(*) AS count FROM `account` WHERE kind = 'demo'",
    )
    assert.equal(rows[0].count, 0)
  })

  it('sets a five-minute demo cookie and keeps the original template private', async () => {
    const response = await start(0, key())
    assert.equal(response.status, 201)
    const body: unknown = await response.json()
    assert.ok(typeof body === 'object' && body !== null && 'user' in body)
    assert.ok(
      typeof body.user === 'object' && body.user !== null && 'id' in body.user,
    )
    assert.notEqual(body.user.id, templateId)
    assert.ok(
      'demoSession' in body.user && typeof body.user.demoSession === 'string',
    )
    assert.match(body.user.demoSession, /^[0-9a-f]{64}$/)
    assert.deepEqual(body.user, {
      id: body.user.id,
      username: 'Demo',
      kind: 'demo',
      demoSession: body.user.demoSession,
      demoRemainingMs: 300_000,
    })
    assert.match(response.headers.get('set-cookie') ?? '', /Max-Age=300/)
    assert.match(response.headers.get('set-cookie') ?? '', /HttpOnly/)
    const cookie = response.headers.get('set-cookie')?.split(';')[0]
    assert.ok(cookie)
    const token = cookie.slice('twc_session='.length)
    assert.equal(body.user.demoSession, demoSessionTag(token))
    const session = await fetch(`${baseUrls[0]}/api/auth/session`, {
      headers: { Cookie: cookie },
    })
    const sessionBody: unknown = await session.json()
    assert.ok(
      typeof sessionBody === 'object' &&
        sessionBody !== null &&
        'user' in sessionBody,
    )
    assert.ok(typeof sessionBody.user === 'object' && sessionBody.user !== null)
    assert.ok(
      'demoSession' in sessionBody.user &&
        sessionBody.user.demoSession === body.user.demoSession,
    )
    assert.ok(
      'demoRemainingMs' in sessionBody.user &&
        typeof sessionBody.user.demoRemainingMs === 'number',
    )
    assert.ok(
      sessionBody.user.demoRemainingMs >= 0 &&
        sessionBody.user.demoRemainingMs <= 300_000,
    )
    const activities = await fetch(`${baseUrls[0]}/api/activities`, {
      headers: { Cookie: cookie, 'X-TWC-Demo-Session': body.user.demoSession },
    })
    assert.equal(activities.status, 200)
    const remaining = activities.headers.get('x-twc-demo-remaining-ms')
    assert.ok(
      remaining !== null &&
        Number(remaining) > 0 &&
        Number(remaining) <= 300_000,
    )
  })

  it('preserves existing regular and demo sessions when demo start is requested', async () => {
    const token = key()
    const hash = createHash('sha256').update(token).digest()
    await pool.execute(
      `INSERT INTO sessions (account_id, token_hash, expires_at)
        VALUES (?, ?, DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL 15 MINUTE))`,
      [templateId, hash],
    )
    const regular = await start(0, key(), { Cookie: `twc_session=${token}` })
    assert.equal(regular.status, 409)
    assert.equal(regular.headers.get('set-cookie'), null)
    assert.ok(await new MySqlAuthRepository(pool).getAndTouchSession(hash))

    const created = await start(0, key())
    const cookie = created.headers.get('set-cookie')?.split(';')[0]
    assert.ok(cookie)
    const demo = await start(1, key(), { Cookie: cookie })
    assert.equal(demo.status, 409)
    assert.equal(demo.headers.get('set-cookie'), null)
    const session = await fetch(`${baseUrls[0]}/api/auth/session`, {
      headers: { Cookie: cookie },
    })
    assert.equal(session.status, 200)
    assert.equal(
      ((await session.json()) as { authenticated: boolean }).authenticated,
      true,
    )
  })

  it('rejects concurrent duplicate requests across workers without orphaning accounts', async () => {
    const requestKey = key()
    const responses = await Promise.all([
      start(0, requestKey),
      start(1, requestKey),
    ])
    assert.deepEqual(
      responses.map((response) => response.status).sort(),
      [201, 409],
    )
    const [rows] = await pool.query<
      (RowDataPacket & { accounts: number; requests: number })[]
    >(
      `SELECT (SELECT COUNT(*) FROM \`account\` WHERE kind = 'demo') AS accounts,
        (SELECT COUNT(*) FROM demo_start_requests) AS requests`,
    )
    assert.equal(rows[0].accounts, 1)
    assert.equal(rows[0].requests, 1)
  })

  it('enforces ten attempts per IP across workers with Retry-After', async () => {
    for (let i = 0; i < 10; i++) {
      assert.equal((await start(i % 2, key())).status, 201)
    }
    const blocked = await start(0, key())
    assert.equal(blocked.status, 429)
    assert.ok(Number(blocked.headers.get('retry-after')) > 0)
  })

  it('rejects new demos when the global account limit is reached', async () => {
    for (let i = 0; i < 10; i++) {
      await pool.execute(
        "INSERT INTO `account` (username, password_hash, kind) VALUES (?, 'hash', 'demo')",
        [`limit-${i}@example.invalid`],
      )
    }
    const response = await start(0, key())
    assert.equal(response.status, 429)
    assert.equal(response.headers.get('set-cookie'), null)
  })

  it('allows the same request key to retry after an unsuccessful start', async () => {
    await pool.query(
      'UPDATE `account` SET disabled_at = CURRENT_TIMESTAMP(3) WHERE id = ?',
      [templateId],
    )
    const requestKey = key()
    const response = await start(0, requestKey)
    assert.equal(response.status, 503)
    assert.equal(response.headers.get('set-cookie'), null)
    await pool.query('UPDATE `account` SET disabled_at = NULL WHERE id = ?', [
      templateId,
    ])
    assert.equal((await start(1, requestKey)).status, 201)
  })
})
