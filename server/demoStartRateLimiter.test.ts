import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { after, before, beforeEach, describe, it } from 'node:test'
import type { RowDataPacket } from 'mysql2'
import { createPool, type Pool } from 'mysql2/promise'
import { accountSchemaStatements } from './databaseSchema.ts'
import { MySqlDemoStartRateLimiter } from './demoStartRateLimiter.ts'

const socketPath = process.env.DEMO_RATE_TEST_SOCKET
const database = 'twc_demo_rate_test'
const secret = randomBytes(32).toString('base64url')

describe('shared demo start limiter with MySQL', {
  skip: !socketPath && 'requires an isolated MySQL test socket',
}, () => {
  let pool: Pool
  let otherPool: Pool
  let limiter: MySqlDemoStartRateLimiter
  let other: MySqlDemoStartRateLimiter

  before(async () => {
    assert.ok(socketPath)
    const options = { socketPath, user: 'root', database, connectionLimit: 8 }
    pool = createPool(options)
    otherPool = createPool(options)
    const [tables] = await pool.query('SHOW TABLES')
    assert.deepEqual(tables, [], 'test database must be empty')
    for (const statement of accountSchemaStatements) {
      await pool.query(statement)
    }
    limiter = new MySqlDemoStartRateLimiter(pool, secret)
    other = new MySqlDemoStartRateLimiter(otherPool, secret)
  })

  beforeEach(async () => {
    await pool.query('DELETE FROM demo_start_attempts')
  })

  after(async () => {
    await pool?.end()
    await otherPool?.end()
  })

  it('limits a single IP to ten attempts across workers within a rolling window', async () => {
    const results = await Promise.all(
      Array.from({ length: 14 }, (_, i) =>
        (i % 2 ? limiter : other).consume('192.0.2.1'),
      ),
    )
    assert.equal(results.filter((item) => item.allowed).length, 10)
    const blocked = results.filter((item) => !item.allowed)
    assert.equal(blocked.length, 4)
    for (const result of blocked) {
      assert.ok(
        result.retryAfterSeconds >= 898 && result.retryAfterSeconds <= 900,
      )
    }
    const [rows] = await pool.query<
      (RowDataPacket & { count: number; hashes: number })[]
    >(
      'SELECT COUNT(*) AS count, COUNT(DISTINCT ip_hash) AS hashes FROM demo_start_attempts',
    )
    assert.equal(rows[0].count, 10)
    assert.equal(rows[0].hashes, 1)
    assert.equal((await other.consume('192.0.2.2')).allowed, true)
  })

  it('treats equivalent IPv4-mapped and IPv6 spellings as the same address', async () => {
    for (let i = 0; i < 10; i++) {
      assert.equal(
        (await limiter.consume(i % 2 ? '::ffff:c000:201' : '192.0.2.1'))
          .allowed,
        true,
      )
    }
    assert.equal((await other.consume('::ffff:192.0.2.1')).allowed, false)
    for (let i = 0; i < 10; i++) {
      assert.equal(
        (await limiter.consume(i % 2 ? '2001:0db8:0:0:0:0:0:1' : '2001:db8::1'))
          .allowed,
        true,
      )
    }
    assert.equal((await other.consume('2001:db8:0::1')).allowed, false)
  })

  it('allows a new attempt once the oldest timestamp leaves the rolling window', async () => {
    for (let i = 0; i < 10; i++) {
      await limiter.consume('192.0.2.1')
    }
    await pool.query(
      `UPDATE demo_start_attempts
        SET created_at = DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 15 MINUTE)
        ORDER BY id LIMIT 1`,
    )
    assert.equal((await other.consume('192.0.2.1')).allowed, true)
    assert.equal((await limiter.consume('192.0.2.1')).allowed, false)
  })

  it('prunes expired records in bounded batches without deleting active attempts', async () => {
    const entries = Array.from({ length: 250 }, () => [randomBytes(32)])
    await pool.query(
      `INSERT INTO demo_start_attempts (ip_hash, created_at)
        VALUES ${entries.map(() => '(?, DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 16 MINUTE))').join(', ')}`,
      entries.flat(),
    )
    await limiter.consume('192.0.2.1')
    let [rows] = await pool.query<(RowDataPacket & { count: number })[]>(
      'SELECT COUNT(*) AS count FROM demo_start_attempts',
    )
    assert.equal(rows[0].count, 51)
    await limiter.consume('192.0.2.2')
    ;[rows] = await pool.query<(RowDataPacket & { count: number })[]>(
      'SELECT COUNT(*) AS count FROM demo_start_attempts',
    )
    assert.equal(rows[0].count, 2)
  })

  it('rejects invalid addresses and weak or malformed hash secrets', async () => {
    for (const value of ['', 'a'.repeat(43), 'invalid']) {
      assert.throws(() => new MySqlDemoStartRateLimiter(pool, value), /secret/)
    }
    for (const value of ['unknown', '192.0.2.1, 198.51.100.1', '']) {
      await assert.rejects(limiter.consume(value), /valid client IP/)
    }
  })

  it('works with only the documented runtime table privileges', async () => {
    assert.ok(socketPath)
    const user = `rate_${randomBytes(6).toString('hex')}`
    const password = randomBytes(24).toString('hex')
    await pool.query(`CREATE USER '${user}'@'localhost' IDENTIFIED BY ?`, [
      password,
    ])
    let runtime: Pool | undefined
    try {
      await pool.query(
        `GRANT SELECT, INSERT, DELETE ON \`twc_demo_rate_test\`.\`demo_start_attempts\` TO '${user}'@'localhost'`,
      )
      runtime = createPool({
        socketPath,
        user,
        password,
        database,
        connectionLimit: 2,
      })
      assert.equal(
        (
          await new MySqlDemoStartRateLimiter(runtime, secret).consume(
            '192.0.2.3',
          )
        ).allowed,
        true,
      )
    } finally {
      await runtime?.end()
      await pool.query(`DROP USER '${user}'@'localhost'`)
    }
  })
})
