import { type FormEvent, type ReactNode, useEffect, useState } from 'react'
import ActivityExportPage from './components/ActivityExportPage.tsx'
import ActivityForm, {
  type ActivityFormValues,
} from './components/ActivityForm.tsx'
import ActivityPrintPreviewPage from './components/ActivityPrintPreviewPage.tsx'
import ActivitySearchPage from './components/ActivitySearchPage.tsx'
import './index.css'

type Page = 'home' | 'enter' | 'search' | 'export'

interface Notice {
  type: 'success' | 'error'
  message: string
}

interface AppFrameProps {
  activePage: Page
  children: ReactNode
  username: string
  notice?: Notice | null
  onDismissNotice?: () => void
}

interface AuthSession {
  username: string
}

type AuthState =
  | { status: 'loading' }
  | { status: 'signed-out' }
  | { status: 'signed-in'; session: AuthSession }
  | { status: 'error' }

const navigation: { label: string; href: string; page: Page }[] = [
  { label: 'Home', href: '/', page: 'home' },
  { label: 'Enter Activity', href: '/enter', page: 'enter' },
  { label: 'View/Edit Activities', href: '/search', page: 'search' },
  { label: 'Export/Print Activities', href: '/export', page: 'export' },
]

function AppFrame({
  activePage,
  children,
  username,
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
          <div className="header-actions">
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
            <SignOutButton username={username} />
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

function SignOutButton({ username }: { username: string }) {
  const [error, setError] = useState(false)
  const [isSigningOut, setIsSigningOut] = useState(false)

  async function handleSignOut() {
    setError(false)
    setIsSigningOut(true)
    try {
      const response = await fetch('/api/auth/logout', { method: 'POST' })
      if (!response.ok) {
        setError(true)
        return
      }
      window.location.reload()
    } catch {
      setError(true)
    } finally {
      setIsSigningOut(false)
    }
  }

  return (
    <div className="header-account">
      <span className="signed-in-name">{username}</span>
      {error && (
        <span className="sign-out-error" role="alert">
          Could not sign out. Please try again.
        </span>
      )}
      <button
        className="sign-out-button"
        disabled={isSigningOut}
        onClick={handleSignOut}
        type="button"
      >
        {isSigningOut ? 'Signing out…' : 'Sign out'}
      </button>
    </div>
  )
}

function LoginPage({
  onAuthenticated,
}: {
  onAuthenticated: (session: AuthSession) => void
}) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setIsSubmitting(true)

    let response: Response
    try {
      response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })
    } catch {
      setError('Sign-in is unavailable. Please try again.')
      setIsSubmitting(false)
      return
    }

    setIsSubmitting(false)
    if (!response.ok) {
      setError(
        response.status === 429
          ? 'Too many sign-in attempts. Please try again later.'
          : 'Username or password is incorrect.',
      )
      return
    }

    let result: unknown
    try {
      result = await response.json()
    } catch {
      setError('Sign-in could not be completed. Please try again.')
      return
    }

    if (
      typeof result !== 'object' ||
      result === null ||
      !('authenticated' in result) ||
      !('username' in result) ||
      result.authenticated !== true ||
      typeof result.username !== 'string' ||
      !result.username
    ) {
      setError('Sign-in could not be completed. Please try again.')
      return
    }

    onAuthenticated({ username: result.username })
  }

  return (
    <main className="auth-shell">
      <section className="auth-card" aria-labelledby="sign-in-title">
        <div className="auth-brand" aria-hidden="true">
          T
        </div>
        <p className="eyebrow">TWC Work Search</p>
        <h1 id="sign-in-title">Sign in</h1>
        <p className="auth-description">
          Sign in to access your work-search activities.
        </p>
        <form className="auth-form" onSubmit={handleSubmit}>
          <label className="field" htmlFor="sign-in-username">
            <span>Username</span>
            <input
              autoComplete="username"
              id="sign-in-username"
              onChange={(event) => setUsername(event.target.value)}
              required
              value={username}
            />
          </label>
          <label className="field" htmlFor="sign-in-password">
            <span>Password</span>
            <input
              autoComplete="current-password"
              id="sign-in-password"
              onChange={(event) => setPassword(event.target.value)}
              required
              type="password"
              value={password}
            />
          </label>
          {error && (
            <p className="auth-error" role="alert">
              {error}
            </p>
          )}
          <button
            className="button button-primary auth-submit"
            disabled={isSubmitting}
            type="submit"
          >
            {isSubmitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </section>
    </main>
  )
}

