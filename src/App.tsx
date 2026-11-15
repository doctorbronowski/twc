import { type FormEvent, type ReactNode, useEffect, useState } from 'react'
import { fetchActivityApi } from './activityApi.ts'
import ActivityExportPage from './components/ActivityExportPage.tsx'
import ActivityForm, {
  type ActivityFormValues,
} from './components/ActivityForm.tsx'
import ActivityPrintPreviewPage from './components/ActivityPrintPreviewPage.tsx'
import ActivitySearchPage from './components/ActivitySearchPage.tsx'
import {
  type AuthUser,
  EmailChangeVerificationPage,
  EmailVerificationPage,
  LoginPage,
  PasswordResetPage,
} from './components/AuthPages.tsx'
import PasswordInput from './components/PasswordInput.tsx'
import { isValidPassword } from './passwordValidation.ts'
import './index.css'

type Page = 'home' | 'enter' | 'search' | 'export' | 'account'

interface Notice {
  type: 'success' | 'error'
  message: string
}

interface AppFrameProps {
  activePage: Page
  children: ReactNode
  user: AuthUser
  onSignOut: () => void
  isSigningOut: boolean
  signOutError: string | null
  notice?: Notice | null
  onDismissNotice?: () => void
}

interface ProtectedPageProps {
  user: AuthUser
  onSignOut: () => void
  isSigningOut: boolean
  signOutError: string | null
}

const navigation: { label: string; href: string; page: Page }[] = [
  { label: 'Home', href: '/', page: 'home' },
  { label: 'Enter Activity', href: '/enter', page: 'enter' },
  { label: 'View/Edit Activities', href: '/search', page: 'search' },
  { label: 'Export/Print Activities', href: '/export', page: 'export' },
  { label: 'Manage Account', href: '/account', page: 'account' },
]

function AppFrame({
  activePage,
  children,
  onSignOut,
  isSigningOut,
  signOutError,
  notice,
  onDismissNotice,
}: AppFrameProps) {
  return (
    <div className="app-shell">
      <header className="site-header">
        <div className="header-inner">
          <a className="brand" href="/" aria-label="TWC Work Search home">
            <span className="brand-mark" aria-hidden="true">
              T
            </span>
            <span>TWC Work Search</span>
          </a>
          <nav className="top-nav" aria-label="Main navigation">
            {navigation.map((item) => (
              <a
                key={item.page}
                href={item.href}
                aria-current={activePage === item.page ? 'page' : undefined}
              >
                {item.label}
              </a>
            ))}
          </nav>
          <div className="header-actions">
            <div className="header-account">
              <button
                className="sign-out-button"
                type="button"
                disabled={isSigningOut}
                onClick={onSignOut}
              >
                {isSigningOut ? 'Signing out…' : 'Sign out'}
              </button>
            </div>
            {signOutError && (
              <span className="sign-out-error" role="alert">
                {signOutError}
              </span>
            )}
          </div>
        </div>
      </header>

      {notice && onDismissNotice && (
        <div className={`notice-banner notice-${notice.type}`}>
          <p role={notice.type === 'error' ? 'alert' : 'status'}>
            {notice.message}
          </p>
          <button type="button" onClick={onDismissNotice}>
            Close
          </button>
        </div>
      )}

      <main className="content-shell">{children}</main>

      <footer className="site-footer">
        <span>TWC Work Search Activity</span>
        <span>Local activity tracker</span>
      </footer>
    </div>
  )
}

