import type { Request, RequestHandler, Response } from 'express'
import express from 'express'
import { normalizeEmail } from './accountInput.ts'
import {
  AuthError,
  type AuthenticationService,
  clearSessionCookie,
  hasTrustedOrigin,
  loadTrustedOrigins,
  readSessionToken,
  requireAuthentication,
  setSessionCookie,
} from './auth.ts'
import { AuthRateLimiter } from './authRateLimiter.ts'

const quarterHour = 15 * 60 * 1000
const hour = 60 * 60 * 1000

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requestBody(request: Request): Record<string, unknown> {
  const body: unknown = request.body
  return isRecord(body) ? body : {}
}

function writeUnexpectedError(
  action: string,
  error: unknown,
  response: Response,
) {
  console.error(
    `Unable to ${action}:`,
    error instanceof Error ? error.message : 'Unknown authentication error',
  )
  response.status(500).json({
    error: 'The request could not be completed. Please try again.',
  })
}

function scheduleAccountEmail(action: string, operation: () => Promise<void>) {
  setImmediate(() => {
    void operation().catch((error: unknown) => {
      console.error(
        `Unable to process ${action}:`,
        error instanceof Error ? error.message : 'Unknown authentication error',
      )
    })
  })
}

function applyRateLimit(
  request: Request,
  response: Response,
  limiter: AuthRateLimiter,
  action: string,
  email: string | null,
  ipLimit: number,
  emailLimit: number,
  windowMs: number,
): boolean {
  const ip = request.ip || request.socket.remoteAddress || 'unknown'
  const policies = [{ key: `${action}:ip:${ip}`, limit: ipLimit, windowMs }]
  if (email) {
    policies.push({
      key: `${action}:email:${email}`,
      limit: emailLimit,
      windowMs,
    })
  }

  const result = limiter.consume(policies)
  if (result.allowed) {
    return true
  }

  response.setHeader('Retry-After', result.retryAfterSeconds)
  response.status(429).json({
    error: 'Too many attempts. Please try again later.',
  })
  return false
}

