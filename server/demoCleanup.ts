import type { ResultSetHeader, RowDataPacket } from 'mysql2'
import type { Connection } from 'mysql2/promise'

const batchSize = 50

interface LockRow extends RowDataPacket {
  acquired: number | null
}

interface AccountIdRow extends RowDataPacket {
  account_id: number
}

interface AccountKindRow extends RowDataPacket {
  kind: 'regular' | 'demo'
}

interface EligibilityRow extends RowDataPacket {
  eligible: number
}

interface CountRow extends RowDataPacket {
  count: number
}

async function releaseCleanupLock(connection: Connection): Promise<void> {
  const [locks] = await connection.query<
    (RowDataPacket & { released: number | null })[]
  >(
    `SELECT RELEASE_LOCK(CONCAT('twc:demo-cleanup:', LEFT(SHA2(DATABASE(), 256), 32))) AS released`,
  )
  if (locks[0]?.released !== 1) {
    throw new Error('Unable to release the demo cleanup lock.')
  }
}

export async function cleanupExpiredDemos(
  connection: Connection,
): Promise<{ removed: number; remaining: number }> {
  const [locks] = await connection.query<LockRow[]>(
    `SELECT GET_LOCK(CONCAT('twc:demo-cleanup:', LEFT(SHA2(DATABASE(), 256), 32)), 0) AS acquired`,
  )
  if (locks[0]?.acquired !== 1) {
    throw new Error(
      'Another demo cleanup is running or the lock is unavailable.',
    )
  }

  let result: { removed: number; remaining: number }
  try {
    result = await cleanupBatch(connection)
  } catch (error) {
    try {
      await releaseCleanupLock(connection)
    } catch (releaseError) {
      throw new AggregateError(
        [error, releaseError],
        'Demo cleanup failed and its lock could not be released.',
      )
    }
    throw error
  }
  await releaseCleanupLock(connection)
  return result
}

async function cleanupBatch(
  connection: Connection,
): Promise<{ removed: number; remaining: number }> {
  const [candidates] = await connection.execute<AccountIdRow[]>(
    `SELECT d.account_id
        FROM demo_instances AS d
        INNER JOIN \`account\` AS a ON a.id = d.account_id
        WHERE a.kind = 'demo'
          AND (d.ended_at IS NOT NULL OR d.expires_at <= CURRENT_TIMESTAMP(3))
        ORDER BY d.account_id
        LIMIT ?`,
    [batchSize],
  )
  let removed = 0

  for (const candidate of candidates) {
    await connection.beginTransaction()
    try {
      const [accounts] = await connection.execute<AccountKindRow[]>(
        'SELECT kind FROM `account` WHERE id = ? FOR UPDATE',
        [candidate.account_id],
      )
      if (accounts[0]?.kind !== 'demo') {
        await connection.commit()
        continue
      }

      const [instances] = await connection.execute<EligibilityRow[]>(
        `SELECT (ended_at IS NOT NULL OR expires_at <= CURRENT_TIMESTAMP(3)) AS eligible
            FROM demo_instances WHERE account_id = ? FOR UPDATE`,
        [candidate.account_id],
      )
      if (instances[0]?.eligible !== 1) {
        await connection.commit()
        continue
      }

      await connection.execute(
        'DELETE FROM work_search_activities WHERE account_id = ?',
        [candidate.account_id],
      )
      const [result] = await connection.execute<ResultSetHeader>(
        "DELETE FROM `account` WHERE id = ? AND kind = 'demo'",
        [candidate.account_id],
      )
      if (result.affectedRows !== 1) {
        throw new Error('Demo account changed during cleanup.')
      }
      await connection.commit()
      removed += 1
    } catch (error) {
      await connection.rollback()
      throw error
    }
  }

  const [counts] = await connection.query<CountRow[]>(
    `SELECT COUNT(*) AS count
        FROM demo_instances AS d
        INNER JOIN \`account\` AS a ON a.id = d.account_id
        WHERE a.kind = 'demo'
          AND (d.ended_at IS NOT NULL OR d.expires_at <= CURRENT_TIMESTAMP(3))`,
  )
  return { removed, remaining: counts[0].count }
}
