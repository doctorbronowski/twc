import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { after, before, beforeEach, describe, it } from 'node:test'
import type { ResultSetHeader, RowDataPacket } from 'mysql2'
import { createPool, type Pool } from 'mysql2/promise'
import { MySqlAuthRepository } from './authRepository.ts'
import {
  accountSchemaStatements,
  activitySchemaStatement,
} from './databaseSchema.ts'
import {
  DemoCreationError,
  loadDemoCreationConfig,
  MySqlDemoCreator,
} from './demoCreation.ts'

const config = {
  DEMO_TEMPLATE_EMAIL: 'template@example.invalid',
  DEMO_ACCOUNT_LIMIT: '10',
  DEMO_ACTIVITY_LIMIT: '20',
}
const newKey = () => randomBytes(32).toString('base64url')

describe('demo creation configuration', () => {
  it('requires a valid template and positive integer limits', () => {
    assert.deepEqual(loadDemoCreationConfig(config), {
      templateEmail: config.DEMO_TEMPLATE_EMAIL,
      accountLimit: 10,
      activityLimit: 20,
    })
    for (const environment of [
      { ...config, DEMO_TEMPLATE_EMAIL: '' },
      { ...config, DEMO_ACCOUNT_LIMIT: '' },
      { ...config, DEMO_ACCOUNT_LIMIT: '0' },
      { ...config, DEMO_ACCOUNT_LIMIT: '1.5' },
      { ...config, DEMO_ACTIVITY_LIMIT: '' },
      { ...config, DEMO_ACTIVITY_LIMIT: '0' },
    ]) {
      assert.throws(() => loadDemoCreationConfig(environment))
    }
    assert.throws(() => loadDemoCreationConfig({}), /DEMO_TEMPLATE_EMAIL/)
  })
})

const socketPath = process.env.DEMO_CREATION_TEST_SOCKET
const database = 'twc_demo_creation_test'

