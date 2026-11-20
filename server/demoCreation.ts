import { createHash, randomBytes } from 'node:crypto'
import type { ResultSetHeader, RowDataPacket } from 'mysql2'
import type { Pool, PoolConnection } from 'mysql2/promise'
import { normalizeEmail } from './accountInput.ts'
import { loadDemoActivityLimit } from './activityRepository.ts'
import { createToken, type LoginResult } from './auth.ts'
import {
  AdvisoryLockUnavailableError,
  withDatabaseAdvisoryLock,
} from './mysqlAdvisoryLock.ts'

export interface DemoCreationConfig {
  templateEmail: string
  accountLimit: number
  activityLimit: number
}

export function loadDemoCreationConfig(
  environment: NodeJS.ProcessEnv = process.env,
): DemoCreationConfig {
  const templateEmail = normalizeEmail(environment.DEMO_TEMPLATE_EMAIL)
  if (!templateEmail) {
    throw new Error('DEMO_TEMPLATE_EMAIL must be a valid email address.')
  }
  const accountLimitValue = environment.DEMO_ACCOUNT_LIMIT
  const accountLimit = Number(accountLimitValue)
  if (
    !accountLimitValue ||
    !/^[1-9]\d*$/.test(accountLimitValue) ||
    !Number.isSafeInteger(accountLimit)
  ) {
    throw new Error('DEMO_ACCOUNT_LIMIT must be a positive integer.')
  }
  const activityLimit = loadDemoActivityLimit(environment)
  if (activityLimit === null) {
    throw new Error('DEMO_ACTIVITY_LIMIT must be configured.')
  }
  return { templateEmail, accountLimit, activityLimit }
}

export class DemoCreationError extends Error {
  readonly code:
    | 'account-limit'
    | 'template-unavailable'
    | 'template-too-large'
    | 'lock-unavailable'
    | 'duplicate-request'

  constructor(code: DemoCreationError['code']) {
    super(code)
    this.name = 'DemoCreationError'
    this.code = code
  }
}

type CountRow = RowDataPacket & { count: number }
type IdRow = RowDataPacket & { id: number }

export function hashDemoStartKey(value: unknown): Buffer | null {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value)) {
    return null
  }
  const decoded = Buffer.from(value, 'base64url')
  if (decoded.length !== 32 || decoded.toString('base64url') !== value) {
    return null
  }
  return createHash('sha256').update(decoded).digest()
}

export class MySqlDemoCreator {
  private readonly pool: Pool
  private readonly config: DemoCreationConfig

  constructor(pool: Pool, config: DemoCreationConfig) {
    const validated = loadDemoCreationConfig({
      DEMO_TEMPLATE_EMAIL: config.templateEmail,
      DEMO_ACCOUNT_LIMIT: String(config.accountLimit),
      DEMO_ACTIVITY_LIMIT: String(config.activityLimit),
    })
    this.pool = pool
    this.config = validated
  }

  async createDemo(requestKey: string): Promise<LoginResult> {
    const requestHash = hashDemoStartKey(requestKey)
    if (!requestHash) {
      throw new Error('A valid demo idempotency key is required.')
    }
    try {
      return await withDatabaseAdvisoryLock(
        this.pool,
        'twc:demo-create:',
        '',
        (connection) => this.createWithinTransaction(connection, requestHash),
      )
    } catch (error) {
      if (error instanceof AdvisoryLockUnavailableError) {
        throw new DemoCreationError('lock-unavailable')
      }
      throw error
    }
  }

  private async createWithinTransaction(
    connection: PoolConnection,
    requestHash: Buffer,
  ): Promise<LoginResult> {
    await connection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ')
    await connection.beginTransaction()
    try {
      const [requests] = await connection.execute<IdRow[]>(
        'SELECT account_id AS id FROM demo_start_requests WHERE request_hash = ? FOR UPDATE',
        [requestHash],
      )
      if (requests.length !== 0) {
        throw new DemoCreationError('duplicate-request')
      }
      const [counts] = await connection.query<CountRow[]>(
        "SELECT COUNT(*) AS count FROM `account` WHERE kind = 'demo'",
      )
      if (counts[0].count >= this.config.accountLimit) {
        throw new DemoCreationError('account-limit')
      }

      const [templates] = await connection.execute<IdRow[]>(
        `SELECT id FROM \`account\`
          WHERE username = ? AND kind = 'regular' AND disabled_at IS NULL
            AND email_verified_at IS NOT NULL
          FOR UPDATE`,
        [this.config.templateEmail],
      )
      if (!templates[0]) {
        throw new DemoCreationError('template-unavailable')
      }
      const templateId = templates[0].id
      const [activities] = await connection.execute<IdRow[]>(
        `SELECT id FROM work_search_activities
          WHERE account_id = ? LIMIT ? FOR UPDATE`,
        [templateId, this.config.activityLimit + 1],
      )
      if (activities.length > this.config.activityLimit) {
        throw new DemoCreationError('template-too-large')
      }

      const username = `demo-${randomBytes(24).toString('hex')}@demo.invalid`
      const [account] = await connection.execute<ResultSetHeader>(
        `INSERT INTO \`account\` (username, password_hash, kind)
          VALUES (?, '!demo-password-disabled', 'demo')`,
        [username],
      )
      const accountId = account.insertId
      await connection.execute(
        'INSERT INTO demo_start_requests (request_hash, account_id) VALUES (?, ?)',
        [requestHash, accountId],
      )
      const [copied] = await connection.execute<ResultSetHeader>(
        `INSERT INTO work_search_activities (
            account_id, activity_date, job_source, job_source_url, job_title,
            employer_name, employer_address1, employer_address2, employer_city,
            employer_state, employer_zip, employer_phone, employer_contact,
            employer_email, hiring_result, start_date, application_filed,
            result_other, notes
          )
          SELECT ?, activity_date, job_source, job_source_url, job_title,
            employer_name, employer_address1, employer_address2, employer_city,
            employer_state, employer_zip, employer_phone, employer_contact,
            employer_email, hiring_result, start_date, application_filed,
            result_other, notes
          FROM work_search_activities WHERE account_id = ?`,
        [accountId, templateId],
      )
      if (copied.affectedRows !== activities.length) {
        throw new Error('Template activities changed during demo creation.')
      }

      await connection.execute(
        `INSERT INTO demo_instances (account_id, expires_at)
          VALUES (?, DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL 5 MINUTE))`,
        [accountId],
      )
      const { token, tokenHash } = createToken()
      await connection.execute(
        `INSERT INTO sessions (account_id, token_hash, expires_at)
          SELECT account_id, ?, expires_at FROM demo_instances WHERE account_id = ?`,
        [tokenHash, accountId],
      )
      await connection.commit()
      return {
        user: { id: accountId, username: 'Demo', kind: 'demo' },
        sessionToken: token,
      }
    } catch (error) {
      try {
        await connection.rollback()
      } catch (rollbackError) {
        connection.destroy()
        throw new AggregateError(
          [error, rollbackError],
          'Demo creation failed and its transaction could not be rolled back.',
        )
      }
      throw error
    }
  }
}
