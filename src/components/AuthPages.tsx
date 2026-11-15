import {
  type FormEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from 'react'
import { isValidPassword } from '../passwordValidation.ts'
import PasswordInput from './PasswordInput.tsx'

export interface AuthUser {
  id: number
  username: string
}

function AuthPageHeader() {
  return (
    <header className="auth-page-header">
      <a className="brand" href="/login" aria-label="TWC Work Search sign in">
        <span className="brand-mark" aria-hidden="true">
          T
        </span>
        <span>TWC Work Search</span>
      </a>
    </header>
  )
}

interface LoginPageProps {
  onLogin: (user: AuthUser) => void
  overlay?: boolean
}

type AuthDialogKind = 'register' | 'recovery'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isAuthUser(value: unknown): value is AuthUser {
  return (
    isRecord(value) &&
    typeof value.id === 'number' &&
    Number.isSafeInteger(value.id) &&
    value.id > 0 &&
    typeof value.username === 'string'
  )
}

async function responseMessage(
  response: Response,
  fallback: string,
): Promise<string> {
  let body: unknown
  try {
    body = await response.json()
  } catch {
    return fallback
  }

  if (!isRecord(body)) {
    return fallback
  }
  if (typeof body.error === 'string') {
    return body.error
  }
  if (typeof body.message === 'string') {
    return body.message
  }
  return fallback
}

function postAuthJson(path: string, value: Record<string, unknown>) {
  return fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(value),
  })
}

function AuthBrand() {
  return (
    <div className="auth-brand" aria-hidden="true">
      T
    </div>
  )
}

function AuthDialog({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: ReactNode
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) {
      return
    }

    if (!dialog.open) {
      dialog.showModal()
      dialog
        .querySelector<HTMLElement>('input, button:not(.auth-dialog-close)')
        ?.focus()
    }

    return () => {
      if (dialog.open) {
        dialog.close()
      }
    }
  }, [])

  return (
    <dialog
      ref={dialogRef}
      className="auth-dialog"
      aria-labelledby="auth-dialog-title"
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
    >
      <div className="auth-dialog-content">
        <header className="auth-dialog-header">
          <h2 id="auth-dialog-title">{title}</h2>
          <button
            type="button"
            className="auth-dialog-close"
            aria-label="Close dialog"
            onClick={onClose}
          >
            ×
          </button>
        </header>
        <div className="auth-dialog-body">{children}</div>
      </div>
    </dialog>
  )
}

