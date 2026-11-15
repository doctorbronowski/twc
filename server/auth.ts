import { createHash, randomBytes } from 'node:crypto'
import type { Request, RequestHandler, Response } from 'express'
import { isValidPassword, normalizeEmail } from './accountInput.ts'
import { hashPassword, verifyPassword } from './password.ts'

export const sessionCookieName = 'twc_session'
export const sessionDurationSeconds = 15 * 60

export interface AuthAccount {
  id: number
  username: string
  pendingEmail: string | null
  passwordHash: string
  emailVerifiedAt: string | null
  disabledAt: string | null
}

export interface AuthenticatedUser {
  id: number
  username: string
}

export interface AccountDetails {
  email: string
  emailVerified: boolean
  pendingEmail: string | null
}

export type EmailChangeRequestResult =
  | 'stored'
  | 'email-in-use'
  | 'account-changed'

export type EmailChangeCompletionResult =
  | { status: 'completed'; oldEmail: string; newEmail: string }
  | { status: 'invalid-token' | 'email-in-use' }

export type CreateSessionResult =
  | 'created'
  | 'active-session'
  | 'account-changed'

export interface AuthenticatedSession extends AuthenticatedUser {
  sessionId: number
}

export interface LoginResult {
  user: AuthenticatedUser
  sessionToken: string
}

export interface AuthRepository {
  findAccountByUsername(username: string): Promise<AuthAccount | null>
  findAccountById(id: number): Promise<AuthAccount | null>
  createAccount(username: string, passwordHash: string): Promise<number | null>
  storeEmailVerificationToken(
    accountId: number,
    tokenHash: Buffer,
    expiresAfterSeconds: number,
  ): Promise<void>
  consumeEmailVerificationToken(tokenHash: Buffer): Promise<boolean>
  storePasswordResetToken(
    accountId: number,
    tokenHash: Buffer,
    expiresAfterSeconds: number,
  ): Promise<void>
  resetPasswordWithToken(
    tokenHash: Buffer,
    passwordHash: string,
  ): Promise<boolean>
  changePassword(
    accountId: number,
    currentPasswordHash: string,
    passwordHash: string,
    currentSessionTokenHash: Buffer,
  ): Promise<boolean>
  deactivateAccount(
    accountId: number,
    currentPasswordHash: string,
  ): Promise<boolean>
  requestEmailChange(
    accountId: number,
    currentPasswordHash: string,
    pendingEmail: string,
    tokenHash: Buffer,
    expiresAfterSeconds: number,
  ): Promise<EmailChangeRequestResult>
  resendEmailChangeToken(
    accountId: number,
    pendingEmail: string,
    tokenHash: Buffer,
    expiresAfterSeconds: number,
  ): Promise<boolean>
  cancelEmailChange(accountId: number): Promise<void>
  completeEmailChange(
    tokenHash: Buffer,
    currentSessionTokenHash: Buffer | null,
  ): Promise<EmailChangeCompletionResult>
  createSession(
    account: AuthAccount,
    tokenHash: Buffer,
    existingSessionTokenHash: Buffer | null,
  ): Promise<CreateSessionResult>
  getAndTouchSession(tokenHash: Buffer): Promise<AuthenticatedSession | null>
  revokeSession(tokenHash: Buffer): Promise<void>
}

export interface AuthMailer {
  sendVerificationEmail(username: string, token: string): Promise<void>
  sendPasswordResetEmail(username: string, token: string): Promise<void>
  sendEmailChangeVerificationEmail(email: string, token: string): Promise<void>
  sendEmailChangeNotification(oldEmail: string, newEmail: string): Promise<void>
}

export type AuthErrorCode =
  | 'invalid-input'
  | 'duplicate-account'
  | 'invalid-credentials'
  | 'active-session'
  | 'invalid-token'
  | 'email-delivery'
  | 'duplicate-email'

export class AuthError extends Error {
  readonly code: AuthErrorCode

  constructor(code: AuthErrorCode, message: string) {
    super(message)
    this.name = 'AuthError'
    this.code = code
  }
}

function hashToken(token: string): Buffer {
  return createHash('sha256').update(token).digest()
}

function isToken(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value)
}

function createToken(): { token: string; tokenHash: Buffer } {
  const token = randomBytes(32).toString('base64url')
  return { token, tokenHash: hashToken(token) }
}

export function readSessionToken(request: Request): string | null {
  const prefix = `${sessionCookieName}=`
  const cookie = request.headers.cookie
    ?.split(';')
    .map((value) => value.trim())
    .find((value) => value.startsWith(prefix))
  const token = cookie?.slice(prefix.length)
  return isToken(token) ? token : null
}

