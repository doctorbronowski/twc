import type { RowDataPacket } from 'mysql2'
import { createConnection } from 'mysql2/promise'
import {
  accountSchemaStatements,
  activitySchemaStatement,
  isUnsignedIntColumnType,
} from './databaseSchema.ts'

function requiredEnvironmentValue(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`${name} is required to set up the local database.`)
  }
  return value
}

const host = process.env.DB_HOST ?? '127.0.0.1'
const port = Number(process.env.DB_PORT ?? 3306)
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error('DB_PORT must be an integer between 1 and 65535.')
}

const database = process.env.DB_NAME ?? 'twc'
if (database !== 'twc') {
  throw new Error('The setup script only manages the twc database.')
}

const runtimeUser = process.env.DB_USER ?? 'twc_app'
if (runtimeUser !== 'twc_app') {
  throw new Error('The setup script only manages the twc_app database account.')
}

const runtimePassword = requiredEnvironmentValue('DB_PASSWORD')
const connection = await createConnection({
  host,
  port,
  user: requiredEnvironmentValue('DB_ADMIN_USER'),
  password: requiredEnvironmentValue('DB_ADMIN_PASSWORD'),
})

interface ColumnNameRow extends RowDataPacket {
  COLUMN_NAME: string
}

interface ActivityAccountColumnRow extends RowDataPacket {
  COLUMN_TYPE: string
}

interface AccountDisabledColumnRow extends RowDataPacket {
  COLUMN_TYPE: string
  IS_NULLABLE: 'YES' | 'NO'
}

interface AccountKindColumnRow extends RowDataPacket {
  COLUMN_TYPE: string
  IS_NULLABLE: 'YES' | 'NO'
  COLUMN_DEFAULT: string | null
}

async function renameActivityColumn(previousName: string, newName: string) {
  const [columns] = await connection.execute<ColumnNameRow[]>(
    `SELECT COLUMN_NAME
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
        AND COLUMN_NAME IN (?, ?)`,
    ['twc', 'work_search_activities', previousName, newName],
  )

  const hasPreviousName = columns.some(
    (column) => column.COLUMN_NAME === previousName,
  )
  const hasNewName = columns.some((column) => column.COLUMN_NAME === newName)

  if (hasPreviousName && hasNewName) {
    throw new Error(
      `Both ${previousName} and ${newName} exist in work_search_activities; resolve the duplicate columns before continuing.`,
    )
  }

  if (!hasPreviousName && !hasNewName) {
    throw new Error(
      `Neither ${previousName} nor ${newName} exists in work_search_activities.`,
    )
  }

  if (hasPreviousName) {
    await connection.query(
      `ALTER TABLE work_search_activities CHANGE COLUMN \`${previousName}\` \`${newName}\` VARCHAR(255) NULL`,
    )
  }
}

async function ensureJobSourceUrlColumn() {
  const [columns] = await connection.execute<ColumnNameRow[]>(
    `SELECT COLUMN_NAME
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    ['twc', 'work_search_activities', 'job_source_url'],
  )

  if (columns.length === 0) {
    await connection.query(
      'ALTER TABLE work_search_activities ADD COLUMN job_source_url VARCHAR(2048) NULL AFTER job_source',
    )
  }
}

async function ensureActivityAccountIdColumn() {
  const [columns] = await connection.execute<ActivityAccountColumnRow[]>(
    `SELECT COLUMN_TYPE
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    ['twc', 'work_search_activities', 'account_id'],
  )

  if (columns.length === 0) {
    await connection.query(
      'ALTER TABLE work_search_activities ADD COLUMN account_id INT UNSIGNED NULL AFTER id',
    )
  } else if (!isUnsignedIntColumnType(columns[0].COLUMN_TYPE)) {
    throw new Error(
      'work_search_activities.account_id must be INT UNSIGNED; resolve the existing column before continuing.',
    )
  }
}

async function ensureActivityAccountIdIndex() {
  const [indexes] = await connection.execute<
    (RowDataPacket & { INDEX_NAME: string })[]
  >(
    `SELECT INDEX_NAME
      FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?
        AND SEQ_IN_INDEX = 1`,
    ['twc', 'work_search_activities', 'account_id'],
  )

  if (indexes.length === 0) {
    await connection.query(
      'CREATE INDEX idx_work_search_activities_account_id ON work_search_activities (account_id)',
    )
  }
}

