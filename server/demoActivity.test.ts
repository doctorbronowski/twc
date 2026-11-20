import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { after, before, describe, it } from 'node:test'
import type { ResultSetHeader, RowDataPacket } from 'mysql2'
import { createPool, type Pool } from 'mysql2/promise'
import { parseActivity } from './activityInput.ts'
import {
  DemoActivityError,
  loadDemoActivityLimit,
  MySqlActivityRepository,
} from './activityRepository.ts'
import {
  accountSchemaStatements,
  activitySchemaStatement,
} from './databaseSchema.ts'

describe('demo activity limit configuration', () => {
  it('accepts a positive integer and rejects invalid configured limits', () => {
    assert.equal(loadDemoActivityLimit({ DEMO_ACTIVITY_LIMIT: '20' }), 20)
    assert.equal(loadDemoActivityLimit({}), null)
    for (const value of ['', '0', '-1', '1.5', '20x', '9007199254740992']) {
      assert.throws(
        () => loadDemoActivityLimit({ DEMO_ACTIVITY_LIMIT: value }),
        /positive integer/,
      )
    }
  })
})

const socketPath = process.env.DEMO_ACTIVITY_TEST_SOCKET
const database = 'twc_demo_activity_test'

describe('demo activity writes with MySQL', {
  skip: !socketPath && 'requires an isolated MySQL test socket',
}, () => {
  let pool: Pool
  let repository: MySqlActivityRepository
  const parsed = parseActivity({ job_title: 'Demo activity' })
  assert.ok(parsed.ok)
  const activity = parsed.value

  before(async () => {
    assert.ok(socketPath)
    pool = createPool({
      socketPath,
      user: 'root',
      database,
      connectionLimit: 5,
    })
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
    repository = new MySqlActivityRepository(pool, 20)
  })

  after(async () => {
    await pool?.end()
  })

  async function seed(kind: 'demo' | 'regular' = 'demo') {
    const [account] = await pool.execute<ResultSetHeader>(
      'INSERT INTO `account` (username, password_hash, kind) VALUES (?, ?, ?)',
      [`${randomBytes(16).toString('hex')}@example.invalid`, 'invalid', kind],
    )
    const [session] = await pool.execute<ResultSetHeader>(
      `INSERT INTO sessions (account_id, token_hash, expires_at)
        VALUES (?, ?, DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL 5 MINUTE))`,
      [account.insertId, randomBytes(32)],
    )
    if (kind === 'demo') {
      await pool.execute(
        `INSERT INTO demo_instances (account_id, expires_at)
          VALUES (?, DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL 5 MINUTE))`,
        [account.insertId],
      )
    }
    return { id: account.insertId, demo: { sessionId: session.insertId } }
  }

  function isDemoError(code: DemoActivityError['code']) {
    return (error: unknown) =>
      error instanceof DemoActivityError && error.code === code
  }

  it('enforces the exact cap across simultaneous creates and allows edits and replacement', async () => {
    const account = await seed()
    for (let i = 0; i < 19; i++) {
      await pool.execute(
        'INSERT INTO work_search_activities (account_id) VALUES (?)',
        [account.id],
      )
    }
    const results = await Promise.allSettled([
      repository.createActivity(account.id, activity, account.demo),
      repository.createActivity(account.id, activity, account.demo),
    ])
    const successes = results.filter((result) => result.status === 'fulfilled')
    const failures = results.filter((result) => result.status === 'rejected')
    assert.equal(successes.length, 1)
    assert.equal(failures.length, 1)
    assert.ok(
      failures[0].status === 'rejected' &&
        isDemoError('activity-limit')(failures[0].reason),
    )
    assert.ok(successes[0].status === 'fulfilled')
    const id = successes[0].value
    const [counts] = await pool.execute<(RowDataPacket & { count: number })[]>(
      'SELECT COUNT(*) AS count FROM work_search_activities WHERE account_id = ?',
      [account.id],
    )
    assert.equal(counts[0].count, 20)
    assert.equal(
      await repository.updateActivity(account.id, id, activity, account.demo),
      true,
    )
    assert.equal(
      await repository.deleteActivity(account.id, id, account.demo),
      true,
    )
    assert.ok(
      await repository.createActivity(account.id, activity, account.demo),
    )
  })

  it('does not impose a demo cap on regular accounts', async () => {
    const account = await seed('regular')
    for (let i = 0; i < 20; i++) {
      await pool.execute(
        'INSERT INTO work_search_activities (account_id) VALUES (?)',
        [account.id],
      )
    }
    const id = await repository.createActivity(account.id, activity)
    assert.equal(
      await repository.updateActivity(account.id, id, activity),
      true,
    )
    assert.equal(await repository.deleteActivity(account.id, id), true)
  })

  it('fails closed without a configured limit', async () => {
    const account = await seed()
    const unconfigured = new MySqlActivityRepository(pool)
    await assert.rejects(
      unconfigured.createActivity(account.id, activity, account.demo),
      /DEMO_ACTIVITY_LIMIT/,
    )
  })

  it('rejects all writes for ended, expired, missing or mismatched sessions', async () => {
    for (const status of [
      'ended',
      'expired-demo',
      'expired-session',
      'missing',
      'missing-marker',
      'disabled',
      'wrong-session',
    ]) {
      const account = await seed()
      const [row] = await pool.execute<ResultSetHeader>(
        'INSERT INTO work_search_activities (account_id, job_title) VALUES (?, ?)',
        [account.id, 'unchanged'],
      )
      if (status === 'ended') {
        await pool.execute(
          'UPDATE demo_instances SET ended_at = CURRENT_TIMESTAMP(3) WHERE account_id = ?',
          [account.id],
        )
      } else if (status === 'expired-demo') {
        await pool.execute(
          'UPDATE demo_instances SET expires_at = CURRENT_TIMESTAMP(3) WHERE account_id = ?',
          [account.id],
        )
      } else if (status === 'expired-session') {
        await pool.execute(
          'UPDATE sessions SET expires_at = CURRENT_TIMESTAMP(3) WHERE account_id = ?',
          [account.id],
        )
      } else if (status === 'missing') {
        await pool.execute('DELETE FROM sessions WHERE account_id = ?', [
          account.id,
        ])
      } else if (status === 'missing-marker') {
        await pool.execute('DELETE FROM demo_instances WHERE account_id = ?', [
          account.id,
        ])
      } else if (status === 'disabled') {
        await pool.execute(
          'UPDATE `account` SET disabled_at = CURRENT_TIMESTAMP(3) WHERE id = ?',
          [account.id],
        )
      } else {
        account.demo.sessionId += 1_000_000
      }
      for (const operation of [
        () => repository.createActivity(account.id, activity, account.demo),
        () =>
          repository.updateActivity(
            account.id,
            row.insertId,
            activity,
            account.demo,
          ),
        () => repository.deleteActivity(account.id, row.insertId, account.demo),
      ]) {
        await assert.rejects(
          operation(),
          isDemoError('session-expired'),
          status,
        )
      }
      const [rows] = await pool.execute<
        (RowDataPacket & { job_title: string })[]
      >('SELECT job_title FROM work_search_activities WHERE account_id = ?', [
        account.id,
      ])
      assert.deepEqual(
        rows.map((item) => item.job_title),
        ['unchanged'],
      )
    }
  })

  it('works with the existing runtime database privileges', async () => {
    assert.ok(socketPath)
    const account = await seed()
    const user = `activity_${randomBytes(6).toString('hex')}`
    const password = randomBytes(24).toString('hex')
    await pool.query(`CREATE USER '${user}'@'localhost' IDENTIFIED BY ?`, [
      password,
    ])
    let restricted: Pool | undefined
    try {
      for (const [table, privileges] of [
        ['account', 'SELECT, UPDATE'],
        ['sessions', 'SELECT, UPDATE'],
        ['demo_instances', 'SELECT, UPDATE'],
        ['work_search_activities', 'SELECT, INSERT, UPDATE, DELETE'],
      ]) {
        await pool.query(
          `GRANT ${privileges} ON \`twc_demo_activity_test\`.\`${table}\` TO '${user}'@'localhost'`,
        )
      }
      restricted = createPool({
        socketPath,
        user,
        password,
        database,
        connectionLimit: 2,
      })
      const runtime = new MySqlActivityRepository(restricted, 20)
      const id = await runtime.createActivity(
        account.id,
        activity,
        account.demo,
      )
      assert.equal(
        await runtime.updateActivity(account.id, id, activity, account.demo),
        true,
      )
      assert.equal(
        await runtime.deleteActivity(account.id, id, account.demo),
        true,
      )
    } finally {
      await restricted?.end()
      await pool.query(`DROP USER '${user}'@'localhost'`)
    }
  })

  it('rolls back a write if the demo expires while the database statement runs', async () => {
    const account = await seed()
    await pool.execute(
      'UPDATE demo_instances SET expires_at = DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL 2 SECOND) WHERE account_id = ?',
      [account.id],
    )
    await pool.execute(
      'UPDATE sessions SET expires_at = DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL 2 SECOND) WHERE account_id = ?',
      [account.id],
    )
    await pool.query(
      `CREATE TRIGGER demo_activity_delay BEFORE INSERT ON work_search_activities
        FOR EACH ROW DO SLEEP(3)`,
    )
    try {
      const start = Date.now()
      await assert.rejects(
        repository.createActivity(account.id, activity, account.demo),
        isDemoError('session-expired'),
      )
      assert.ok(Date.now() - start >= 2500, 'the insert trigger must run')
      const [rows] = await pool.execute<(RowDataPacket & { count: number })[]>(
        'SELECT COUNT(*) AS count FROM work_search_activities WHERE account_id = ?',
        [account.id],
      )
      assert.equal(rows[0].count, 0)
    } finally {
      await pool.query('DROP TRIGGER demo_activity_delay')
    }
  })

  it('rechecks the session after waiting for the account lock', async () => {
    const account = await seed()
    const lock = await pool.getConnection()
    let writing: Promise<PromiseSettledResult<number>[]> | undefined
    try {
      await lock.beginTransaction()
      await lock.execute('SELECT id FROM `account` WHERE id = ? FOR UPDATE', [
        account.id,
      ])
      writing = Promise.allSettled([
        repository.createActivity(account.id, activity, account.demo),
      ])
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
      assert.ok(waiting, 'write must wait for the account lock')
      await lock.execute(
        'UPDATE demo_instances SET ended_at = CURRENT_TIMESTAMP(3) WHERE account_id = ?',
        [account.id],
      )
      await lock.commit()
      const [result] = await writing
      assert.equal(result.status, 'rejected')
      if (result.status === 'rejected') {
        assert.ok(isDemoError('session-expired')(result.reason))
      }
      const [rows] = await pool.execute<(RowDataPacket & { count: number })[]>(
        'SELECT COUNT(*) AS count FROM work_search_activities WHERE account_id = ?',
        [account.id],
      )
      assert.equal(rows[0].count, 0)
    } finally {
      await lock.rollback()
      lock.release()
      await writing
    }
  })
})