export function setSessionCookie(response: Response, token: string) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  response.setHeader(
    'Set-Cookie',
    `${sessionCookieName}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${sessionDurationSeconds}${secure}`,
  )
}

export function clearSessionCookie(response: Response) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  response.setHeader(
    'Set-Cookie',
    `${sessionCookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`,
  )
}

export class AuthenticationService {
  private readonly repository: AuthRepository
  private readonly mailer: AuthMailer
  private readonly dummyPasswordHash: Promise<string>

  constructor(repository: AuthRepository, mailer: AuthMailer) {
    this.repository = repository
    this.mailer = mailer
    this.dummyPasswordHash = hashPassword('invalid-login-placeholder')
  }

  async getAccountDetails(accountId: number): Promise<AccountDetails | null> {
    const account = await this.repository.findAccountById(accountId)
    if (!account || account.disabledAt !== null) {
      return null
    }

    return {
      email: account.username,
      emailVerified: account.emailVerifiedAt !== null,
      pendingEmail: account.pendingEmail,
    }
  }

  async register(emailValue: unknown, passwordValue: unknown): Promise<void> {
    const username = normalizeEmail(emailValue)
    if (!username || !isValidPassword(passwordValue)) {
      throw new AuthError(
        'invalid-input',
        'Enter a valid email address and a password that meets the requirements.',
      )
    }

    const passwordHash = await hashPassword(passwordValue)
    const accountId = await this.repository.createAccount(
      username,
      passwordHash,
    )
    if (accountId === null) {
      throw new AuthError(
        'duplicate-account',
        'An account with this email already exists.',
      )
    }

    await this.sendVerification(accountId, username)
  }

  async login(
    emailValue: unknown,
    passwordValue: unknown,
    existingSessionToken: string | null,
  ): Promise<LoginResult> {
    const username = normalizeEmail(emailValue)
    const password =
      typeof passwordValue === 'string' && passwordValue.length <= 1024
        ? passwordValue
        : ''
    const account = username
      ? await this.repository.findAccountByUsername(username)
      : null
    const passwordHash = account?.passwordHash ?? (await this.dummyPasswordHash)
    const passwordMatches = await verifyPassword(password, passwordHash)

    if (
      !account?.emailVerifiedAt ||
      account.disabledAt !== null ||
      !passwordMatches ||
      passwordValue !== password
    ) {
      throw new AuthError(
        'invalid-credentials',
        'Email or password is incorrect.',
      )
    }

    const sessionToken = randomBytes(32).toString('base64url')
    const result = await this.repository.createSession(
      account,
      hashToken(sessionToken),
      existingSessionToken && isToken(existingSessionToken)
        ? hashToken(existingSessionToken)
        : null,
    )
    if (result === 'active-session') {
      throw new AuthError(
        'active-session',
        'This account is already signed in elsewhere. Sign out there or wait for the session to expire after 15 minutes of inactivity.',
      )
    }
    if (result === 'account-changed') {
      throw new AuthError(
        'invalid-credentials',
        'Email or password is incorrect.',
      )
    }
    return {
      user: { id: account.id, username: account.username },
      sessionToken,
    }
  }

  async authenticate(token: string): Promise<AuthenticatedSession | null> {
    if (!isToken(token)) {
      return null
    }
    return this.repository.getAndTouchSession(hashToken(token))
  }

  async logout(token: string | null): Promise<void> {
    if (token && isToken(token)) {
      await this.repository.revokeSession(hashToken(token))
    }
  }

  async verifyEmail(tokenValue: unknown): Promise<boolean> {
    if (!isToken(tokenValue)) {
      return false
    }
    return this.repository.consumeEmailVerificationToken(hashToken(tokenValue))
  }

  async resendVerification(emailValue: unknown): Promise<void> {
    const username = normalizeEmail(emailValue)
    if (!username) {
      return
    }
    const account = await this.repository.findAccountByUsername(username)
    if (!account || account.emailVerifiedAt || account.disabledAt !== null) {
      return
    }
    await this.sendVerification(account.id, account.username, true)
  }

  async requestPasswordReset(emailValue: unknown): Promise<void> {
    const username = normalizeEmail(emailValue)
    if (!username) {
      return
    }
    const account = await this.repository.findAccountByUsername(username)
    if (!account?.emailVerifiedAt || account.disabledAt !== null) {
      return
    }

    const { token, tokenHash } = createToken()
    await this.repository.storePasswordResetToken(
      account.id,
      tokenHash,
      30 * 60,
    )
    try {
      await this.mailer.sendPasswordResetEmail(account.username, token)
    } catch (error) {
      console.error(
        'Unable to send password-reset email:',
        error instanceof Error ? error.message : 'Unknown mail error',
      )
    }
  }

