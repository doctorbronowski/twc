import type { RowDataPacket } from 'mysql2'
import type { Pool, PoolConnection, ResultSetHeader } from 'mysql2/promise'
import type { ActivityInput } from './activityInput.ts'

export interface DemoWriteContext {
  sessionId: number
}

export class DemoActivityError extends Error {
  readonly code: 'session-expired' | 'activity-limit'

  constructor(code: 'session-expired' | 'activity-limit') {
    super(code)
    this.name = 'DemoActivityError'
    this.code = code
  }
}

export function loadDemoActivityLimit(
  environment: NodeJS.ProcessEnv = process.env,
): number | null {
  const value = environment.DEMO_ACTIVITY_LIMIT
  if (value === undefined) {
    return null
  }
  const limit = Number(value)
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(limit)) {
    throw new Error('DEMO_ACTIVITY_LIMIT must be a positive integer.')
  }
  return limit
}

export interface ActivityRecord extends ActivityInput {
  id: number
}

export interface ActivityRepository {
  createActivity(
    accountId: number,
    activity: ActivityInput,
    demo?: DemoWriteContext,
  ): Promise<number>
  updateActivity(
    accountId: number,
    id: number,
    activity: ActivityInput,
    demo?: DemoWriteContext,
  ): Promise<boolean>
  deleteActivity(
    accountId: number,
    id: number,
    demo?: DemoWriteContext,
  ): Promise<boolean>
  listActivities(
    accountId: number,
    page: number,
    pageSize: number,
  ): Promise<ActivityPage>
  getActivitiesByIds(
    accountId: number,
    ids: number[],
  ): Promise<ActivityRecord[]>
}

export interface ActivityPage {
  activities: ActivityRecord[]
  page: number
  pageSize: number
  totalRecords: number
  totalPages: number
}

interface ActivityRow extends RowDataPacket {
  id: number
  activity_date: string | null
  job_source: string | null
  job_source_url: string | null
  job_title: string | null
  employer_name: string | null
  employer_address1: string | null
  employer_address2: string | null
  employer_city: string | null
  employer_state: string | null
  employer_zip: string | null
  employer_phone: string | null
  employer_contact: string | null
  employer_email: string | null
  hiring_result: ActivityInput['hiring_result']
  start_date: string | null
  application_filed: number
  result_other: string | null
  notes: string | null
}

interface ActivityCountRow extends RowDataPacket {
  totalRecords: number
}

interface ActivityIdRow extends RowDataPacket {
  id: number
}

function mapActivityRow(row: ActivityRow): ActivityRecord {
  return {
    id: row.id,
    activity_date: row.activity_date,
    job_source: row.job_source,
    job_source_url: row.job_source_url,
    job_title: row.job_title,
    employer_name: row.employer_name,
    employer_address1: row.employer_address1,
    employer_address2: row.employer_address2,
    employer_city: row.employer_city,
    employer_state: row.employer_state,
    employer_zip: row.employer_zip,
    employer_phone: row.employer_phone,
    employer_contact: row.employer_contact,
    employer_email: row.employer_email,
    hiring_result: row.hiring_result,
    start_date: row.start_date,
    application_filed: Boolean(row.application_filed),
    result_other: row.result_other,
    notes: row.notes,
  }
}

export class MySqlActivityRepository implements ActivityRepository {
  private readonly pool: Pool
  private readonly demoActivityLimit: number | null

  constructor(pool: Pool, demoActivityLimit: number | null = null) {
    this.pool = pool
    if (
      demoActivityLimit !== null &&
      (!Number.isSafeInteger(demoActivityLimit) || demoActivityLimit < 1)
    ) {
      throw new Error('DEMO_ACTIVITY_LIMIT must be a positive integer.')
    }
    this.demoActivityLimit = demoActivityLimit
  }

  private async assertActiveDemo(
    connection: PoolConnection,
    accountId: number,
    demo: DemoWriteContext,
  ): Promise<void> {
    const [rows] = await connection.execute<ActivityIdRow[]>(
      `SELECT s.id FROM sessions AS s
        INNER JOIN demo_instances AS d ON d.account_id = s.account_id
        WHERE s.account_id = ? AND s.id = ?
          AND s.expires_at > CURRENT_TIMESTAMP(3)
          AND d.ended_at IS NULL AND d.expires_at > CURRENT_TIMESTAMP(3)
        FOR UPDATE`,
      [accountId, demo.sessionId],
    )
    if (rows.length === 0) {
      throw new DemoActivityError('session-expired')
    }
  }

