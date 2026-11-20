import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { after, before, describe, it } from 'node:test'
import { type Connection, createConnection } from 'mysql2/promise'
import {
  accountSchemaStatements,
  activitySchemaStatement,
} from './databaseSchema.ts'
import { cleanupExpiredDemos } from './demoCleanup.ts'

const socketPath = process.env.DEMO_CLEANUP_TEST_SOCKET
const database = 'twc_demo_cleanup_test'

describe('demo cleanup with MySQL', {
  skip: !socketPath && 'requires an isolated MySQL test socket',
}, () => {
  let connection: Connection

  before(async () => {
    assert.ok(socketPath)
    connection = await createConnection({
      socketPath,
      user: 'root',
      database,
    })
    const [tables] = await connection.query('SHOW TABLES')
    assert.deepEqual(tables, [], 'test database must be empty')
    for (const statement of accountSchemaStatements) {
      await connection.query(statement)
    }
    await connection.query(activitySchemaStatement)
    await connection.query(
      'ALTER TABLE work_search_activities ADD COLUMN account_id INT UNSIGNED NOT NULL',
    )
    await connection.query(
      'ALTER TABLE work_search_activities ADD FOREIGN KEY (account_id) REFERENCES `account`(id)',
    )
  })

  after(async () => {
    await connection?.end()
  })

  async function addAccount(
    kind: 'regular' | 'demo',
    status: 'expired' | 'ended' | 'active' | 'unmarked',
  ): Promise<number> {
    const [result] = await connection.execute<import('mysql2').ResultSetHeader>(
      'INSERT INTO `account` (username, password_hash, kind) VALUES (?, ?, ?)',
      [
        `${randomBytes(16).toString('hex')}@demo.invalid`,
        'not-a-valid-password-hash',
        kind,
      ],
    )
    const id = result.insertId
    if (status !== 'unmarked') {
      await connection.execute(
        `INSERT INTO demo_instances (account_id, expires_at, ended_at)
            VALUES (?, DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL ? SECOND),
              IF(? = 'ended', CURRENT_TIMESTAMP(3), NULL))`,
        [id, status === 'expired' ? -60 : 600, status],
      )
    }
    await connection.execute(
      'INSERT INTO work_search_activities (account_id) VALUES (?)',
      [id],
    )
    await connection.execute(
      `INSERT INTO sessions (account_id, token_hash, expires_at)
        VALUES (?, ?, DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL 10 MINUTE))`,
      [id, randomBytes(32)],
    )
    for (const table of [
      'account_email_verification_tokens',
      'account_password_reset_tokens',
    ]) {
      await connection.execute(
        `INSERT INTO \`${table}\` (account_id, token_hash, expires_at)
          VALUES (?, ?, DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL 10 MINUTE))`,
        [id, randomBytes(32)],
      )
    }
    await connection.execute(
      `INSERT INTO account_email_change_tokens
        (account_id, token_hash, pending_email, expires_at)
        VALUES (?, ?, 'pending@demo.invalid', DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL 10 MINUTE))`,
      [id, randomBytes(32)],
    )
    return id
  }

  async function countRows(table: string, accountId: number) {
    const [rows] = await connection.execute<
      (import('mysql2').RowDataPacket & { count: number })[]
    >(
      `SELECT COUNT(*) AS count FROM \`${table}\` WHERE ${table === 'account' ? 'id' : 'account_id'} = ?`,
      [accountId],
    )
    return rows[0].count
  }

  it('removes only expired or ended marked demos and their data', async () => {
    const expired = await addAccount('demo', 'expired')
    const ended = await addAccount('demo', 'ended')
    const active = await addAccount('demo', 'active')
    const regular = await addAccount('regular', 'expired')
    const unmarked = await addAccount('demo', 'unmarked')

    assert.deepEqual(await cleanupExpiredDemos(connection), {
      removed: 2,
      remaining: 0,
    })
    for (const id of [expired, ended]) {
      for (const table of [
        'account',
        'demo_instances',
        'work_search_activities',
        'sessions',
        'account_email_verification_tokens',
        'account_password_reset_tokens',
        'account_email_change_tokens',
      ]) {
        assert.equal(await countRows(table, id), 0)
      }
    }
    for (const id of [active, regular, unmarked]) {
      assert.equal(await countRows('account', id), 1)
      assert.equal(await countRows('work_search_activities', id), 1)
      assert.equal(await countRows('sessions', id), 1)
      assert.equal(await countRows('account_password_reset_tokens', id), 1)
    }
    assert.deepEqual(await cleanupExpiredDemos(connection), {
      removed: 0,
      remaining: 0,
    })
  })

  it('rolls back activity deletion when the account cannot be removed', async () => {
    const id = await addAccount('demo', 'expired')
    await connection.query(
      `CREATE TABLE cleanup_test_blocker (
          account_id INT UNSIGNED NOT NULL,
          FOREIGN KEY (account_id) REFERENCES \`account\`(id)
        ) ENGINE=InnoDB`,
    )
    await connection.execute(
      'INSERT INTO cleanup_test_blocker (account_id) VALUES (?)',
      [id],
    )

    await assert.rejects(cleanupExpiredDemos(connection))
    assert.equal(await countRows('account', id), 1)
    assert.equal(await countRows('work_search_activities', id), 1)
    await connection.execute(
      'DELETE FROM cleanup_test_blocker WHERE account_id = ?',
      [id],
    )
    assert.deepEqual(await cleanupExpiredDemos(connection), {
      removed: 1,
      remaining: 0,
    })
  })

  it('fails visibly when another cleanup holds the lock', async () => {
    assert.ok(socketPath)
    const other = await createConnection({
      socketPath,
      user: 'root',
      database,
    })
    try {
      await other.query(
        `SELECT GET_LOCK(CONCAT('twc:demo-cleanup:', LEFT(SHA2(DATABASE(), 256), 32)), 0)`,
      )
      await assert.rejects(cleanupExpiredDemos(connection), /lock/)
    } finally {
      await other.end()
    }
    assert.deepEqual(await cleanupExpiredDemos(connection), {
      removed: 0,
      remaining: 0,
    })
  })

  it('works with the documented maintenance privileges', async () => {
    assert.ok(socketPath)
    const id = await addAccount('demo', 'expired')
    const password = randomBytes(24).toString('hex')
    const user = `cleanup_${randomBytes(6).toString('hex')}`
    await connection.query(
      `CREATE USER '${user}'@'localhost' IDENTIFIED BY ${connection.escape(password)}`,
    )
    await connection.query(
      `GRANT SELECT, DELETE ON \`twc_demo_cleanup_test\`.\`account\` TO '${user}'@'localhost'`,
    )
    await connection.query(
      `GRANT SELECT, DELETE ON \`twc_demo_cleanup_test\`.\`work_search_activities\` TO '${user}'@'localhost'`,
    )
    await connection.query(
      `GRANT SELECT, UPDATE ON \`twc_demo_cleanup_test\`.\`demo_instances\` TO '${user}'@'localhost'`,
    )
    const maintenance = await createConnection({
      socketPath,
      user,
      password,
      database,
    })
    try {
      assert.deepEqual(await cleanupExpiredDemos(maintenance), {
        removed: 1,
        remaining: 0,
      })
      assert.equal(await countRows('account', id), 0)
    } finally {
      await maintenance.end()
    }
  })

  it('rechecks expiry after waiting for the account lock', async () => {
    assert.ok(socketPath)
    const id = await addAccount('demo', 'expired')
    const other = await createConnection({
      socketPath,
      user: 'root',
      database,
    })
    const observer = await createConnection({
      socketPath,
      user: 'root',
      database,
    })
    const [identifiers] = await other.query<
      (import('mysql2').RowDataPacket & { id: number })[]
    >('SELECT CONNECTION_ID() AS id')
    await connection.beginTransaction()
    let cleanup:
      | Promise<
          | { result: { removed: number; remaining: number } }
          | { error: unknown }
        >
      | undefined
    try {
      await connection.execute(
        'SELECT id FROM `account` WHERE id = ? FOR UPDATE',
        [id],
      )
      cleanup = cleanupExpiredDemos(other).then(
        (result) => ({ result }),
        (error: unknown) => ({ error }),
      )
      const deadline = Date.now() + 5000
      let waiting = false
      while (Date.now() < deadline) {
        const [rows] =
          await observer.query<
            (import('mysql2').RowDataPacket & {
              Id: number
              Info: string | null
            })[]
          >('SHOW PROCESSLIST')
        if (
          rows.some(
            (row) =>
              row.Id === identifiers[0].id &&
              row.Info?.startsWith('SELECT kind FROM `account`'),
          )
        ) {
          waiting = true
          break
        }
        await new Promise((resolve) => setTimeout(resolve, 25))
      }
      assert.equal(waiting, true, 'cleanup did not wait for the account lock')
      await connection.execute(
        'UPDATE demo_instances SET expires_at = DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL 10 MINUTE) WHERE account_id = ?',
        [id],
      )
      await connection.commit()
      assert.deepEqual(await cleanup, { result: { removed: 0, remaining: 0 } })
      assert.equal(await countRows('account', id), 1)
      assert.equal(await countRows('work_search_activities', id), 1)
    } finally {
      await connection.rollback()
      await cleanup
      await other.end()
      await observer.end()
    }
  })

  it('limits each run to 50 accounts and reports the backlog', async () => {
    for (let index = 0; index < 51; index += 1) {
      await addAccount('demo', 'expired')
    }
    assert.deepEqual(await cleanupExpiredDemos(connection), {
      removed: 50,
      remaining: 1,
    })
    assert.deepEqual(await cleanupExpiredDemos(connection), {
      removed: 1,
      remaining: 0,
    })
  })
})