describe('demo creation with MySQL', {
  skip: !socketPath && 'requires an isolated MySQL test socket',
}, () => {
  let pool: Pool
  let secondPool: Pool
  let creator: MySqlDemoCreator
  let templateId: number

  before(async () => {
    assert.ok(socketPath)
    const options = {
      socketPath,
      user: 'root',
      database,
      connectionLimit: 8,
      dateStrings: true,
    }
    pool = createPool(options)
    secondPool = createPool(options)
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
    creator = new MySqlDemoCreator(pool, loadDemoCreationConfig(config))
  })

  beforeEach(async () => {
    await pool.query('DELETE FROM work_search_activities')
    await pool.query('DELETE FROM `account`')
    const [result] = await pool.execute<ResultSetHeader>(
      `INSERT INTO \`account\` (username, password_hash, email_verified_at)
        VALUES (?, 'template-password-hash', CURRENT_TIMESTAMP(3))`,
      [config.DEMO_TEMPLATE_EMAIL],
    )
    templateId = result.insertId
  })

  after(async () => {
    await pool?.end()
    await secondPool?.end()
  })

  function isCreationError(code: DemoCreationError['code']) {
    return (error: unknown) =>
      error instanceof DemoCreationError && error.code === code
  }

  async function addTemplateActivity(title: string) {
    const [result] = await pool.execute<ResultSetHeader>(
      `INSERT INTO work_search_activities
        (account_id, activity_date, job_source, job_source_url, job_title,
         employer_name, employer_address1, employer_address2, employer_city,
         employer_state, employer_zip, employer_phone, employer_contact,
         employer_email, hiring_result, start_date, application_filed,
         result_other, notes)
        VALUES (?, '2026-01-02', 'Other', 'https://example.invalid/job', ?,
          'Example', 'First', 'Second', 'Austin', 'TX', '12345',
          '5551112222', 'Contact', 'contact@example.invalid', 'hired',
          '2026-02-03', 1, 'Result', 'Sample notes')`,
      [templateId, title],
    )
    return result.insertId
  }

  it('copies all activity fields into an isolated demo with a hashed five-minute session', async () => {
    const originalId = await addTemplateActivity('Sample')
    const result = await creator.createDemo(newKey())
    assert.deepEqual(result.user, {
      id: result.user.id,
      username: 'Demo',
      kind: 'demo',
    })
    assert.notEqual(result.user.id, templateId)
    assert.match(result.sessionToken, /^[A-Za-z0-9_-]{43}$/)
    const hash = createHash('sha256').update(result.sessionToken).digest()
    const [sessions] = await pool.execute<
      (RowDataPacket & {
        matches: number
        same_expiry: number
        remaining: number
        username: string
        password_hash: string
      })[]
    >(
      `SELECT s.token_hash = ? AS matches, s.expires_at = d.expires_at AS same_expiry,
        TIMESTAMPDIFF(SECOND, CURRENT_TIMESTAMP(3), s.expires_at) AS remaining,
        a.username, a.password_hash
        FROM sessions s JOIN demo_instances d ON d.account_id = s.account_id
        JOIN \`account\` a ON a.id = s.account_id WHERE s.account_id = ?`,
      [hash, result.user.id],
    )
    assert.equal(sessions[0].matches, 1)
    assert.equal(sessions[0].same_expiry, 1)
    assert.ok(sessions[0].remaining >= 298 && sessions[0].remaining <= 300)
    assert.match(sessions[0].username, /^demo-[a-f0-9]{48}@demo\.invalid$/)
    assert.equal(sessions[0].password_hash, '!demo-password-disabled')
    const auth = await new MySqlAuthRepository(pool).getAndTouchSession(hash)
    assert.equal(auth?.username, 'Demo')
    assert.equal(auth?.kind, 'demo')

    const [rows] = await pool.execute<
      (RowDataPacket & { id: number; account_id: number })[]
    >(
      `SELECT id, account_id, activity_date, job_source, job_source_url, job_title,
        employer_name, employer_address1, employer_address2, employer_city,
        employer_state, employer_zip, employer_phone, employer_contact,
        employer_email, hiring_result, start_date, application_filed,
        result_other, notes
        FROM work_search_activities WHERE account_id IN (?, ?) ORDER BY id`,
      [templateId, result.user.id],
    )
    assert.equal(rows.length, 2)
    assert.equal(rows[0].id, originalId)
    assert.notEqual(rows[1].id, originalId)
    assert.equal(rows[1].account_id, result.user.id)
    const { id: _sourceId, account_id: _sourceOwner, ...source } = rows[0]
    const { id: _copyId, account_id: _copyOwner, ...copy } = rows[1]
    assert.deepEqual(copy, source)
    await pool.execute(
      'UPDATE work_search_activities SET job_title = ? WHERE id = ?',
      ['Changed', rows[1].id],
    )
    const [original] = await pool.execute<
      (RowDataPacket & { job_title: string })[]
    >('SELECT job_title FROM work_search_activities WHERE id = ?', [originalId])
    assert.equal(original[0].job_title, 'Sample')
  })

  it('allows exactly the activity limit and rejects an oversized template without partial rows', async () => {
    for (let i = 0; i < 20; i++) {
      await addTemplateActivity(`Activity ${i}`)
    }
    const first = await creator.createDemo(newKey())
    const [copies] = await pool.execute<(RowDataPacket & { count: number })[]>(
      'SELECT COUNT(*) AS count FROM work_search_activities WHERE account_id = ?',
      [first.user.id],
    )
    assert.equal(copies[0].count, 20)
    await addTemplateActivity('Over the limit')
    await assert.rejects(
      creator.createDemo(newKey()),
      isCreationError('template-too-large'),
    )
    const [demos] = await pool.query<(RowDataPacket & { count: number })[]>(
      "SELECT COUNT(*) AS count FROM `account` WHERE kind = 'demo'",
    )
    assert.equal(demos[0].count, 1)
  })

  it('creates an empty demo when the template has no activities', async () => {
    const result = await creator.createDemo(newKey())
    const [rows] = await pool.execute<(RowDataPacket & { count: number })[]>(
      'SELECT COUNT(*) AS count FROM work_search_activities WHERE account_id = ?',
      [result.user.id],
    )
    assert.equal(rows[0].count, 0)
  })

  it('rejects missing, disabled, unverified, or demo templates', async () => {
    for (const change of [
      'DELETE FROM `account` WHERE id = ?',
      'UPDATE `account` SET disabled_at = CURRENT_TIMESTAMP(3) WHERE id = ?',
      'UPDATE `account` SET email_verified_at = NULL WHERE id = ?',
      "UPDATE `account` SET kind = 'demo' WHERE id = ?",
    ]) {
      await pool.execute(change, [templateId])
      await assert.rejects(
        creator.createDemo(newKey()),
        isCreationError('template-unavailable'),
      )
      await pool.query('DELETE FROM `account`')
      const [created] = await pool.execute<ResultSetHeader>(
        `INSERT INTO \`account\` (username, password_hash, email_verified_at)
          VALUES (?, 'hash', CURRENT_TIMESTAMP(3))`,
        [config.DEMO_TEMPLATE_EMAIL],
      )
      templateId = created.insertId
    }
  })

  it('enforces the global account cap across pools, including ended and unmarked demos', async () => {
    for (let i = 0; i < 3; i++) {
      const [account] = await pool.execute<ResultSetHeader>(
        `INSERT INTO \`account\` (username, password_hash, kind) VALUES (?, 'invalid', 'demo')`,
        [`existing-${i}@example.invalid`],
      )
      if (i !== 2) {
        await pool.execute(
          `INSERT INTO demo_instances (account_id, expires_at, ended_at)
            VALUES (?, DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 1 MINUTE),
              IF(? = 0, CURRENT_TIMESTAMP(3), NULL))`,
          [account.insertId, i],
        )
      }
    }
    const other = new MySqlDemoCreator(
      secondPool,
      loadDemoCreationConfig(config),
    )
    const results = await Promise.allSettled(
      Array.from({ length: 14 }, (_, i) =>
        (i % 2 ? creator : other).createDemo(newKey()),
      ),
    )
    assert.equal(
      results.filter((result) => result.status === 'fulfilled').length,
      7,
    )
    const failures = results.filter((result) => result.status === 'rejected')
    assert.equal(failures.length, 7)
    for (const failure of failures) {
      assert.ok(
        failure.status === 'rejected' &&
          isCreationError('account-limit')(failure.reason),
      )
    }
    const [counts] = await pool.query<(RowDataPacket & { count: number })[]>(
      "SELECT COUNT(*) AS count FROM `account` WHERE kind = 'demo'",
    )
    assert.equal(counts[0].count, 10)
  })

  it('creates only one demo for concurrent requests with the same idempotency key', async () => {
    const key = newKey()
    const other = new MySqlDemoCreator(
      secondPool,
      loadDemoCreationConfig(config),
    )
    const results = await Promise.allSettled([
      creator.createDemo(key),
      other.createDemo(key),
    ])
    const success = results.find((result) => result.status === 'fulfilled')
    const failure = results.find((result) => result.status === 'rejected')
    assert.ok(success && success.status === 'fulfilled')
    assert.ok(failure && failure.status === 'rejected')
    assert.ok(isCreationError('duplicate-request')(failure.reason))
    const [rows] = await pool.query<(RowDataPacket & { count: number })[]>(
      'SELECT COUNT(*) AS count FROM demo_start_requests',
    )
    assert.equal(rows[0].count, 1)
    await pool.execute('DELETE FROM `account` WHERE id = ?', [
      success.value.user.id,
    ])
    assert.ok((await creator.createDemo(key)).user.id)
  })

  it('rolls back the account and all copied data when insertion fails', async () => {
    await addTemplateActivity('Sample')
    const key = newKey()
    await pool.query(
      `CREATE TRIGGER demo_creation_fail BEFORE INSERT ON work_search_activities
        FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'copy failure'`,
    )
    try {
      await assert.rejects(creator.createDemo(key), /copy failure/)
      const [counts] = await pool.query<
        (RowDataPacket & {
          accounts: number
          instances: number
          sessions: number
          activities: number
        })[]
      >(
        `SELECT (SELECT COUNT(*) FROM \`account\` WHERE kind = 'demo') AS accounts,
          (SELECT COUNT(*) FROM demo_instances) AS instances,
          (SELECT COUNT(*) FROM sessions) AS sessions,
          (SELECT COUNT(*) FROM work_search_activities) AS activities`,
      )
      assert.deepEqual(
        { ...counts[0] },
        { accounts: 0, instances: 0, sessions: 0, activities: 1 },
      )
    } finally {
      await pool.query('DROP TRIGGER demo_creation_fail')
    }
    assert.ok((await creator.createDemo(key)).user.id)
  })

  it('rolls back copied activities and metadata when session insertion fails', async () => {
    await addTemplateActivity('Sample')
    await pool.query(
      `CREATE TRIGGER demo_creation_session_fail BEFORE INSERT ON sessions
        FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'session failure'`,
    )
    try {
      await assert.rejects(creator.createDemo(newKey()), /session failure/)
      const [counts] = await pool.query<
        (RowDataPacket & {
          accounts: number
          instances: number
          activities: number
        })[]
      >(
        `SELECT (SELECT COUNT(*) FROM \`account\` WHERE kind = 'demo') AS accounts,
          (SELECT COUNT(*) FROM demo_instances) AS instances,
          (SELECT COUNT(*) FROM work_search_activities) AS activities`,
      )
      assert.deepEqual(
        { ...counts[0] },
        {
          accounts: 0,
          instances: 0,
          activities: 1,
        },
      )
    } finally {
      await pool.query('DROP TRIGGER demo_creation_session_fail')
    }
  })

  it('copies a consistent template when activities change during creation', async () => {
    const first = await addTemplateActivity('Before')
    const lock = await pool.getConnection()
    let pending:
      | Promise<
          PromiseSettledResult<
            Awaited<ReturnType<MySqlDemoCreator['createDemo']>>
          >[]
        >
      | undefined
    try {
      await lock.beginTransaction()
      await lock.execute(
        'UPDATE work_search_activities SET job_title = ? WHERE id = ?',
        ['After', first],
      )
      await lock.execute(
        'INSERT INTO work_search_activities (account_id, job_title) VALUES (?, ?)',
        [templateId, 'Added'],
      )
      pending = Promise.allSettled([creator.createDemo(newKey())])
      const deadline = Date.now() + 3000
      let waiting = false
      while (!waiting && Date.now() < deadline) {
        const [rows] = await pool.query<(RowDataPacket & { Status: string })[]>(
          'SHOW ENGINE INNODB STATUS',
        )
        waiting = rows[0].Status.includes('LOCK WAIT')
        if (!waiting) {
          await new Promise((resolve) => setTimeout(resolve, 10))
        }
      }
      assert.ok(waiting, 'demo creation must wait for the template write')
      await lock.commit()
      const [result] = await pending
      assert.equal(result.status, 'fulfilled')
      const [rows] = await pool.execute<
        (RowDataPacket & { job_title: string })[]
      >(
        'SELECT job_title FROM work_search_activities WHERE account_id = ? ORDER BY job_title',
        [result.value.user.id],
      )
      assert.deepEqual(
        rows.map((row) => row.job_title),
        ['Added', 'After'],
      )
    } finally {
      await lock.rollback()
      lock.release()
      await pending
    }
  })

  it('works with the documented runtime database privileges', async () => {
    assert.ok(socketPath)
    await addTemplateActivity('Sample')
    const user = `demo_${randomBytes(6).toString('hex')}`
    const password = randomBytes(24).toString('hex')
    await pool.query(`CREATE USER '${user}'@'localhost' IDENTIFIED BY ?`, [
      password,
    ])
    let runtime: Pool | undefined
    try {
      for (const [table, privileges] of [
        ['account', 'SELECT, INSERT, UPDATE'],
        ['work_search_activities', 'SELECT, INSERT, UPDATE, DELETE'],
        ['sessions', 'SELECT, INSERT, UPDATE, DELETE'],
        ['demo_instances', 'SELECT, INSERT, UPDATE'],
        ['demo_start_requests', 'SELECT, INSERT'],
      ]) {
        await pool.query(
          `GRANT ${privileges} ON \`twc_demo_creation_test\`.\`${table}\` TO '${user}'@'localhost'`,
        )
      }
      runtime = createPool({
        socketPath,
        user,
        password,
        database,
        dateStrings: true,
        connectionLimit: 2,
      })
      const service = new MySqlDemoCreator(
        runtime,
        loadDemoCreationConfig(config),
      )
      assert.ok((await service.createDemo(newKey())).user.id)
    } finally {
      await runtime?.end()
      await pool.query(`DROP USER '${user}'@'localhost'`)
    }
  })
})