function DashboardPage({ username }: { username: string }) {
  return (
    <AppFrame activePage="home" username={username}>
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

function EnterPage({ username }: { username: string }) {
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
      const response = await fetch('/api/activities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(activity),
      })

      if (!response.ok) {
        setNotice({
          type: 'error',
          message: 'We couldn’t save the activity. Please try again.',
        })
        return
      }

      setNotice({
        type: 'success',
        message: 'Activity saved successfully.',
      })
    } catch {
      setNotice({
        type: 'error',
        message: 'We couldn’t save the activity. Please try again.',
      })
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
      username={username}
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

function SearchPage({ username }: { username: string }) {
  const [notice, setNotice] = useState<Notice | null>(null)

  useEffect(() => {
    if (notice) {
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }, [notice])

  return (
    <AppFrame
      activePage="search"
      username={username}
      notice={notice}
      onDismissNotice={() => setNotice(null)}
    >
      <ActivitySearchPage
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

function ExportPage({ username }: { username: string }) {
  return (
    <AppFrame activePage="export" username={username}>
      <ActivityExportPage />
    </AppFrame>
  )
}

function PrintPreviewPage({ username }: { username: string }) {
  return (
    <AppFrame activePage="export" username={username}>
      <ActivityPrintPreviewPage />
    </AppFrame>
  )
}

function AuthenticatedPages({ username }: { username: string }) {
  const path = window.location.pathname.replace(/\/+$/, '') || '/'

  if (path === '/export/print') {
    return <PrintPreviewPage username={username} />
  }

  if (path === '/export') {
    return <ExportPage username={username} />
  }

  if (path === '/enter') {
    return <EnterPage username={username} />
  }

  if (path === '/search') {
    return <SearchPage username={username} />
  }

  return <DashboardPage username={username} />
}

function App() {
  const [authState, setAuthState] = useState<AuthState>({ status: 'loading' })
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    let isCurrent = true

    async function checkSession() {
      try {
        const response = await fetch(`/api/auth/session?retry=${retry}`)
        if (response.status === 401) {
          if (isCurrent) {
            setAuthState({ status: 'signed-out' })
          }
          return
        }
        if (!response.ok) {
          throw new Error('Unable to verify sign-in status.')
        }

        const session = (await response.json()) as AuthSession & {
          authenticated: boolean
        }
        if (!session.authenticated || !session.username) {
          throw new Error('The sign-in response was invalid.')
        }
        if (isCurrent) {
          setAuthState({
            status: 'signed-in',
            session: { username: session.username },
          })
        }
      } catch {
        if (isCurrent) {
          setAuthState({ status: 'error' })
        }
      }
    }

    void checkSession()
    return () => {
      isCurrent = false
    }
  }, [retry])

  if (authState.status === 'loading') {
    return (
      <main className="auth-state" role="status">
        Checking sign-in…
      </main>
    )
  }

  if (authState.status === 'error') {
    return (
      <main className="auth-state">
        <p role="alert">Could not verify sign-in. Check your connection.</p>
        <button
          className="button button-primary"
          onClick={() => {
            setAuthState({ status: 'loading' })
            setRetry((value) => value + 1)
          }}
          type="button"
        >
          Try again
        </button>
      </main>
    )
  }

  if (authState.status === 'signed-out') {
    return (
      <LoginPage
        onAuthenticated={(session) =>
          setAuthState({ status: 'signed-in', session })
        }
      />
    )
  }

  return <AuthenticatedPages username={authState.session.username} />
}

export default App
