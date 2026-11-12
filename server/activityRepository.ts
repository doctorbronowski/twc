import type { Pool, ResultSetHeader } from 'mysql2/promise'
import type { ActivityInput } from './activityInput.ts'

export interface ActivityRepository {
  createActivity(activity: ActivityInput): Promise<number>
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
        work_search_type,
        job_type,
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
        activity.work_search_type,
        activity.job_type,
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
}