  private async writeActivity<T>(
    accountId: number,
    demo: DemoWriteContext | undefined,
    create: boolean,
    write: (
      connection: Pool | PoolConnection,
      activeDemoPredicate: string,
      activeDemoParameters: number[],
      recheckDemo: (() => Promise<void>) | null,
    ) => Promise<T>,
  ): Promise<T> {
    if (!demo) {
      return write(this.pool, '', [], null)
    }
    if (this.demoActivityLimit === null) {
      throw new Error('DEMO_ACTIVITY_LIMIT must be configured for demo writes.')
    }

    const connection = await this.pool.getConnection()
    try {
      await connection.beginTransaction()
      const [accounts] = await connection.execute<ActivityIdRow[]>(
        `SELECT id FROM \`account\`
          WHERE id = ? AND kind = 'demo' AND disabled_at IS NULL FOR UPDATE`,
        [accountId],
      )
      if (accounts.length === 0) {
        throw new DemoActivityError('session-expired')
      }
      await this.assertActiveDemo(connection, accountId, demo)
      if (create) {
        const [counts] = await connection.execute<ActivityCountRow[]>(
          'SELECT COUNT(*) AS totalRecords FROM work_search_activities WHERE account_id = ?',
          [accountId],
        )
        if (counts[0].totalRecords >= this.demoActivityLimit) {
          throw new DemoActivityError('activity-limit')
        }
      }
      const predicate = `EXISTS (
        SELECT 1 FROM sessions AS s
        INNER JOIN demo_instances AS d ON d.account_id = s.account_id
        WHERE s.account_id = ? AND s.id = ?
          AND s.expires_at > CURRENT_TIMESTAMP(3)
          AND d.ended_at IS NULL AND d.expires_at > CURRENT_TIMESTAMP(3)
      )`
      const result = await write(
        connection,
        predicate,
        [accountId, demo.sessionId],
        () => this.assertActiveDemo(connection, accountId, demo),
      )
      await this.assertActiveDemo(connection, accountId, demo)
      await connection.commit()
      return result
    } catch (error) {
      await connection.rollback()
      throw error
    } finally {
      connection.release()
    }
  }

  async createActivity(
    accountId: number,
    activity: ActivityInput,
    demo?: DemoWriteContext,
  ): Promise<number> {
    return this.writeActivity(
      accountId,
      demo,
      true,
      async (connection, predicate, parameters) => {
        const [result] = await connection.execute<ResultSetHeader>(
          `INSERT INTO work_search_activities (
        account_id,
        activity_date,
        job_source,
        job_source_url,
        job_title,
        employer_name,
        employer_address1,
        employer_address2,
        employer_city,
        employer_state,
        employer_zip,
        employer_phone,
        employer_contact,
        employer_email,
        hiring_result,
        start_date,
        application_filed,
        result_other,
        notes
      ) ${predicate ? 'SELECT' : 'VALUES ('} ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?${predicate ? ` WHERE ${predicate}` : ')'}`,
          [
            accountId,
            activity.activity_date,
            activity.job_source,
            activity.job_source_url,
            activity.job_title,
            activity.employer_name,
            activity.employer_address1,
            activity.employer_address2,
            activity.employer_city,
            activity.employer_state,
            activity.employer_zip,
            activity.employer_phone,
            activity.employer_contact,
            activity.employer_email,
            activity.hiring_result,
            activity.start_date,
            activity.application_filed,
            activity.result_other,
            activity.notes,
            ...parameters,
          ],
        )

        if (result.affectedRows === 0) {
          throw new DemoActivityError('session-expired')
        }
        return result.insertId
      },
    )
  }