  async resetPassword(
    tokenValue: unknown,
    passwordValue: unknown,
  ): Promise<boolean> {
    if (!isToken(tokenValue)) {
      return false
    }
    if (!isValidPassword(passwordValue)) {
      throw new AuthError(
        'invalid-input',
        'The new password does not meet the requirements.',
      )
    }
    const passwordHash = await hashPassword(passwordValue)
    return this.repository.resetPasswordWithToken(
      hashToken(tokenValue),
      passwordHash,
    )
  }

  async changePassword(
    accountId: number,
    currentPasswordValue: unknown,
    passwordValue: unknown,
    currentSessionToken: string,
  ): Promise<void> {
    if (
      typeof currentPasswordValue !== 'string' ||
      currentPasswordValue.length > 1024 ||
      !isValidPassword(passwordValue)
    ) {
      throw new AuthError(
        'invalid-input',
        'Enter your current password and a valid new password.',
      )
    }

    const account = await this.repository.findAccountById(accountId)
    const currentPasswordMatches =
      account !== null &&
      account.disabledAt === null &&
      (await verifyPassword(currentPasswordValue, account.passwordHash))
    if (!account || !currentPasswordMatches) {
      throw new AuthError(
        'invalid-credentials',
        'The current password is incorrect.',
      )
    }

    const passwordHash = await hashPassword(passwordValue)
    const changed = await this.repository.changePassword(
      accountId,
      account.passwordHash,
      passwordHash,
      hashToken(currentSessionToken),
    )
    if (!changed) {
      throw new AuthError(
        'invalid-credentials',
        'The current password is incorrect.',
      )
    }
  }

  async deactivateAccount(
    accountId: number,
    currentPasswordValue: unknown,
  ): Promise<void> {
    if (
      typeof currentPasswordValue !== 'string' ||
      currentPasswordValue.length > 1024
    ) {
      throw new AuthError(
        'invalid-input',
        'Enter your current password to deactivate the account.',
      )
    }

    const account = await this.repository.findAccountById(accountId)
    const currentPasswordMatches =
      account !== null &&
      account.disabledAt === null &&
      (await verifyPassword(currentPasswordValue, account.passwordHash))
    if (!account || !currentPasswordMatches) {
      throw new AuthError(
        'invalid-credentials',
        'The current password is incorrect.',
      )
    }

    const deactivated = await this.repository.deactivateAccount(
      accountId,
      account.passwordHash,
    )
    if (!deactivated) {
      throw new AuthError(
        'invalid-credentials',
        'The current password is incorrect.',
      )
    }
  }

  async requestEmailChange(
    accountId: number,
    currentPasswordValue: unknown,
    emailValue: unknown,
  ): Promise<string> {
    const pendingEmail = normalizeEmail(emailValue)
    if (
      !pendingEmail ||
      typeof currentPasswordValue !== 'string' ||
      currentPasswordValue.length > 1024
    ) {
      throw new AuthError(
        'invalid-input',
        'Enter a valid email address and your current password.',
      )
    }

    const account = await this.repository.findAccountById(accountId)
    const currentPasswordMatches =
      account !== null &&
      account.disabledAt === null &&
      (await verifyPassword(currentPasswordValue, account.passwordHash))
    if (!account || !currentPasswordMatches) {
      throw new AuthError(
        'invalid-credentials',
        'The current password is incorrect.',
      )
    }
    if (pendingEmail === account.username) {
      throw new AuthError(
        'invalid-input',
        'Enter an email address different from your current address.',
      )
    }

    const { token, tokenHash } = createToken()
    const result = await this.repository.requestEmailChange(
      accountId,
      account.passwordHash,
      pendingEmail,
      tokenHash,
      24 * 60 * 60,
    )
    if (result === 'email-in-use') {
      throw new AuthError(
        'duplicate-email',
        'That email address is already associated with an account or a pending change.',
      )
    }
    if (result === 'account-changed') {
      throw new AuthError(
        'invalid-credentials',
        'Your account changed while the request was being processed. Try again.',
      )
    }

    try {
      await this.mailer.sendEmailChangeVerificationEmail(pendingEmail, token)
    } catch (error) {
      console.error(
        'Unable to send email-change verification:',
        error instanceof Error ? error.message : 'Unknown mail error',
      )
      throw new AuthError(
        'email-delivery',
        'The email change is pending, but its verification email could not be sent. Resend it or cancel the request.',
      )
    }
    return pendingEmail
  }

