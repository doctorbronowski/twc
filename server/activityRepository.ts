import type { RowDataPacket } from 'mysql2'
import type { Pool, ResultSetHeader } from 'mysql2/promise'
import type { ActivityInput } from './activityInput.ts'

export interface ActivityRecord extends ActivityInput {
  id: number
}

export interface ActivityRepository {
  createActivity(activity: ActivityInput): Promise<number>
  listActivities(): Promise<ActivityRecord[]>
}

interface ActivityRow extends RowDataPacket {
  id: number
  activity_date: string | null
  job_source: string | null
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
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        activity.activity_date,
        activity.job_source,
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

  async listActivities(): Promise<ActivityRecord[]> {
    const [rows] = await this.pool.execute<ActivityRow[]>(
      `SELECT
        id,
        activity_date,
        job_source,
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
      LIMIT 50`,
    )

    return rows.map((row) => ({
      id: row.id,
      activity_date: row.activity_date,
      job_source: row.job_source,
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
    }))
  }
}