export function createAuthRouter(
  service: AuthenticationService,
  allowedOrigins: ReadonlySet<string> = loadTrustedOrigins(),
  registrationEnabled = false,
) {
  const router = express.Router()
  const limiter = new AuthRateLimiter()
  const requireTrustedOrigin: RequestHandler = (request, response, next) => {
    if (!hasTrustedOrigin(request, allowedOrigins)) {
      response.status(403).json({ error: 'Request origin is not allowed.' })
      return
    }
    next()
  }
  const requireRegistrationEnabled: RequestHandler = (
    _request,
    response,
    next,
  ) => {
    if (!registrationEnabled) {
      response.status(403).json({
        error: 'Account registration is not enabled.',
      })
      return
    }
    next()
  }

  router.post(
    '/register',
    requireTrustedOrigin,
    requireRegistrationEnabled,
    async (request, response) => {
      const body = requestBody(request)
      const email = normalizeEmail(body.email)
      if (
        !applyRateLimit(
          request,
          response,
          limiter,
          'register',
          email,
          10,
          5,
          hour,
        )
      ) {
        return
      }

      if (
        typeof body.password !== 'string' ||
        body.password !== body.confirmPassword
      ) {
        response.status(400).json({ error: 'Passwords do not match.' })
        return
      }

      try {
        await service.register(body.email, body.password)
        response.status(201).json({
          message: 'Account created. Check your email to verify it.',
        })
      } catch (error) {
        if (error instanceof AuthError) {
          const status =
            error.code === 'duplicate-account'
              ? 409
              : error.code === 'email-delivery'
                ? 503
                : 400
          response.status(status).json({ error: error.message })
          return
        }
        writeUnexpectedError('register the account', error, response)
      }
    },
  )

  router.post('/login', requireTrustedOrigin, async (request, response) => {
    const body = requestBody(request)
    const email = normalizeEmail(body.email)
    if (
      !applyRateLimit(
        request,
        response,
        limiter,
        'login',
        email,
        20,
        10,
        quarterHour,
      )
    ) {
      return
    }

    try {
      const result = await service.login(
        body.email,
        body.password,
        readSessionToken(request),
      )
      setSessionCookie(response, result.sessionToken)
      response.json({ user: result.user })
    } catch (error) {
      if (error instanceof AuthError && error.code === 'invalid-credentials') {
        response.status(401).json({ error: error.message })
        return
      }
      if (error instanceof AuthError && error.code === 'active-session') {
        response.status(409).json({ error: error.message })
        return
      }
      writeUnexpectedError('sign in', error, response)
    }
  })

  router.post('/logout', requireTrustedOrigin, async (request, response) => {
    try {
      await service.logout(readSessionToken(request))
      clearSessionCookie(response)
      response.status(204).end()
    } catch (error) {
      writeUnexpectedError('sign out', error, response)
    }
  })

  router.get('/session', async (request, response) => {
    const token = readSessionToken(request)
    if (!token) {
      response.json({ authenticated: false })
      return
    }

    try {
      const session = await service.authenticate(token)
      if (!session) {
        clearSessionCookie(response)
        response.json({ authenticated: false })
        return
      }
      setSessionCookie(response, token)
      response.json({
        authenticated: true,
        user: { id: session.id, username: session.username },
      })
    } catch (error) {
      writeUnexpectedError('read the session', error, response)
    }
  })

  router.get(
    '/account',
    requireAuthentication(service),
    async (request, response) => {
      const user = request.authenticatedUser
      if (!user) {
        response.status(401).json({ error: 'Authentication is required.' })
        return
      }

      try {
        const account = await service.getAccountDetails(user.id)
        if (!account) {
          response.status(404).json({ error: 'Account not found.' })
          return
        }
        response.json({ account })
      } catch (error) {
        writeUnexpectedError('read account details', error, response)
      }
    },
  )

  router.post(
    '/account/deactivate',
    requireTrustedOrigin,
    requireAuthentication(service),
    async (request, response) => {
      const user = request.authenticatedUser
      if (!user) {
        response.status(401).json({ error: 'Authentication is required.' })
        return
      }

      if (
        !applyRateLimit(
          request,
          response,
          limiter,
          'account-deactivate',
          user.username,
          5,
          5,
          hour,
        )
      ) {
        return
      }

      const body = requestBody(request)
      if (body.confirmed !== true) {
        response.status(400).json({
          error: 'Confirm that you understand the account will be deactivated.',
        })
        return
      }

      try {
        await service.deactivateAccount(user.id, body.currentPassword)
        clearSessionCookie(response)
        response.json({
          message:
            'Your account has been deactivated. Contact an administrator if you need access restored.',
        })
      } catch (error) {
        if (error instanceof AuthError) {
          response
            .status(
              error.code === 'invalid-credentials'
                ? 401
                : error.code === 'invalid-input'
                  ? 400
                  : 500,
            )
            .json({ error: error.message })
          return
        }
        writeUnexpectedError('deactivate the account', error, response)
      }
    },
  )

  router.post(
    '/email-change',
    requireTrustedOrigin,
    requireAuthentication(service),
    async (request, response) => {
      const user = request.authenticatedUser
      if (!user) {
        response.status(401).json({ error: 'Authentication is required.' })
        return
      }

      if (
        !applyRateLimit(
          request,
          response,
          limiter,
          'email-change',
          user.username,
          10,
          5,
          hour,
        )
      ) {
        return
      }

      const body = requestBody(request)
      try {
        const pendingEmail = await service.requestEmailChange(
          user.id,
          body.currentPassword,
          body.email,
        )
        response.json({
          message: 'A verification email was sent to the new address.',
          pendingEmail,
        })
      } catch (error) {
        if (error instanceof AuthError) {
          const status =
            error.code === 'invalid-credentials'
              ? 401
              : error.code === 'duplicate-email'
                ? 409
                : error.code === 'email-delivery'
                  ? 503
                  : 400
          response.status(status).json({
            error: error.message,
            ...(error.code === 'email-delivery' && {
              pendingEmail: normalizeEmail(body.email),
            }),
          })
          return
        }
        writeUnexpectedError('request an email change', error, response)
      }
    },
  )

  router.post(
    '/email-change/resend',
    requireTrustedOrigin,
    requireAuthentication(service),
    async (request, response) => {
      const user = request.authenticatedUser
      if (!user) {
        response.status(401).json({ error: 'Authentication is required.' })
        return
      }

      if (
        !applyRateLimit(
          request,
          response,
          limiter,
          'email-change-resend',
          user.username,
          10,
          5,
          hour,
        )
      ) {
        return
      }

      try {
        const pendingEmail = await service.resendEmailChange(user.id)
        response.json({
          message: 'A new verification email was sent.',
          pendingEmail,
        })
      } catch (error) {
        if (error instanceof AuthError) {
          response
            .status(error.code === 'email-delivery' ? 503 : 400)
            .json({ error: error.message })
          return
        }
        writeUnexpectedError(
          'resend email-change verification',
          error,
          response,
        )
      }
    },
  )

  router.post(
    '/email-change/cancel',
    requireTrustedOrigin,
    requireAuthentication(service),
    async (request, response) => {
      const user = request.authenticatedUser
      if (!user) {
        response.status(401).json({ error: 'Authentication is required.' })
        return
      }

      try {
        await service.cancelEmailChange(user.id)
        response.json({ message: 'The pending email change was cancelled.' })
      } catch (error) {
        writeUnexpectedError('cancel the email change', error, response)
      }
    },
  )

  router.post(
    '/email-change/verify',
    requireTrustedOrigin,
    async (request, response) => {
      if (
        !applyRateLimit(
          request,
          response,
          limiter,
          'email-change-verify',
          null,
          20,
          20,
          quarterHour,
        )
      ) {
        return
      }

      try {
        const result = await service.verifyEmailChange(
          requestBody(request).token,
          readSessionToken(request),
        )
        if (result.status === 'invalid-token') {
          response.status(400).json({
            error: 'The email-change link is invalid or has expired.',
          })
          return
        }
        if (result.status === 'email-in-use') {
          response.status(409).json({
            error:
              'That email address is no longer available. Request a change using another address.',
          })
          return
        }
        response.json({
          message:
            'Your email address was changed. A notice was sent to your previous address.',
        })
      } catch (error) {
        writeUnexpectedError('verify the new email address', error, response)
      }
    },
  )

  router.post(
    '/verify-email',
    requireTrustedOrigin,
    async (request, response) => {
      if (
        !applyRateLimit(
          request,
          response,
          limiter,
          'verify-email',
          null,
          20,
          20,
          quarterHour,
        )
      ) {
        return
      }

      try {
        const verified = await service.verifyEmail(requestBody(request).token)
        if (!verified) {
          response.status(400).json({
            error: 'The verification link is invalid or has expired.',
          })
          return
        }
        response.json({ message: 'Email verified. You can now sign in.' })
      } catch (error) {
        writeUnexpectedError('verify the email address', error, response)
      }
    },
  )

  router.post(
    '/verification/resend',
    requireTrustedOrigin,
    async (request, response) => {
      const email = normalizeEmail(requestBody(request).email)
      if (
        !applyRateLimit(
          request,
          response,
          limiter,
          'verification-resend',
          email,
          10,
          5,
          hour,
        )
      ) {
        return
      }

      try {
        response.status(202).json({
          message:
            'If the account is eligible, a verification email will be sent.',
        })
        const emailValue = requestBody(request).email
        scheduleAccountEmail('verification email request', () =>
          service.resendVerification(emailValue),
        )
      } catch (error) {
        writeUnexpectedError('request a verification email', error, response)
      }
    },
  )

  router.post(
    '/password-reset/request',
    requireTrustedOrigin,
    async (request, response) => {
      const email = normalizeEmail(requestBody(request).email)
      if (
        !applyRateLimit(
          request,
          response,
          limiter,
          'password-reset-request',
          email,
          10,
          5,
          hour,
        )
      ) {
        return
      }

      try {
        response.status(202).json({
          message:
            'If an account exists for that email, reset instructions will be sent. If you do not receive a message, you may retry shortly.',
        })
        const emailValue = requestBody(request).email
        scheduleAccountEmail('password reset request', () =>
          service.requestPasswordReset(emailValue),
        )
      } catch (error) {
        writeUnexpectedError('request a password reset', error, response)
      }
    },
  )

  router.post(
    '/password-reset',
    requireTrustedOrigin,
    async (request, response) => {
      const body = requestBody(request)
      if (
        !applyRateLimit(
          request,
          response,
          limiter,
          'password-reset',
          null,
          20,
          20,
          quarterHour,
        )
      ) {
        return
      }

      if (
        typeof body.password !== 'string' ||
        body.password !== body.confirmPassword
      ) {
        response.status(400).json({ error: 'Passwords do not match.' })
        return
      }

      try {
        const reset = await service.resetPassword(body.token, body.password)
        if (!reset) {
          response.status(400).json({
            error: 'The reset link is invalid or has expired.',
          })
          return
        }
        response.json({
          message: 'Password reset. Sign in with your new password.',
        })
      } catch (error) {
        if (error instanceof AuthError && error.code === 'invalid-input') {
          response.status(400).json({ error: error.message })
          return
        }
        writeUnexpectedError('reset the password', error, response)
      }
    },
  )

  router.post(
    '/password',
    requireTrustedOrigin,
    requireAuthentication(service),
    async (request, response) => {
      const user = request.authenticatedUser
      const token = readSessionToken(request)
      if (!user || !token) {
        response.status(401).json({ error: 'Authentication is required.' })
        return
      }

      if (
        !applyRateLimit(
          request,
          response,
          limiter,
          'password-change',
          user.username,
          10,
          10,
          quarterHour,
        )
      ) {
        return
      }

      const body = requestBody(request)
      if (
        typeof body.password !== 'string' ||
        body.password !== body.confirmPassword
      ) {
        response.status(400).json({ error: 'Passwords do not match.' })
        return
      }

      try {
        await service.changePassword(
          user.id,
          body.currentPassword,
          body.password,
          token,
        )
        response.json({ message: 'Password changed.' })
      } catch (error) {
        if (error instanceof AuthError) {
          response
            .status(
              error.code === 'invalid-credentials'
                ? 401
                : error.code === 'invalid-input'
                  ? 400
                  : 500,
            )
            .json({ error: error.message })
          return
        }
        writeUnexpectedError('change the password', error, response)
      }
    },
  )

  return router
}