  async resendEmailChange(accountId: number): Promise<string> {
    const account = await this.repository.findAccountById(accountId)
    if (!account || account.disabledAt !== null || !account.pendingEmail) {
      throw new AuthError('invalid-input', 'There is no pending email change.')
    }

    const { token, tokenHash } = createToken()
    const stored = await this.repository.resendEmailChangeToken(
      accountId,
      account.pendingEmail,
      tokenHash,
      24 * 60 * 60,
    )
    if (!stored) {
      throw new AuthError('invalid-input', 'There is no pending email change.')
    }

    try {
      await this.mailer.sendEmailChangeVerificationEmail(
        account.pendingEmail,
        token,
      )
    } catch (error) {
      console.error(
        'Unable to resend email-change verification:',
        error instanceof Error ? error.message : 'Unknown mail error',
      )
      throw new AuthError(
        'email-delivery',
        'The verification email could not be sent. Please try again.',
      )
    }
    return account.pendingEmail
  }

  async cancelEmailChange(accountId: number): Promise<void> {
    await this.repository.cancelEmailChange(accountId)
  }

  async verifyEmailChange(
    tokenValue: unknown,
    currentSessionTokenValue: string | null,
  ): Promise<EmailChangeCompletionResult> {
    if (!isToken(tokenValue)) {
      return { status: 'invalid-token' }
    }

    const currentSessionTokenHash =
      currentSessionTokenValue && isToken(currentSessionTokenValue)
        ? hashToken(currentSessionTokenValue)
        : null
    const result = await this.repository.completeEmailChange(
      hashToken(tokenValue),
      currentSessionTokenHash,
    )
    if (result.status === 'completed') {
      try {
        await this.mailer.sendEmailChangeNotification(
          result.oldEmail,
          result.newEmail,
        )
      } catch (error) {
        console.error(
          'Unable to notify the previous email address:',
          error instanceof Error ? error.message : 'Unknown mail error',
        )
      }
    }
    return result
  }

  private async sendVerification(
    accountId: number,
    username: string,
    suppressDeliveryFailure = false,
  ): Promise<void> {
    const { token, tokenHash } = createToken()
    await this.repository.storeEmailVerificationToken(
      accountId,
      tokenHash,
      24 * 60 * 60,
    )

    try {
      await this.mailer.sendVerificationEmail(username, token)
    } catch (error) {
      console.error(
        'Unable to send verification email:',
        error instanceof Error ? error.message : 'Unknown mail error',
      )
      if (suppressDeliveryFailure) {
        return
      }
      throw new AuthError(
        'email-delivery',
        'The account was created, but the verification email could not be sent. Please request a resend.',
      )
    }
  }
}

export function requireAuthentication(
  service: AuthenticationService,
): RequestHandler {
  return async (request, response, next) => {
    const token = readSessionToken(request)
    if (!token) {
      response.status(401).json({ error: 'Authentication is required.' })
      return
    }

    try {
      const session = await service.authenticate(token)
      if (!session) {
        clearSessionCookie(response)
        response.status(401).json({ error: 'Authentication is required.' })
        return
      }
      request.authenticatedUser = {
        id: session.id,
        username: session.username,
      }
      setSessionCookie(response, token)
      next()
    } catch (error) {
      console.error(
        'Unable to verify the authenticated session:',
        error instanceof Error ? error.message : 'Unknown authentication error',
      )
      response.status(500).json({
        error: 'Authentication could not be verified. Please try again.',
      })
    }
  }
}

export function trustedOrigins(
  baseUrlValue: string,
  allowedOriginsValue = '',
): Set<string> {
  const values = [
    baseUrlValue,
    ...allowedOriginsValue.split(',').filter(Boolean),
  ]
  const origins = new Set<string>()
  for (const value of values) {
    let url: URL
    try {
      url = new URL(value.trim())
    } catch {
      throw new Error(
        'APP_BASE_URL and APP_ALLOWED_ORIGINS must be valid URLs.',
      )
    }
    if (
      (url.protocol !== 'https:' && url.protocol !== 'http:') ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    ) {
      throw new Error('Configured application origins must be URL origins.')
    }
    origins.add(url.origin)
  }
  return origins
}

export function loadTrustedOrigins(
  environment: NodeJS.ProcessEnv = process.env,
): Set<string> {
  const baseUrl = environment.APP_BASE_URL
  if (!baseUrl) {
    throw new Error('APP_BASE_URL must be configured.')
  }
  const origins = trustedOrigins(baseUrl, environment.APP_ALLOWED_ORIGINS)
  if (
    environment.NODE_ENV === 'production' &&
    new URL(baseUrl).protocol !== 'https:'
  ) {
    throw new Error('APP_BASE_URL must use HTTPS in production.')
  }
  return origins
}

export function hasTrustedOrigin(
  request: Request,
  origins: ReadonlySet<string>,
): boolean {
  const origin = request.get('origin')
  return Boolean(origin && origins.has(origin))
}

declare global {
  namespace Express {
    interface Request {
      authenticatedUser?: AuthenticatedUser
    }
  }
}
