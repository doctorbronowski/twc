import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto'
import type { Request, Response } from 'express'

const sessionCookieName = 'twc_session'
const sessionDurationSeconds = 8 * 60 * 60

export interface AuthConfig {
  username: string
  password: string
  sessionSecret: string
  secureCookies: boolean
}

interface SessionPayload {
  username: string
  expiresAt: number
  nonce: string
}

function requiredEnvironmentValue(
  environment: NodeJS.ProcessEnv,
  name: string,
): string {
  const value = environment[name]
  if (!value) {
    throw new Error(
      `${name} must be configured in the application environment.`,
    )
  }
  return value
}

export function loadAuthConfig(
  environment: NodeJS.ProcessEnv = process.env,
): AuthConfig {
  const username = requiredEnvironmentValue(environment, 'APP_USERNAME')
  const password = requiredEnvironmentValue(environment, 'APP_PASSWORD')
  const sessionSecret = requiredEnvironmentValue(environment, 'SESSION_SECRET')

  if (username.length > 128) {
    throw new Error('APP_USERNAME must not exceed 128 characters.')
  }
  if (password.length < 16) {
    throw new Error('APP_PASSWORD must contain at least 16 characters.')
  }
  if (password.length > 1024) {
    throw new Error('APP_PASSWORD must not exceed 1024 characters.')
  }
  if (sessionSecret.length < 32) {
    throw new Error('SESSION_SECRET must contain at least 32 characters.')
  }

  return {
    username,
    password,
    sessionSecret,
    secureCookies: environment.NODE_ENV === 'production',
  }
}

function constantTimeEqual(value: string, expected: string): boolean {
  const valueDigest = createHash('sha256').update(value).digest()
  const expectedDigest = createHash('sha256').update(expected).digest()
  return timingSafeEqual(valueDigest, expectedDigest)
}

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url')
}

function readCookie(request: Request): string | null {
  const prefix = `${sessionCookieName}=`
  const cookies = request.headers.cookie?.split(';') ?? []
  const cookie = cookies
    .map((value) => value.trim())
    .find((value) => value.startsWith(prefix))
  return cookie ? cookie.slice(prefix.length) : null
}

export function getAuthenticatedUsername(
  request: Request,
  config: AuthConfig,
): string | null {
  const token = readCookie(request)
  if (!token) {
    return null
  }

  const [encodedPayload, providedSignature, extra] = token.split('.')
  if (!encodedPayload || !providedSignature || extra !== undefined) {
    return null
  }

  const expectedSignature = sign(encodedPayload, config.sessionSecret)
  if (!constantTimeEqual(providedSignature, expectedSignature)) {
    return null
  }

  let payload: unknown
  try {
    payload = JSON.parse(
      Buffer.from(encodedPayload, 'base64url').toString('utf8'),
    )
  } catch {
    return null
  }

  if (
    typeof payload !== 'object' ||
    payload === null ||
    !('username' in payload) ||
    !('expiresAt' in payload) ||
    !('nonce' in payload) ||
    typeof payload.username !== 'string' ||
    typeof payload.expiresAt !== 'number' ||
    typeof payload.nonce !== 'string' ||
    payload.username !== config.username ||
    payload.expiresAt <= Date.now() ||
    !payload.nonce
  ) {
    return null
  }

  return payload.username
}

export function setSessionCookie(response: Response, config: AuthConfig) {
  const payload: SessionPayload = {
    username: config.username,
    expiresAt: Date.now() + sessionDurationSeconds * 1000,
    nonce: randomBytes(16).toString('base64url'),
  }
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
    'base64url',
  )
  const token = `${encodedPayload}.${sign(encodedPayload, config.sessionSecret)}`
  const secure = config.secureCookies ? '; Secure' : ''

  response.setHeader(
    'Set-Cookie',
    `${sessionCookieName}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${sessionDurationSeconds}${secure}`,
  )
}

export function clearSessionCookie(response: Response, config: AuthConfig) {
  const secure = config.secureCookies ? '; Secure' : ''
  response.setHeader(
    'Set-Cookie',
    `${sessionCookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`,
  )
}

export function isValidLogin(
  username: unknown,
  password: unknown,
  config: AuthConfig,
): boolean {
  return (
    typeof username === 'string' &&
    typeof password === 'string' &&
    username.length <= 128 &&
    password.length <= 1024 &&
    constantTimeEqual(username, config.username) &&
    constantTimeEqual(password, config.password)
  )
}
