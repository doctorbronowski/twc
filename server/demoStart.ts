import type { Request } from 'express'
import type { Pool } from 'mysql2/promise'
import type { LoginResult } from './auth.ts'
import type { RateLimitResult } from './authRateLimiter.ts'
import { getDemoClientIp, loadDemoClientIpConfig } from './demoClientIp.ts'
import { loadDemoCreationConfig, MySqlDemoCreator } from './demoCreation.ts'
import { MySqlDemoStartRateLimiter } from './demoStartRateLimiter.ts'

export interface DemoStartDependencies {
  clientIp(request: Request): string | null
  consume(address: string): Promise<RateLimitResult>
  createDemo(requestKey: string): Promise<LoginResult>
}

export function configureDemoStart(
  pool: Pool,
  environment: NodeJS.ProcessEnv = process.env,
): DemoStartDependencies | undefined {
  const enabled = environment.DEMO_ENABLED
  if (enabled === undefined || enabled === 'false') {
    return undefined
  }
  if (enabled !== 'true') {
    throw new Error('DEMO_ENABLED must be true or false.')
  }
  const creator = new MySqlDemoCreator(
    pool,
    loadDemoCreationConfig(environment),
  )
  const limiter = new MySqlDemoStartRateLimiter(
    pool,
    environment.DEMO_IP_HASH_SECRET ?? '',
  )
  const ipConfig = loadDemoClientIpConfig(environment)
  return {
    clientIp: (request) =>
      getDemoClientIp(
        request.socket.remoteAddress,
        request.get('x-forwarded-for'),
        ipConfig,
      ),
    consume: (address) => limiter.consume(address),
    createDemo: (key) => creator.createDemo(key),
  }
}