function CreateAccountDialog({ onClose }: { onClose: () => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isResending, setIsResending] = useState(false)
  const [pendingVerification, setPendingVerification] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setErrorMessage(null)
    setStatusMessage(null)

    if (!isValidPassword(password)) {
      setErrorMessage(
        'Use 8–1024 characters with at least one uppercase letter, one lowercase letter, and one number.',
      )
      return
    }
    if (password !== confirmPassword) {
      setErrorMessage('The passwords do not match.')
      return
    }

    setIsSubmitting(true)
    try {
      const response = await postAuthJson('/api/auth/register', {
        email,
        password,
        confirmPassword,
      })
      if (response.ok) {
        setPendingVerification(true)
        setStatusMessage(
          await responseMessage(
            response,
            'Account created. Check your email to verify it.',
          ),
        )
        return
      }

      setErrorMessage(
        await responseMessage(
          response,
          'The account could not be created. Please try again.',
        ),
      )
    } catch {
      setErrorMessage(
        'The request could not be completed. If the account may have been created, you can request a verification email below.',
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  async function resendVerification() {
    if (!email || isResending) {
      return
    }

    setErrorMessage(null)
    setStatusMessage(null)
    setIsResending(true)
    try {
      const response = await postAuthJson('/api/auth/verification/resend', {
        email,
      })
      if (!response.ok) {
        setErrorMessage(
          await responseMessage(
            response,
            'The request could not be completed. Please try again later.',
          ),
        )
        return
      }
      setStatusMessage(
        await responseMessage(
          response,
          'If the account is eligible, a verification email will be sent.',
        ),
      )
    } catch {
      setErrorMessage(
        'The request could not be completed. Please try again later.',
      )
    } finally {
      setIsResending(false)
    }
  }

  return (
    <AuthDialog title="Create an account" onClose={onClose}>
      {pendingVerification ? (
        <div className="auth-result">
          <p className="auth-description">{statusMessage}</p>
          <p className="auth-description">
            Verify the email address before signing in.
          </p>
          {errorMessage && (
            <p className="auth-error" role="alert">
              {errorMessage}
            </p>
          )}
          <button
            className="button button-secondary"
            type="button"
            disabled={isResending}
            onClick={() => void resendVerification()}
          >
            {isResending ? 'Sending…' : 'Resend verification email'}
          </button>
        </div>
      ) : (
        <>
          <p className="auth-description">
            Use your email address and create a password for your account.
          </p>
          <form
            className="auth-form"
            onSubmit={(event) => void handleSubmit(event)}
          >
            <div className="form-field">
              <label htmlFor="create-account-email">Email address</label>
              <input
                id="create-account-email"
                type="email"
                autoComplete="email"
                maxLength={254}
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>
            <div className="form-field">
              <label htmlFor="create-account-password">Password</label>
              <PasswordInput
                id="create-account-password"
                autoComplete="new-password"
                minLength={8}
                maxLength={1024}
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                aria-describedby="account-password-hint"
              />
              <span className="field-hint" id="account-password-hint">
                At least 8 characters, including uppercase, lowercase, and a
                number.
              </span>
            </div>
            <div className="form-field">
              <label htmlFor="create-account-confirm">Confirm password</label>
              <PasswordInput
                id="create-account-confirm"
                autoComplete="new-password"
                maxLength={1024}
                required
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
              />
            </div>
            {errorMessage && (
              <p className="auth-error" role="alert">
                {errorMessage}
              </p>
            )}
            <button
              className="button button-primary auth-submit"
              type="submit"
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Creating account…' : 'Create account'}
            </button>
          </form>
          {email && (
            <div className="auth-resend">
              {statusMessage && (
                <p className="auth-success" role="status">
                  {statusMessage}
                </p>
              )}
              <button
                className="auth-link-button"
                type="button"
                disabled={isResending}
                onClick={() => void resendVerification()}
              >
                {isResending ? 'Sending…' : 'Resend verification email'}
              </button>
            </div>
          )}
        </>
      )}
    </AuthDialog>
  )
}

function PasswordRecoveryDialog({ onClose }: { onClose: () => void }) {
  const [email, setEmail] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setErrorMessage(null)
    setStatusMessage(null)
    setIsSubmitting(true)
    try {
      const response = await postAuthJson('/api/auth/password-reset/request', {
        email,
      })
      if (!response.ok) {
        setErrorMessage(
          await responseMessage(
            response,
            'The request could not be completed. Please try again later.',
          ),
        )
        return
      }
      setStatusMessage(
        await responseMessage(
          response,
          'If an account exists for that email, reset instructions will be sent.',
        ),
      )
    } catch {
      setErrorMessage(
        'The request could not be completed. Please try again later.',
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <AuthDialog title="Forgot password" onClose={onClose}>
      <p className="auth-description">
        Enter your account email. If an eligible account exists, we’ll send
        password-reset instructions.
      </p>
      <form
        className="auth-form"
        onSubmit={(event) => void handleSubmit(event)}
      >
        <div className="form-field">
          <label htmlFor="recovery-email">Email address</label>
          <input
            id="recovery-email"
            type="email"
            autoComplete="email"
            maxLength={254}
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>
        {errorMessage && (
          <p className="auth-error" role="alert">
            {errorMessage}
          </p>
        )}
        {statusMessage && (
          <p className="auth-success" role="status">
            {statusMessage}
          </p>
        )}
        <button
          className="button button-primary auth-submit"
          type="submit"
          disabled={isSubmitting}
        >
          {isSubmitting ? 'Sending…' : 'Send reset instructions'}
        </button>
      </form>
    </AuthDialog>
  )
}

export function LoginPage({ onLogin, overlay = false }: LoginPageProps) {
  const emailInputRef = useRef<HTMLInputElement>(null)
  const accountWasDeactivated =
    !overlay &&
    new URLSearchParams(window.location.search).get('deactivated') === '1'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [dialogKind, setDialogKind] = useState<AuthDialogKind | null>(null)

  useEffect(() => {
    if (overlay) {
      emailInputRef.current?.focus()
    }
  }, [overlay])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setErrorMessage(null)
    setIsSubmitting(true)
    try {
      const response = await postAuthJson('/api/auth/login', {
        email,
        password,
      })
      if (!response.ok) {
        setErrorMessage(
          await responseMessage(
            response,
            'We could not sign you in. Check your email and password and try again.',
          ),
        )
        return
      }

      const body: unknown = await response.json()
      if (!isRecord(body) || !isAuthUser(body.user)) {
        setErrorMessage('The sign-in response was invalid. Please try again.')
        return
      }
      onLogin(body.user)
    } catch {
      setErrorMessage('We could not sign you in right now. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const content = (
    <>
      <AuthPageHeader />
      <section className="auth-card" aria-labelledby="login-title">
        <h1 id="login-title">{overlay ? 'Sign in again' : 'Sign in'}</h1>
        <p className="auth-description">
          {overlay
            ? 'Your session expired. Sign in to continue where you left off.'
            : 'Sign in to manage your work-search activities.'}
        </p>
        {accountWasDeactivated && (
          <p className="auth-success" role="status">
            Your account has been deactivated. Contact an administrator if you
            need access restored.
          </p>
        )}
        <form
          className="auth-form"
          onSubmit={(event) => void handleSubmit(event)}
        >
          <div className="form-field">
            <label htmlFor="login-email">Email address</label>
            <input
              ref={emailInputRef}
              id="login-email"
              type="email"
              autoComplete="username"
              maxLength={254}
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>
          <div className="form-field">
            <label htmlFor="login-password">Password</label>
            <PasswordInput
              id="login-password"
              autoComplete="current-password"
              maxLength={1024}
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
          {errorMessage && (
            <p className="auth-error" role="alert">
              {errorMessage}
            </p>
          )}
          <button
            className="button button-primary auth-submit"
            type="submit"
            disabled={isSubmitting}
          >
            {isSubmitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        <div className="auth-links">
          <button
            className="auth-link-button"
            type="button"
            onClick={() => setDialogKind('register')}
          >
            Create an account
          </button>
          <button
            className="auth-link-button"
            type="button"
            onClick={() => setDialogKind('recovery')}
          >
            Forgot password?
          </button>
        </div>
      </section>
      {dialogKind === 'register' && (
        <CreateAccountDialog onClose={() => setDialogKind(null)} />
      )}
      {dialogKind === 'recovery' && (
        <PasswordRecoveryDialog onClose={() => setDialogKind(null)} />
      )}
    </>
  )

  if (overlay) {
    return (
      <div
        className="session-expired-overlay"
        role="dialog"
        aria-modal="true"
        aria-labelledby="login-title"
      >
        {content}
      </div>
    )
  }

  return <main className="auth-shell">{content}</main>
}

const initialEmailActionToken = (() => {
  const path = window.location.pathname
  if (
    path !== '/verify-email' &&
    path !== '/reset-password' &&
    path !== '/verify-email-change'
  ) {
    return null
  }

  const token = window.location.hash.slice(1)
  if (window.location.hash) {
    window.history.replaceState(
      window.history.state,
      '',
      `${window.location.pathname}${window.location.search}`,
    )
  }
  return token
})()

function ActionResultPage({
  title,
  message,
  isLoading,
}: {
  title: string
  message: string
  isLoading?: boolean
}) {
  return (
    <main className="auth-shell">
      <section className="auth-card" aria-labelledby="auth-result-title">
        <AuthBrand />
        <p className="eyebrow">TWC Work Search</p>
        <h1 id="auth-result-title">{title}</h1>
        <p className="auth-description" role={isLoading ? 'status' : 'alert'}>
          {message}
        </p>
        {!isLoading && (
          <a className="button button-primary auth-submit" href="/login">
            Return to sign in
          </a>
        )}
      </section>
    </main>
  )
}

export function EmailVerificationPage() {
  const [message, setMessage] = useState('Verifying your email address…')
  const [isLoading, setIsLoading] = useState(true)
  const started = useRef(false)

  useEffect(() => {
    if (started.current) {
      return
    }
    started.current = true

    if (!initialEmailActionToken) {
      setMessage('The verification link is missing or invalid.')
      setIsLoading(false)
      return
    }

    void (async () => {
      try {
        const response = await postAuthJson('/api/auth/verify-email', {
          token: initialEmailActionToken,
        })
        if (!response.ok) {
          setMessage(
            await responseMessage(
              response,
              'The verification link is invalid or has expired.',
            ),
          )
          return
        }
        setMessage(
          await responseMessage(
            response,
            'Email verified. You can now sign in.',
          ),
        )
      } catch {
        setMessage(
          'We could not verify your email right now. Open the link again or request a new verification email.',
        )
      } finally {
        setIsLoading(false)
      }
    })()
  }, [])

  return (
    <ActionResultPage
      title={isLoading ? 'Verifying email' : 'Email verification'}
      message={message}
      isLoading={isLoading}
    />
  )
}

export function EmailChangeVerificationPage() {
  const [message, setMessage] = useState('Verifying your new email address…')
  const [isLoading, setIsLoading] = useState(true)
  const [isSuccess, setIsSuccess] = useState(false)
  const started = useRef(false)

  useEffect(() => {
    if (started.current) {
      return
    }
    started.current = true

    if (!initialEmailActionToken) {
      setMessage('The email-change link is missing or invalid.')
      setIsLoading(false)
      return
    }

    void (async () => {
      try {
        const response = await postAuthJson('/api/auth/email-change/verify', {
          token: initialEmailActionToken,
        })
        if (!response.ok) {
          setMessage(
            await responseMessage(
              response,
              'The email-change link is invalid or has expired.',
            ),
          )
          return
        }
        setMessage(
          await responseMessage(
            response,
            'Your email address was changed. You can now sign in with the new address.',
          ),
        )
        setIsSuccess(true)
      } catch {
        setMessage(
          'We could not verify the new email address right now. Open the link again or request a new verification email.',
        )
      } finally {
        setIsLoading(false)
      }
    })()
  }, [])

  return (
    <ActionResultPage
      title={
        isLoading
          ? 'Verifying email change'
          : isSuccess
            ? 'Email address updated'
            : 'Email change verification'
      }
      message={message}
      isLoading={isLoading}
    />
  )
}

export function PasswordResetPage() {
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [completed, setCompleted] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(
    initialEmailActionToken
      ? null
      : 'The password-reset link is missing or invalid.',
  )

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setErrorMessage(null)
    if (!initialEmailActionToken) {
      setErrorMessage('The password-reset link is missing or invalid.')
      return
    }
    if (!isValidPassword(password)) {
      setErrorMessage(
        'Use 8–1024 characters with at least one uppercase letter, one lowercase letter, and one number.',
      )
      return
    }
    if (password !== confirmPassword) {
      setErrorMessage('The passwords do not match.')
      return
    }

    setIsSubmitting(true)
    try {
      const response = await postAuthJson('/api/auth/password-reset', {
        token: initialEmailActionToken,
        password,
        confirmPassword,
      })
      if (!response.ok) {
        setErrorMessage(
          await responseMessage(
            response,
            'The reset link is invalid or has expired.',
          ),
        )
        return
      }
      setCompleted(true)
    } catch {
      setErrorMessage(
        'The password could not be reset right now. Please try again.',
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-card" aria-labelledby="reset-title">
        <AuthBrand />
        <p className="eyebrow">TWC Work Search</p>
        <h1 id="reset-title">
          {completed ? 'Password reset' : 'Choose a new password'}
        </h1>
        {completed ? (
          <>
            <p className="auth-description">
              Your password was reset. Sign in with your new password.
            </p>
            <a className="button button-primary auth-submit" href="/login">
              Return to sign in
            </a>
          </>
        ) : !initialEmailActionToken ? (
          <>
            <p className="auth-error" role="alert">
              {errorMessage}
            </p>
            <a className="button button-secondary auth-submit" href="/login">
              Return to sign in
            </a>
          </>
        ) : (
          <>
            <p className="auth-description">
              Choose a password with at least 8 characters, including uppercase,
              lowercase, and a number.
            </p>
            <form
              className="auth-form"
              onSubmit={(event) => void handleSubmit(event)}
            >
              <div className="form-field">
                <label htmlFor="reset-password">New password</label>
                <PasswordInput
                  id="reset-password"
                  autoComplete="new-password"
                  minLength={8}
                  maxLength={1024}
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </div>
              <div className="form-field">
                <label htmlFor="reset-password-confirm">
                  Confirm new password
                </label>
                <PasswordInput
                  id="reset-password-confirm"
                  autoComplete="new-password"
                  maxLength={1024}
                  required
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                />
              </div>
              {errorMessage && (
                <p className="auth-error" role="alert">
                  {errorMessage}
                </p>
              )}
              <button
                className="button button-primary auth-submit"
                type="submit"
                disabled={isSubmitting}
              >
                {isSubmitting ? 'Resetting password…' : 'Reset password'}
              </button>
            </form>
          </>
        )}
      </section>
    </main>
  )
}
