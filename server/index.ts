import { fileURLToPath } from 'node:url'
import { MySqlActivityRepository } from './activityRepository.ts'
import { createApp } from './app.ts'
import { loadAuthConfig } from './auth.ts'
import { createDatabasePool } from './database.ts'

const isProduction = process.env.NODE_ENV === 'production'
const host = isProduction ? undefined : (process.env.API_HOST ?? '127.0.0.1')
const portValue = isProduction
  ? (process.env.PORT ?? '3000')
  : (process.env.API_PORT ?? '3002')

if (!portValue) {
  throw new Error('Application port is not configured.')
}

const port = Number(portValue)
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error(
    `${isProduction ? 'PORT' : 'API_PORT'} must be an integer between 1 and 65535.`,
  )
}

const authConfig = loadAuthConfig()
const pool = createDatabasePool()
await pool.query('SELECT 1')
const app = createApp(new MySqlActivityRepository(pool), authConfig, {
  staticDirectory: isProduction
    ? fileURLToPath(new URL('../dist/', import.meta.url))
    : undefined,
})

const server = host
  ? app.listen(port, host, () => {
      console.log(`TWC API listening on http://${host}:${port}`)
    })
  : app.listen(port, () => {
      console.log(`TWC application listening on port ${port}`)
    })

server.on('error', (error) => {
  console.error('Unable to start TWC application:', error.message)
  process.exitCode = 1
  void pool.end()
})