function DashboardPage(props: ProtectedPageProps) {
  return (
    <AppFrame activePage="home" {...props}>
      <section className="welcome-panel" aria-labelledby="welcome-title">
        <p className="eyebrow">Work search activity</p>
        <h1 id="welcome-title">Welcome</h1>
        <p>
          Keep your work-search activity organized in one place. Record a new
          activity or visit Search to review and update your records.
        </p>
      </section>

      <section className="page-section" aria-labelledby="get-started-title">
        <div className="section-heading">
          <p className="eyebrow">Get started</p>
          <h2 id="get-started-title">What would you like to do?</h2>
        </div>
        <div className="quick-links">
          <a className="quick-link" href="/enter">
            <span className="quick-link-icon" aria-hidden="true">
              +
            </span>
            <span className="quick-link-copy">
              <span className="quick-link-title">Enter an activity</span>
              <span className="quick-link-description">
                Record a work-search activity and its result.
              </span>
            </span>
            <span className="quick-link-arrow" aria-hidden="true">
              →
            </span>
          </a>
          <a className="quick-link" href="/search">
            <span className="quick-link-icon search-icon" aria-hidden="true">
              ⌕
            </span>
            <span className="quick-link-copy">
              <span className="quick-link-title">Search activities</span>
              <span className="quick-link-description">
                Review and update your recorded work-search activities.
              </span>
            </span>
            <span className="quick-link-arrow" aria-hidden="true">
              →
            </span>
          </a>
        </div>
      </section>
    </AppFrame>
  )
}

function EnterPage(props: ProtectedPageProps) {
  const [notice, setNotice] = useState<Notice | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    if (notice) {
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }, [notice])

  async function handleSubmit(activity: ActivityFormValues) {
    setNotice(null)
    setIsSubmitting(true)

    try {
      const response = await fetchActivityApi('/api/activities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(activity),
      })

      if (!response.ok) {
        setNotice({
          type: 'error',
          message: 'We couldn’t save the activity. Please try again.',
        })
        return false
      }

      setNotice({
        type: 'success',
        message: 'Activity saved successfully.',
      })
      return true
    } catch {
      setNotice({
        type: 'error',
        message: 'We couldn’t save the activity. Please try again.',
      })
      return false
    } finally {
      setIsSubmitting(false)
    }
  }

  function handleClear() {
    setNotice(null)
  }

  return (
    <AppFrame
      activePage="enter"
      {...props}
      notice={notice}
      onDismissNotice={() => setNotice(null)}
    >
      <section className="page-intro" aria-labelledby="enter-title">
        <p className="eyebrow">Work search activity</p>
        <h1 id="enter-title">Enter an activity</h1>
        <p>
          Record the details of an employer/agency contact or job application.
        </p>
      </section>
      <ActivityForm
        isSubmitting={isSubmitting}
        onClear={handleClear}
        onSubmit={handleSubmit}
      />
    </AppFrame>
  )
}

function SearchPage(props: ProtectedPageProps) {
  const [notice, setNotice] = useState<Notice | null>(null)

  useEffect(() => {
    if (notice) {
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }, [notice])

  return (
    <AppFrame
      activePage="search"
      {...props}
      notice={notice}
      onDismissNotice={() => setNotice(null)}
    >
      <ActivitySearchPage
        onNoticeChange={setNotice}
        onEditSuccess={() =>
          setNotice({
            type: 'success',
            message: 'Activity updated successfully.',
          })
        }
      />
    </AppFrame>
  )
}

function ExportPage(props: ProtectedPageProps) {
  return (
    <AppFrame activePage="export" {...props}>
      <ActivityExportPage />
    </AppFrame>
  )
}

function PrintPreviewPage(props: ProtectedPageProps) {
  return (
    <AppFrame activePage="export" {...props}>
      <ActivityPrintPreviewPage />
    </AppFrame>
  )
}

interface AccountDetails {
  email: string
  emailVerified: boolean
  pendingEmail: string | null
}

function isAccountDetailsResponse(
  value: unknown,
): value is { account: AccountDetails } {
  return (
    isRecord(value) &&
    isRecord(value.account) &&
    typeof value.account.email === 'string' &&
    typeof value.account.emailVerified === 'boolean' &&
    (value.account.pendingEmail === null ||
      typeof value.account.pendingEmail === 'string')
  )
}

function isPendingEmailResponse(
  value: unknown,
): value is { pendingEmail: string } {
  return isRecord(value) && typeof value.pendingEmail === 'string'
}

async function getAccountDetails(): Promise<AccountDetails> {
  const response = await fetchActivityApi('/api/auth/account')
  if (!response.ok) {
    throw new Error('Account information could not be loaded.')
  }
  const body: unknown = await response.json()
  if (!isAccountDetailsResponse(body)) {
    throw new Error('The account response was invalid.')
  }
  return body.account
}

function postAccountRequest(path: string, value: Record<string, unknown>) {
  return fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(value),
  })
}

