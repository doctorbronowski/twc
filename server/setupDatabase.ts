import { readFile } from 'node:fs/promises'
import type { RowDataPacket } from 'mysql2'
import { createConnection } from 'mysql2/promise'

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

try {
  await connection.query(
    'CREATE DATABASE IF NOT EXISTS `twc` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci',
  )
  await connection.changeUser({ database: 'twc' })

  const migration = await readFile(
    new URL(
      './migrations/001_create_work_search_activities.sql',
      import.meta.url,
    ),
    'utf8',
  )
  await connection.query(migration)
  await renameActivityColumn('work_search_type', 'job_source')
  await renameActivityColumn('job_type', 'job_title')
  await connection.query(
    `CREATE USER IF NOT EXISTS 'twc_app'@'127.0.0.1' IDENTIFIED BY ${connection.escape(runtimePassword)}`,
  )
  await connection.query(
    "GRANT SELECT, INSERT ON `twc`.`work_search_activities` TO 'twc_app'@'127.0.0.1'",
  )

  console.log('Database twc and work_search_activities table are ready.')
} finally {
  await connection.end()
}
