import { createPool } from 'mysql2/promise'

function requiredEnvironmentValue(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`${name} must be configured in the local environment.`)
  }
  return value
}

export function createDatabasePool() {
  const port = Number(process.env.DB_PORT ?? 3306)
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('DB_PORT must be an integer between 1 and 65535.')
  }

  return createPool({
    host: process.env.DB_HOST ?? '127.0.0.1',
    port,
    database: process.env.DB_NAME ?? 'twc',
    user: requiredEnvironmentValue('DB_USER'),
    password: requiredEnvironmentValue('DB_PASSWORD'),
    waitForConnections: true,
    connectionLimit: 5,
    dateStrings: true,
  })
}