async function readResponseBody(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return null
  }
}

function apiErrorMessage(body: unknown, fallback: string): string {
  return isRecord(body) && typeof body.error === 'string'
    ? body.error
    : fallback
}

function dispatchSessionExpiredIfNeeded(
  response: Response,
  body: unknown,
): void {
  if (
    response.status === 401 &&
    isRecord(body) &&
    body.error === 'Authentication is required.'
  ) {
    window.dispatchEvent(new Event('twc:session-expired'))
  }
}

function ManageAccountPage(props: ProtectedPageProps) {
  const [account, setAccount] = useState<AccountDetails | null>(null)
  const [loadState, setLoadState] = useState<'loading' | 'loaded' | 'error'>(
    'loading',
  )
  const [newEmail, setNewEmail] = useState('')
  const [emailChangePassword, setEmailChangePassword] = useState('')
  const [isEmailChangeSubmitting, setIsEmailChangeSubmitting] = useState(false)
  const [emailChangeError, setEmailChangeError] = useState<string | null>(null)
  const [emailChangeSuccess, setEmailChangeSuccess] = useState<string | null>(
    null,
  )
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [isChangingPassword, setIsChangingPassword] = useState(false)
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [passwordSuccess, setPasswordSuccess] = useState<string | null>(null)
  const [deactivationPassword, setDeactivationPassword] = useState('')
  const [isDeactivating, setIsDeactivating] = useState(false)
  const [deactivationConfirmed, setDeactivationConfirmed] = useState(false)
  const [deactivationError, setDeactivationError] = useState<string | null>(
    null,
  )

  useEffect(() => {
    let active = true
    void getAccountDetails()
      .then((details) => {
        if (active) {
          setAccount(details)
          setLoadState('loaded')
        }
      })
      .catch(() => {
        if (active) {
          setLoadState('error')
        }
      })

    return () => {
      active = false
    }
  }, [])

  async function handleEmailChange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setEmailChangeError(null)
    setEmailChangeSuccess(null)
    setIsEmailChangeSubmitting(true)

    try {
      const response = await postAccountRequest('/api/auth/email-change', {
        email: newEmail,
        currentPassword: emailChangePassword,
      })
      const body = await readResponseBody(response)
      if (!response.ok) {
        const message = apiErrorMessage(
          body,
          'The email change could not be requested. Please try again.',
        )
        dispatchSessionExpiredIfNeeded(response, body)
        setEmailChangeError(message)
        if (isPendingEmailResponse(body)) {
          setAccount((current) =>
            current ? { ...current, pendingEmail: body.pendingEmail } : current,
          )
        }
        return
      }
      if (!isPendingEmailResponse(body)) {
        throw new Error('The email-change response was invalid.')
      }

      setAccount((current) =>
        current ? { ...current, pendingEmail: body.pendingEmail } : current,
      )
      setNewEmail('')
      setEmailChangePassword('')
      setEmailChangeSuccess(
        `A verification email was sent to ${body.pendingEmail}. Your current email remains your sign-in until the new address is verified.`,
      )
    } catch {
      setEmailChangeError(
        'The email change could not be requested. Please try again.',
      )
    } finally {
      setIsEmailChangeSubmitting(false)
    }
  }

  async function handleResendEmailChange() {
    setEmailChangeError(null)
    setEmailChangeSuccess(null)
    setIsEmailChangeSubmitting(true)

    try {
      const response = await postAccountRequest(
        '/api/auth/email-change/resend',
        {},
      )
      const body = await readResponseBody(response)
      if (!response.ok) {
        const message = apiErrorMessage(
          body,
          'The verification email could not be resent. Please try again.',
        )
        dispatchSessionExpiredIfNeeded(response, body)
        setEmailChangeError(message)
        return
      }
      if (!isPendingEmailResponse(body)) {
        throw new Error('The email-change response was invalid.')
      }
      setAccount((current) =>
        current ? { ...current, pendingEmail: body.pendingEmail } : current,
      )
      setEmailChangeSuccess(
        `A new verification email was sent to ${body.pendingEmail}.`,
      )
    } catch {
      setEmailChangeError(
        'The verification email could not be resent. Please try again.',
      )
    } finally {
      setIsEmailChangeSubmitting(false)
    }
  }

  async function handleCancelEmailChange() {
    setEmailChangeError(null)
    setEmailChangeSuccess(null)
    setIsEmailChangeSubmitting(true)

    try {
      const response = await postAccountRequest(
        '/api/auth/email-change/cancel',
        {},
      )
      const body = await readResponseBody(response)
      if (!response.ok) {
        const message = apiErrorMessage(
          body,
          'The pending email change could not be cancelled. Please try again.',
        )
        dispatchSessionExpiredIfNeeded(response, body)
        setEmailChangeError(message)
        return
      }
      setAccount((current) =>
        current ? { ...current, pendingEmail: null } : current,
      )
      setEmailChangeSuccess('The pending email change was cancelled.')
    } catch {
      setEmailChangeError(
        'The pending email change could not be cancelled. Please try again.',
      )
    } finally {
      setIsEmailChangeSubmitting(false)
    }
  }

  async function handlePasswordChange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPasswordError(null)
    setPasswordSuccess(null)

    if (!isValidPassword(newPassword)) {
      setPasswordError(
        'Use 8–1024 characters with at least one uppercase letter, one lowercase letter, and one number.',
      )
      return
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('The passwords do not match.')
      return
    }

    setIsChangingPassword(true)
    try {
      const response = await fetch('/api/auth/password', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentPassword,
          password: newPassword,
          confirmPassword,
        }),
      })

      const body = await readResponseBody(response)

      if (!response.ok) {
        const message = apiErrorMessage(
          body,
          'The password could not be changed. Please try again.',
        )
        dispatchSessionExpiredIfNeeded(response, body)
        setPasswordError(message)
        return
      }

      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setPasswordSuccess(
        'Password changed. You remain signed in, and other sessions have been signed out.',
      )
    } catch {
      setPasswordError('The password could not be changed. Please try again.')
    } finally {
      setIsChangingPassword(false)
    }
  }

  async function handleDeactivateAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setDeactivationError(null)
    if (!deactivationConfirmed) {
      setDeactivationError(
        'Confirm that you understand the account will be deactivated.',
      )
      return
    }

    setIsDeactivating(true)
    try {
      const response = await fetch('/api/auth/account/deactivate', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentPassword: deactivationPassword,
          confirmed: true,
        }),
      })
      const body = await readResponseBody(response)
      if (!response.ok) {
        const message = apiErrorMessage(
          body,
          'The account could not be deactivated. Please try again.',
        )
        dispatchSessionExpiredIfNeeded(response, body)
        setDeactivationError(message)
        return
      }

      window.location.assign('/login?deactivated=1')
    } catch {
      setDeactivationError(
        'The account could not be deactivated. Please try again.',
      )
    } finally {
      setIsDeactivating(false)
    }
  }

  return (
    <AppFrame activePage="account" {...props}>
      <section className="page-intro" aria-labelledby="account-title">
        <p className="eyebrow">Account</p>
        <h1 id="account-title">Manage Account</h1>
        <p>Review your account information and security settings.</p>
      </section>
      <section className="page-section" aria-labelledby="account-info-title">
        <div className="section-heading">
          <h2 id="account-info-title">Account information</h2>
        </div>
        {loadState === 'loading' && (
          <p role="status">Loading account information…</p>
        )}
        {loadState === 'error' && (
          <p className="auth-error" role="alert">
            Account information could not be loaded. Refresh the page to try
            again.
          </p>
        )}
        {loadState === 'loaded' && account && (
          <dl className="account-details-card">
            <div>
              <dt>Email address</dt>
              <dd>{account.email}</dd>
            </div>
            <div>
              <dt>Email status</dt>
              <dd>{account.emailVerified ? 'Verified' : 'Not verified'}</dd>
            </div>
            {account.pendingEmail && (
              <div>
                <dt>Pending email change</dt>
                <dd>{account.pendingEmail}</dd>
              </div>
            )}
          </dl>
        )}
      </section>
      <section className="page-section" aria-labelledby="change-email-title">
        <div className="section-heading">
          <h2 id="change-email-title">Change email address</h2>
        </div>
        {emailChangeError && (
          <p className="auth-error" role="alert">
            {emailChangeError}
          </p>
        )}
        {emailChangeSuccess && (
          <p className="auth-success" role="status">
            {emailChangeSuccess}
          </p>
        )}
        {loadState === 'loading' && (
          <p role="status">Loading email-change status…</p>
        )}
        {loadState === 'error' && (
          <p className="auth-error" role="alert">
            Email-change options are unavailable. Refresh the page to try again.
          </p>
        )}
        {loadState === 'loaded' &&
          account &&
          (account.pendingEmail ? (
            <div className="account-email-change-pending">
              <p>
                A verification link was sent to{' '}
                <strong>{account.pendingEmail}</strong>. Your current email
                remains your sign-in until the new address is verified.
              </p>
              <div className="account-action-buttons">
                <button
                  className="button button-secondary"
                  type="button"
                  disabled={isEmailChangeSubmitting}
                  onClick={() => void handleResendEmailChange()}
                >
                  {isEmailChangeSubmitting
                    ? 'Please wait…'
                    : 'Resend verification email'}
                </button>
                <button
                  className="button button-secondary"
                  type="button"
                  disabled={isEmailChangeSubmitting}
                  onClick={() => void handleCancelEmailChange()}
                >
                  Cancel email change
                </button>
              </div>
            </div>
          ) : (
            <form
              className="auth-form account-form-card"
              onSubmit={(event) => void handleEmailChange(event)}
            >
              <div className="form-field">
                <label htmlFor="new-account-email">New email address</label>
                <input
                  id="new-account-email"
                  type="email"
                  autoComplete="email"
                  maxLength={254}
                  required
                  value={newEmail}
                  onChange={(event) => {
                    setNewEmail(event.target.value)
                    setEmailChangeError(null)
                    setEmailChangeSuccess(null)
                  }}
                />
              </div>
              <div className="form-field">
                <label htmlFor="email-change-current-password">
                  Current password
                </label>
                <PasswordInput
                  id="email-change-current-password"
                  autoComplete="current-password"
                  maxLength={1024}
                  required
                  value={emailChangePassword}
                  onChange={(event) => {
                    setEmailChangePassword(event.target.value)
                    setEmailChangeError(null)
                    setEmailChangeSuccess(null)
                  }}
                />
              </div>
              <button
                className="button button-primary auth-submit"
                type="submit"
                disabled={isEmailChangeSubmitting}
              >
                {isEmailChangeSubmitting
                  ? 'Sending verification…'
                  : 'Send verification email'}
              </button>
            </form>
          ))}
      </section>
      <section className="page-section" aria-labelledby="change-password-title">
        <div className="section-heading">
          <h2 id="change-password-title">Change password</h2>
        </div>
        <form
          className="auth-form account-form-card"
          onSubmit={(event) => void handlePasswordChange(event)}
        >
          <div className="form-field">
            <label htmlFor="current-account-password">Current password</label>
            <PasswordInput
              id="current-account-password"
              autoComplete="current-password"
              maxLength={1024}
              required
              value={currentPassword}
              onChange={(event) => {
                setCurrentPassword(event.target.value)
                setPasswordError(null)
                setPasswordSuccess(null)
              }}
            />
          </div>
          <div className="form-field">
            <label htmlFor="new-account-password">New password</label>
            <PasswordInput
              id="new-account-password"
              autoComplete="new-password"
              minLength={8}
              maxLength={1024}
              required
              value={newPassword}
              aria-describedby="account-password-policy"
              onChange={(event) => {
                setNewPassword(event.target.value)
                setPasswordError(null)
                setPasswordSuccess(null)
              }}
            />
            <span className="field-hint" id="account-password-policy">
              At least 8 characters, including uppercase, lowercase, and a
              number.
            </span>
          </div>
          <div className="form-field">
            <label htmlFor="confirm-account-password">
              Confirm new password
            </label>
            <PasswordInput
              id="confirm-account-password"
              autoComplete="new-password"
              maxLength={1024}
              required
              value={confirmPassword}
              onChange={(event) => {
                setConfirmPassword(event.target.value)
                setPasswordError(null)
                setPasswordSuccess(null)
              }}
            />
          </div>
          {passwordError && (
            <p className="auth-error" role="alert">
              {passwordError}
            </p>
          )}
          {passwordSuccess && (
            <p className="auth-success" role="status">
              {passwordSuccess}
            </p>
          )}
          <button
            className="button button-primary auth-submit"
            type="submit"
            disabled={isChangingPassword}
          >
            {isChangingPassword ? 'Changing password…' : 'Change password'}
          </button>
        </form>
      </section>
      <section
        className="page-section"
        aria-labelledby="deactivate-account-title"
      >
        <div className="section-heading">
          <h2 id="deactivate-account-title">Deactivate account</h2>
        </div>
        <p className="account-deactivation-warning">
          Deactivation signs you out and blocks future sign-in. Your account
          email and work-search activities remain stored. Self-service
          reactivation is not available; contact an administrator if you need
          access restored.
        </p>
        {deactivationError && (
          <p className="auth-error" role="alert">
            {deactivationError}
          </p>
        )}
        <form
          className="auth-form account-form-card"
          onSubmit={(event) => void handleDeactivateAccount(event)}
        >
          <div className="form-field">
            <label htmlFor="deactivate-account-password">
              Current password
            </label>
            <PasswordInput
              id="deactivate-account-password"
              autoComplete="current-password"
              maxLength={1024}
              required
              value={deactivationPassword}
              onChange={(event) => {
                setDeactivationPassword(event.target.value)
                setDeactivationError(null)
              }}
            />
          </div>
          <label className="account-deactivation-confirm">
            <input
              type="checkbox"
              required
              checked={deactivationConfirmed}
              onChange={(event) => {
                setDeactivationConfirmed(event.target.checked)
                setDeactivationError(null)
              }}
            />
            <span>
              I understand I cannot sign in again unless an administrator
              restores my account.
            </span>
          </label>
          <button
            className="button button-danger auth-submit"
            type="submit"
            disabled={isDeactivating}
          >
            {isDeactivating ? 'Deactivating account…' : 'Deactivate account'}
          </button>
        </form>
      </section>
    </AppFrame>
  )
}