  async updateActivity(
    accountId: number,
    id: number,
    activity: ActivityInput,
    demo?: DemoWriteContext,
  ): Promise<boolean> {
    return this.writeActivity(
      accountId,
      demo,
      false,
      async (connection, predicate, parameters, recheckDemo) => {
        const [result] = await connection.execute<ResultSetHeader>(
          `UPDATE work_search_activities SET
        activity_date = ?,
        job_source = ?,
        job_source_url = ?,
        job_title = ?,
        employer_name = ?,
        employer_address1 = ?,
        employer_address2 = ?,
        employer_city = ?,
        employer_state = ?,
        employer_zip = ?,
        employer_phone = ?,
        employer_contact = ?,
        employer_email = ?,
        hiring_result = ?,
        start_date = ?,
        application_filed = ?,
        result_other = ?,
        notes = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND account_id = ?${predicate ? ` AND ${predicate}` : ''}`,
          [
            activity.activity_date,
            activity.job_source,
            activity.job_source_url,
            activity.job_title,
            activity.employer_name,
            activity.employer_address1,
            activity.employer_address2,
            activity.employer_city,
            activity.employer_state,
            activity.employer_zip,
            activity.employer_phone,
            activity.employer_contact,
            activity.employer_email,
            activity.hiring_result,
            activity.start_date,
            activity.application_filed,
            activity.result_other,
            activity.notes,
            id,
            accountId,
            ...parameters,
          ],
        )

        if (result.affectedRows > 0) {
          return true
        }

        if (recheckDemo) {
          await recheckDemo()
        }
        const [rows] = await connection.execute<ActivityIdRow[]>(
          'SELECT id FROM work_search_activities WHERE id = ? AND account_id = ? LIMIT 1',
          [id, accountId],
        )
        return rows.length > 0
      },
    )
  }

  async deleteActivity(
    accountId: number,
    id: number,
    demo?: DemoWriteContext,
  ): Promise<boolean> {
    return this.writeActivity(
      accountId,
      demo,
      false,
      async (connection, predicate, parameters, recheckDemo) => {
        const [result] = await connection.execute<ResultSetHeader>(
          `DELETE FROM work_search_activities WHERE id = ? AND account_id = ?${predicate ? ` AND ${predicate}` : ''}`,
          [id, accountId, ...parameters],
        )
        if (result.affectedRows === 0 && recheckDemo) {
          await recheckDemo()
        }
        return result.affectedRows > 0
      },
    )
  }

  async listActivities(
    accountId: number,
    page: number,
    pageSize: number,
  ): Promise<ActivityPage> {
    const [countRows] = await this.pool.execute<ActivityCountRow[]>(
      `SELECT COUNT(*) AS totalRecords
        FROM work_search_activities
        WHERE account_id = ?`,
      [accountId],
    )
    const totalRecords = countRows[0].totalRecords
    const totalPages = Math.ceil(totalRecords / pageSize)
    const currentPage = Math.min(page, Math.max(totalPages, 1))
    const offset = (currentPage - 1) * pageSize
    const [rows] = await this.pool.execute<ActivityRow[]>(
      `SELECT
        id,
        activity_date,
        job_source,
        job_source_url,
        job_title,
        employer_name,
        employer_address1,
        employer_address2,
        employer_city,
        employer_state,
        employer_zip,
        employer_phone,
        employer_contact,
        employer_email,
        hiring_result,
        start_date,
        application_filed,
        result_other,
        notes
      FROM work_search_activities
      WHERE account_id = ?
      ORDER BY activity_date DESC, employer_name ASC, job_title ASC, id DESC
      LIMIT ? OFFSET ?`,
      [accountId, pageSize, offset],
    )

    return {
      activities: rows.map(mapActivityRow),
      page: currentPage,
      pageSize,
      totalRecords,
      totalPages,
    }
  }

  async getActivitiesByIds(
    accountId: number,
    ids: number[],
  ): Promise<ActivityRecord[]> {
    if (ids.length === 0) {
      return []
    }

    const placeholders = ids.map(() => '?').join(', ')
    const [rows] = await this.pool.execute<ActivityRow[]>(
      `SELECT
        id,
        activity_date,
        job_source,
        job_source_url,
        job_title,
        employer_name,
        employer_address1,
        employer_address2,
        employer_city,
        employer_state,
        employer_zip,
        employer_phone,
        employer_contact,
        employer_email,
        hiring_result,
        start_date,
        application_filed,
        result_other,
        notes
      FROM work_search_activities
      WHERE account_id = ? AND id IN (${placeholders})
      ORDER BY activity_date DESC, employer_name ASC, job_title ASC, id DESC`,
      [accountId, ...ids],
    )

    return rows.map(mapActivityRow)
  }
}
