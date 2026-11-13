import type { RowDataPacket } from 'mysql2'
import type { Pool, ResultSetHeader } from 'mysql2/promise'
import type { ActivityInput } from './activityInput.ts'

export interface ActivityRecord extends ActivityInput {
  id: number
}

export interface ActivityRepository {
  createActivity(activity: ActivityInput): Promise<number>
  updateActivity(id: number, activity: ActivityInput): Promise<boolean>
  listActivities(page: number, pageSize: number): Promise<ActivityPage>
  getActivitiesByIds(ids: number[]): Promise<ActivityRecord[]>
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

  constructor(pool: Pool) {
    this.pool = pool
  }

  async createActivity(activity: ActivityInput): Promise<number> {
    const [result] = await this.pool.execute<ResultSetHeader>(
      `INSERT INTO work_search_activities (
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
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      ],
    )

    return result.insertId
  }

  async updateActivity(id: number, activity: ActivityInput): Promise<boolean> {
    const [result] = await this.pool.execute<ResultSetHeader>(
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
      WHERE id = ?`,
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
      ],
    )

    if (result.affectedRows > 0) {
      return true
    }

    const [rows] = await this.pool.execute<ActivityRow[]>(
      'SELECT id FROM work_search_activities WHERE id = ? LIMIT 1',
      [id],
    )
    return rows.length > 0
  }

  async listActivities(page: number, pageSize: number): Promise<ActivityPage> {
    const [countRows] = await this.pool.execute<ActivityCountRow[]>(
      'SELECT COUNT(*) AS totalRecords FROM work_search_activities',
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
      ORDER BY activity_date DESC, employer_name ASC, job_title ASC, id DESC
      LIMIT ? OFFSET ?`,
      [pageSize, offset],
    )

    return {
      activities: rows.map(mapActivityRow),
      page: currentPage,
      pageSize,
      totalRecords,
      totalPages,
    }
  }

  async getActivitiesByIds(ids: number[]): Promise<ActivityRecord[]> {
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
      WHERE id IN (${placeholders})
      ORDER BY activity_date DESC, employer_name ASC, job_title ASC, id DESC`,
      ids,
    )

    return rows.map(mapActivityRow)
  }
}