function CurrentPage(props: ProtectedPageProps) {
  const path = window.location.pathname.replace(/\/+$/, '') || '/'

  if (path === '/account') {
    return <ManageAccountPage {...props} />
  }

  if (path === '/export/print') {
    return <PrintPreviewPage {...props} />
  }

  if (path === '/export') {
    return <ExportPage {...props} />
  }

  if (path === '/enter') {
    return <EnterPage {...props} />
  }

  if (path === '/search') {
    return <SearchPage {...props} />
  }

  return <DashboardPage {...props} />
}

type SessionState =
  | { status: 'loading' }
  | { status: 'authenticated'; user: AuthUser }
  | { status: 'unauthenticated' }
  | { status: 'error' }

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

function readReturnDestination(path: string): string {
  if (path === '/login') {
    const requested = new URLSearchParams(window.location.search).get(
      'returnTo',
    )
    if (requested?.startsWith('/') && !requested.startsWith('//')) {
      const url = new URL(requested, window.location.origin)
      if (url.origin === window.location.origin) {
        return `${url.pathname}${url.search}`
      }
    }
    return '/'
  }
  return `${path}${window.location.search}`
}

async function readSession(): Promise<SessionState> {
  try {
    const response = await fetch('/api/auth/session', {
      credentials: 'same-origin',
    })
    if (!response.ok) {
      return { status: 'error' }
    }

    const body: unknown = await response.json()
    if (!isRecord(body) || typeof body.authenticated !== 'boolean') {
      return { status: 'error' }
    }
    if (body.authenticated && isAuthUser(body.user)) {
      return { status: 'authenticated', user: body.user }
    }
    if (!body.authenticated) {
      return { status: 'unauthenticated' }
    }
  } catch {
    return { status: 'error' }
  }
  return { status: 'error' }
}

