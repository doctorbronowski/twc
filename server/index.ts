import { MySqlActivityRepository } from './activityRepository.ts'
import { createApp } from './app.ts'
import { createDatabasePool } from './database.ts'

const host = process.env.API_HOST ?? '127.0.0.1'
const port = Number(process.env.API_PORT ?? 3002)

if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error('API_PORT must be an integer between 1 and 65535.')
}

const pool = createDatabasePool()
await pool.query('SELECT 1')
const app = createApp(new MySqlActivityRepository(pool))

const server = app.listen(port, host, () => {
  console.log(`TWC API listening on http://${host}:${port}`)
})

server.on('error', (error) => {
  console.error('Unable to start TWC API:', error.message)
  process.exitCode = 1
  void pool.end()
})
