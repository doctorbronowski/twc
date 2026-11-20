import type { RowDataPacket } from 'mysql2'
import type { Pool, PoolConnection } from 'mysql2/promise'

type LockRow = RowDataPacket & { value: number | null }

export class AdvisoryLockUnavailableError extends Error {
  constructor() {
    super('Database advisory lock is unavailable.')
    this.name = 'AdvisoryLockUnavailableError'
  }
}

export async function withDatabaseAdvisoryLock<T>(
  pool: Pool,
  prefix: string,
  key: string,
  operation: (connection: PoolConnection) => Promise<T>,
): Promise<T> {
  const connection = await pool.getConnection()
  let destroyed = false
  const release = async () => {
    const [rows] = await connection.execute<LockRow[]>(
      `SELECT RELEASE_LOCK(CONCAT(?, LEFT(SHA2(CONCAT(DATABASE(), ?), 256), 32))) AS value`,
      [prefix, key],
    )
    if (rows[0]?.value !== 1) {
      throw new Error('Unable to release database advisory lock.')
    }
  }
  try {
    let acquired: number | null | undefined
    try {
      const [rows] = await connection.execute<LockRow[]>(
        `SELECT GET_LOCK(CONCAT(?, LEFT(SHA2(CONCAT(DATABASE(), ?), 256), 32)), 5) AS value`,
        [prefix, key],
      )
      acquired = rows[0]?.value
    } catch (error) {
      destroyed = true
      connection.destroy()
      throw error
    }
    if (acquired !== 1) {
      throw new AdvisoryLockUnavailableError()
    }

    let result: T
    try {
      result = await operation(connection)
    } catch (error) {
      try {
        await release()
      } catch (releaseError) {
        destroyed = true
        connection.destroy()
        throw new AggregateError(
          [error, releaseError],
          'Database operation failed and its advisory lock could not be released.',
        )
      }
      throw error
    }
    try {
      await release()
    } catch (error) {
      destroyed = true
      connection.destroy()
      throw error
    }
    return result
  } finally {
    if (!destroyed) {
      connection.release()
    }
  }
}