async function ensurePendingEmailColumn() {
  const [columns] = await connection.execute<ColumnNameRow[]>(
    `SELECT COLUMN_NAME
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    ['twc', 'account', 'pending_email'],
  )

  if (columns.length === 0) {
    await connection.query(
      'ALTER TABLE `account` ADD COLUMN pending_email VARCHAR(254) NULL AFTER username',
    )
  }
}

async function ensurePendingEmailIndex() {
  const [indexes] = await connection.execute<
    (RowDataPacket & { INDEX_NAME: string })[]
  >(
    `SELECT INDEX_NAME
      FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?
        AND NON_UNIQUE = 0 AND SEQ_IN_INDEX = 1`,
    ['twc', 'account', 'pending_email'],
  )

  if (indexes.length === 0) {
    await connection.query(
      'CREATE UNIQUE INDEX uq_account_pending_email ON `account` (pending_email)',
    )
  }
}

async function ensureAccountDisabledAtColumn() {
  const [columns] = await connection.execute<AccountDisabledColumnRow[]>(
    `SELECT COLUMN_TYPE, IS_NULLABLE
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    ['twc', 'account', 'disabled_at'],
  )

  if (columns.length === 0) {
    await connection.query(
      'ALTER TABLE `account` ADD COLUMN disabled_at DATETIME(3) NULL AFTER email_verified_at',
    )
  } else if (
    !/^datetime(?:\(3\))?$/i.test(columns[0].COLUMN_TYPE) ||
    columns[0].IS_NULLABLE !== 'YES'
  ) {
    throw new Error(
      'account.disabled_at must be a nullable DATETIME(3); resolve the existing column before continuing.',
    )
  }
}

async function ensureAccountKindColumn() {
  const [columns] = await connection.execute<AccountKindColumnRow[]>(
    `SELECT COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    ['twc', 'account', 'kind'],
  )

  if (columns.length === 0) {
    await connection.query(
      "ALTER TABLE `account` ADD COLUMN kind ENUM('regular', 'demo') NOT NULL DEFAULT 'regular' AFTER password_hash",
    )
  } else if (
    columns[0].COLUMN_TYPE.toLowerCase() !== "enum('regular','demo')" ||
    columns[0].IS_NULLABLE !== 'NO' ||
    !['regular', "'regular'"].includes(columns[0].COLUMN_DEFAULT ?? '')
  ) {
    throw new Error(
      "account.kind must be ENUM('regular', 'demo') NOT NULL DEFAULT 'regular'; resolve the existing column before continuing.",
    )
  }
}

try {
  await connection.query(
    'CREATE DATABASE IF NOT EXISTS `twc` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci',
  )
  await connection.changeUser({ database: 'twc' })

  await connection.query(activitySchemaStatement)
  await renameActivityColumn('work_search_type', 'job_source')
  await renameActivityColumn('job_type', 'job_title')
  await ensureJobSourceUrlColumn()
  for (const statement of accountSchemaStatements) {
    await connection.query(statement)
  }
  await ensurePendingEmailColumn()
  await ensurePendingEmailIndex()
  await ensureAccountDisabledAtColumn()
  await ensureAccountKindColumn()
  await ensureActivityAccountIdColumn()
  await ensureActivityAccountIdIndex()
  await connection.query(
    `CREATE USER IF NOT EXISTS 'twc_app'@'127.0.0.1' IDENTIFIED BY ${connection.escape(runtimePassword)}`,
  )
  await connection.query(
    "GRANT SELECT, INSERT, UPDATE, DELETE ON `twc`.`work_search_activities` TO 'twc_app'@'127.0.0.1'",
  )
  await connection.query(
    "GRANT SELECT, INSERT, UPDATE ON `twc`.`account` TO 'twc_app'@'127.0.0.1'",
  )
  await connection.query(
    "GRANT SELECT, INSERT, UPDATE, DELETE ON `twc`.`account_email_verification_tokens` TO 'twc_app'@'127.0.0.1'",
  )
  await connection.query(
    "GRANT SELECT, INSERT, UPDATE, DELETE ON `twc`.`account_email_change_tokens` TO 'twc_app'@'127.0.0.1'",
  )
  await connection.query(
    "GRANT SELECT, INSERT, UPDATE, DELETE ON `twc`.`account_password_reset_tokens` TO 'twc_app'@'127.0.0.1'",
  )
  await connection.query(
    "GRANT SELECT, INSERT, UPDATE, DELETE ON `twc`.`sessions` TO 'twc_app'@'127.0.0.1'",
  )
  await connection.query(
    "GRANT SELECT, INSERT, UPDATE ON `twc`.`demo_instances` TO 'twc_app'@'127.0.0.1'",
  )
  await connection.query(
    "GRANT SELECT, INSERT, DELETE ON `twc`.`demo_start_attempts` TO 'twc_app'@'127.0.0.1'",
  )
  await connection.query(
    "GRANT SELECT, INSERT ON `twc`.`demo_start_requests` TO 'twc_app'@'127.0.0.1'",
  )

  console.log(
    'Database twc schema is ready. Owner bootstrap and auth enforcement are required before user traffic.',
  )
} finally {
  await connection.end()
}
