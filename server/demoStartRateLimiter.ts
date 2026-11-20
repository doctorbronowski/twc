import { createHmac } from 'node:crypto'
import { isIP } from 'node:net'
import type { RowDataPacket } from 'mysql2'
import type { Pool } from 'mysql2/promise'
import type { RateLimitResult } from './authRateLimiter.ts'
import { withDatabaseAdvisoryLock } from './mysqlAdvisoryLock.ts'

const startLimit = 10
const windowMinutes = 15
const cleanupBatch = 200

export function normalizeIp(address: string): string {
  const version = isIP(address)
  if (version === 4) {
    return address
  }
  if (version !== 6) {
    throw new Error('A valid client IP address is required for demo limiting.')
  }
  let canonical: string
  try {
    canonical = new URL(`http://[${address}]/`).hostname.slice(1, -1)
  } catch {
    throw new Error('A valid client IP address is required for demo limiting.')
  }
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(canonical)
  if (mapped) {
    const high = Number.parseInt(mapped[1], 16)
    const low = Number.parseInt(mapped[2], 16)
    return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`
  }
  return canonical
}

export class MySqlDemoStartRateLimiter {
  private readonly pool: Pool
  private readonly secret: Buffer

  constructor(pool: Pool, secret: string) {
    const decoded = Buffer.from(secret, 'base64url')
    if (
      !/^[A-Za-z0-9_-]{43}$/.test(secret) ||
      decoded.length !== 32 ||
      decoded.toString('base64url') !== secret
    ) {
      throw new Error('DEMO_IP_HASH_SECRET must be a 32-byte base64url secret.')
    }
    this.pool = pool
    this.secret = decoded
  }

  async consume(address: string): Promise<RateLimitResult> {
    const ipHash = createHmac('sha256', this.secret)
      .update(normalizeIp(address))
      .digest()
    await this.pool.execute(
      `DELETE FROM demo_start_attempts
        WHERE created_at <= DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL ${windowMinutes} MINUTE)
        ORDER BY created_at LIMIT ${cleanupBatch}`,
    )
    return withDatabaseAdvisoryLock(
      this.pool,
      'twc:demo-ip:',
      ipHash.toString('hex'),
      async (connection) => {
        const [rows] = await connection.execute<
          (RowDataPacket & { count: number; retry_after: number | string })[]
        >(
          `SELECT COUNT(*) AS count,
            COALESCE(CEIL(TIMESTAMPDIFF(MICROSECOND, CURRENT_TIMESTAMP(3),
              DATE_ADD(MIN(created_at), INTERVAL ${windowMinutes} MINUTE)) / 1000000), 0) AS retry_after
            FROM demo_start_attempts
            WHERE ip_hash = ?
              AND created_at > DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL ${windowMinutes} MINUTE)`,
          [ipHash],
        )
        if (rows[0].count >= startLimit) {
          return {
            allowed: false,
            retryAfterSeconds: Math.max(1, Number(rows[0].retry_after)),
          }
        }
        await connection.execute(
          'INSERT INTO demo_start_attempts (ip_hash) VALUES (?)',
          [ipHash],
        )
        return { allowed: true, retryAfterSeconds: 0 }
      },
    )
  }
}