function App() {
  const path = window.location.pathname.replace(/\/+$/, '') || '/'
  const returnDestination = readReturnDestination(path)
  const [session, setSession] = useState<SessionState>({ status: 'loading' })
  const [sessionExpired, setSessionExpired] = useState(false)
  const [isSigningOut, setIsSigningOut] = useState(false)
  const [signOutError, setSignOutError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void readSession().then((result) => {
      if (active) {
        setSession(result)
      }
    })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    function handleSessionExpired() {
      setSessionExpired(true)
    }

    window.addEventListener('twc:session-expired', handleSessionExpired)
    return () => {
      window.removeEventListener('twc:session-expired', handleSessionExpired)
    }
  }, [])

  useEffect(() => {
    if (session.status === 'authenticated' && path === '/login') {
      window.location.replace('/')
    }
  }, [session.status, path])

  async function handleSignOut() {
    if (isSigningOut) {
      return
    }

    setIsSigningOut(true)
    setSignOutError(null)
    try {
      const response = await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'same-origin',
      })
      if (!response.ok) {
        throw new Error('Sign out could not be completed.')
      }
      window.location.replace('/login')
    } catch {
      setSignOutError('Sign out failed. Please try again.')
    } finally {
      setIsSigningOut(false)
    }
  }

  if (path === '/verify-email') {
    return <EmailVerificationPage />
  }

  if (path === '/verify-email-change') {
    return <EmailChangeVerificationPage />
  }

  if (path === '/reset-password') {
    return <PasswordResetPage />
  }

  if (path === '/login') {
    if (session.status === 'loading') {
      return (
        <main className="auth-state" role="status">
          Checking your session…
        </main>
      )
    }
    if (session.status === 'authenticated') {
      return (
        <main className="auth-state" role="status">
          You’re already signed in. Redirecting…
        </main>
      )
    }
    return (
      <LoginPage onLogin={() => window.location.replace(returnDestination)} />
    )
  }

  if (session.status === 'loading') {
    return (
      <main className="auth-state" role="status">
        Checking your session…
      </main>
    )
  }

  if (session.status === 'error') {
    return (
      <main className="auth-state">
        <p role="alert">
          We couldn’t verify your session. Check your connection and try again.
        </p>
        <button
          className="button button-primary"
          type="button"
          onClick={() => {
            setSession({ status: 'loading' })
            void readSession().then(setSession)
          }}
        >
          Retry
        </button>
      </main>
    )
  }

  if (session.status === 'unauthenticated') {
    return (
      <LoginPage onLogin={() => window.location.replace(returnDestination)} />
    )
  }

  const protectedPageProps: ProtectedPageProps = {
    user: session.user,
    onSignOut: () => void handleSignOut(),
    isSigningOut,
    signOutError,
  }

  return (
    <>
      <div inert={sessionExpired} aria-hidden={sessionExpired}>
        <CurrentPage {...protectedPageProps} />
      </div>
      {sessionExpired && (
        <LoginPage
          overlay
          onLogin={(user) => {
            setSession({ status: 'authenticated', user })
            setSessionExpired(false)
          }}
        />
      )}
    </>
  )
}

export default App
