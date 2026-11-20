import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { after, before, describe, it } from 'node:test'
import type { ResultSetHeader, RowDataPacket } from 'mysql2'
import { createPool, type Pool } from 'mysql2/promise'
import { MySqlAuthRepository } from './authRepository.ts'
import { accountSchemaStatements } from './databaseSchema.ts'

const socketPath = process.env.DEMO_AUTH_TEST_SOCKET
const database = 'twc_demo_auth_test'

describe('demo authentication with MySQL', {
  skip: !socketPath && 'requires an isolated MySQL test socket',
}, () => {
  let pool: Pool
  let repository: MySqlAuthRepository

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
    repository = new MySqlAuthRepository(pool)
  })

  after(async () => {
    await pool?.end()
  })

  async function seed(kind: 'demo' | 'regular', marker = true) {
    const token = randomBytes(32)
    const [account] = await pool.execute<ResultSetHeader>(
      `INSERT INTO \`account\` (username, password_hash, kind, email_verified_at)
        VALUES (?, 'hash', ?, CURRENT_TIMESTAMP(3))`,
      [`${randomBytes(16).toString('hex')}@example.invalid`, kind],
    )
    await pool.execute(
      `INSERT INTO sessions (account_id, token_hash, expires_at)
        VALUES (?, ?, DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL 60 SECOND))`,
      [account.insertId, token],
    )
    if (marker) {
      await pool.execute(
        `INSERT INTO demo_instances (account_id, expires_at)
          VALUES (?, DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL 60 SECOND))`,
        [account.insertId],
      )
    }
    return { id: account.insertId, token }
  }

  it('extends both active demo deadlines together and keeps regular sessions at 15 minutes', async () => {
    const demo = await seed('demo')
    const regular = await seed('regular', false)
    assert.equal(
      (await repository.getAndTouchSession(demo.token))?.kind,
      'demo',
    )
    assert.equal(
      (await repository.getAndTouchSession(regular.token))?.kind,
      'regular',
    )
    const [rows] = await pool.execute<
      (RowDataPacket & { same: number; remaining: number })[]
    >(
      `SELECT s.expires_at = d.expires_at AS same,
        TIMESTAMPDIFF(SECOND, CURRENT_TIMESTAMP(3), s.expires_at) AS remaining
        FROM sessions s JOIN demo_instances d ON d.account_id = s.account_id
        WHERE s.account_id = ?`,
      [demo.id],
    )
    assert.equal(rows[0].same, 1)
    assert.ok(rows[0].remaining >= 298 && rows[0].remaining <= 300)
    const [regularRows] = await pool.execute<
      (RowDataPacket & { remaining: number })[]
    >(
      `SELECT TIMESTAMPDIFF(SECOND, CURRENT_TIMESTAMP(3), expires_at) AS remaining
        FROM sessions WHERE account_id = ?`,
      [regular.id],
    )
    assert.ok(
      regularRows[0].remaining >= 898 && regularRows[0].remaining <= 900,
    )
  })

  it('never revives missing, ended or expired demo metadata or expired sessions', async () => {
    const missing = await seed('demo', false)
    const ended = await seed('demo')
    const expiredDemo = await seed('demo')
    const expiredSession = await seed('demo')
    await pool.execute(
      'UPDATE demo_instances SET ended_at = CURRENT_TIMESTAMP(3) WHERE account_id = ?',
      [ended.id],
    )
    await pool.execute(
      'UPDATE demo_instances SET expires_at = CURRENT_TIMESTAMP(3) WHERE account_id = ?',
      [expiredDemo.id],
    )
    await pool.execute(
      'UPDATE sessions SET expires_at = CURRENT_TIMESTAMP(3) WHERE account_id = ?',
      [expiredSession.id],
    )
    for (const demo of [missing, ended, expiredDemo, expiredSession]) {
      assert.equal(await repository.getAndTouchSession(demo.token), null)
    }
    const [rows] = await pool.execute<(RowDataPacket & { expired: number })[]>(
      'SELECT expires_at <= CURRENT_TIMESTAMP(3) AS expired FROM demo_instances WHERE account_id = ?',
      [expiredDemo.id],
    )
    assert.equal(rows[0].expired, 1)
  })

  it('ends a demo and revokes its session on logout', async () => {
    const demo = await seed('demo')
    await repository.revokeSession(demo.token)
    assert.equal(await repository.getAndTouchSession(demo.token), null)
    const [rows] = await pool.execute<
      (RowDataPacket & { ended: number; sessions: number })[]
    >(
      `SELECT d.ended_at IS NOT NULL AS ended,
        (SELECT COUNT(*) FROM sessions s WHERE s.account_id = d.account_id) AS sessions
        FROM demo_instances d WHERE d.account_id = ?`,
      [demo.id],
    )
    assert.equal(rows[0].ended, 1)
    assert.equal(rows[0].sessions, 0)
  })

  it('rolls back ending the demo if session revocation fails', async () => {
    const demo = await seed('demo')
    await pool.query(
      `CREATE TRIGGER demo_auth_block_delete BEFORE DELETE ON sessions
        FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'test failure'`,
    )
    try {
      await assert.rejects(repository.revokeSession(demo.token), /test failure/)
      const [rows] = await pool.execute<
        (RowDataPacket & { ended: number; sessions: number })[]
      >(
        `SELECT d.ended_at IS NOT NULL AS ended,
          (SELECT COUNT(*) FROM sessions s WHERE s.account_id = d.account_id) AS sessions
          FROM demo_instances d WHERE d.account_id = ?`,
        [demo.id],
      )
      assert.equal(rows[0].ended, 0)
      assert.equal(rows[0].sessions, 1)
    } finally {
      await pool.query('DROP TRIGGER demo_auth_block_delete')
    }
  })

  it('does not restore access when authentication races with logout', async () => {
    const demo = await seed('demo')
    await Promise.all([
      repository.getAndTouchSession(demo.token),
      repository.revokeSession(demo.token),
    ])
    assert.equal(await repository.getAndTouchSession(demo.token), null)
    const [rows] = await pool.execute<(RowDataPacket & { ended: number })[]>(
      'SELECT ended_at IS NOT NULL AS ended FROM demo_instances WHERE account_id = ?',
      [demo.id],
    )
    assert.equal(rows[0].ended, 1)
  })

  it('ends a demo when a successful regular login replaces its session', async () => {
    const demo = await seed('demo')
    const regular = await seed('regular', false)
    await repository.revokeSession(regular.token)
    const account = await repository.findAccountById(regular.id)
    assert.ok(account)
    const newToken = randomBytes(32)
    assert.equal(
      await repository.createSession(account, newToken, demo.token),
      'created',
    )
    assert.equal(await repository.getAndTouchSession(demo.token), null)
    assert.equal(
      (await repository.getAndTouchSession(newToken))?.kind,
      'regular',
    )
    const [rows] = await pool.execute<(RowDataPacket & { ended: number })[]>(
      'SELECT ended_at IS NOT NULL AS ended FROM demo_instances WHERE account_id = ?',
      [demo.id],
    )
    assert.equal(rows[0].ended, 1)
  })

  it('rechecks demo status after waiting for the account lock', async () => {
    for (const column of ['ended_at', 'expires_at']) {
      const demo = await seed('demo')
      const lock = await pool.getConnection()
      try {
        await lock.beginTransaction()
        await lock.execute('SELECT id FROM `account` WHERE id = ? FOR UPDATE', [
          demo.id,
        ])
        const touching = repository.getAndTouchSession(demo.token)
        const deadline = Date.now() + 3000
        let waiting = 0
        while (waiting === 0 && Date.now() < deadline) {
          const [rows] = await pool.query<
            (RowDataPacket & { waiting: number })[]
          >(
            'SELECT COUNT(*) AS waiting FROM information_schema.innodb_lock_waits',
          )
          waiting = rows[0].waiting
          if (!waiting) {
            await new Promise((resolve) => setTimeout(resolve, 10))
          }
        }
        assert.ok(waiting, 'authentication must wait for the account lock')
        await lock.execute(
          `UPDATE demo_instances SET ${column} = CURRENT_TIMESTAMP(3) WHERE account_id = ?`,
          [demo.id],
        )
        await lock.commit()
        assert.equal(await touching, null)
      } finally {
        await lock.rollback()
        lock.release()
      }
    }
  })

  it('rejects pre-existing verification, reset and email-change tokens for demos', async () => {
    const demo = await seed('demo')
    const account = await repository.findAccountById(demo.id)
    assert.ok(account)
    assert.equal(
      await repository.createSession(account, randomBytes(32), null),
      'account-changed',
    )
    const verify = randomBytes(32)
    const reset = randomBytes(32)
    const change = randomBytes(32)
    await pool.execute('UPDATE `account` SET pending_email = ? WHERE id = ?', [
      'pending@example.invalid',
      demo.id,
    ])
    for (const [table, token] of [
      ['account_email_verification_tokens', verify],
      ['account_password_reset_tokens', reset],
    ] as const) {
      await pool.execute(
        `INSERT INTO \`${table}\` (account_id, token_hash, expires_at)
          VALUES (?, ?, DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL 5 MINUTE))`,
        [demo.id, token],
      )
    }
    await pool.execute(
      `INSERT INTO account_email_change_tokens
        (account_id, token_hash, pending_email, expires_at)
        VALUES (?, ?, ?, DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL 5 MINUTE))`,
      [demo.id, change, 'pending@example.invalid'],
    )
    assert.equal(await repository.consumeEmailVerificationToken(verify), false)
    assert.equal(
      await repository.resetPasswordWithToken(reset, 'new-hash'),
      false,
    )
    assert.deepEqual(await repository.completeEmailChange(change, demo.token), {
      status: 'invalid-token',
    })
    assert.equal(
      await repository.changePassword(demo.id, 'hash', 'new-hash', demo.token),
      false,
    )
    assert.equal(await repository.deactivateAccount(demo.id, 'hash'), false)
    await repository.cancelEmailChange(demo.id)
    const [rows] = await pool.execute<
      (RowDataPacket & {
        password_hash: string
        pending_email: string
        tokens: number
      })[]
    >(
      `SELECT a.password_hash, a.pending_email,
        (SELECT COUNT(*) FROM account_email_change_tokens t WHERE t.account_id = a.id) AS tokens
        FROM \`account\` a WHERE a.id = ?`,
      [demo.id],
    )
    assert.equal(rows[0].password_hash, 'hash')
    assert.equal(rows[0].pending_email, 'pending@example.invalid')
    assert.equal(rows[0].tokens, 1)
  })
})
