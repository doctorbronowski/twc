import { createConnection } from 'mysql2/promise'
import { cleanupExpiredDemos } from './demoCleanup.ts'

function requiredValue(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`${name} must be configured for demo cleanup.`)
  }
  return value
}

const port = Number(requiredValue('DEMO_CLEANUP_DB_PORT'))
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error(
    'DEMO_CLEANUP_DB_PORT must be an integer between 1 and 65535.',
  )
}

const user = requiredValue('DEMO_CLEANUP_DB_USER')
if (process.env.DB_USER && process.env.DB_USER === user) {
  throw new Error('Demo cleanup must use a separate database user.')
}

const connection = await createConnection({
  host: requiredValue('DEMO_CLEANUP_DB_HOST'),
  port,
  database: requiredValue('DEMO_CLEANUP_DB_NAME'),
  user,
  password: requiredValue('DEMO_CLEANUP_DB_PASSWORD'),
})

try {
  const result = await cleanupExpiredDemos(connection)
  console.log(
    `Demo cleanup complete: ${result.removed} removed, ${result.remaining} eligible remaining.`,
  )
} finally {
  await connection.end()
}
