import { type ReactNode, useEffect, useState } from 'react'
import ActivityForm, {
  type ActivityFormValues,
} from './components/ActivityForm.tsx'
import ActivitySearchPage from './components/ActivitySearchPage.tsx'
import './index.css'

type Page = 'home' | 'enter' | 'search'

interface Notice {
  type: 'success' | 'error'
  message: string
}

interface AppFrameProps {
  activePage: Page
  children: ReactNode
  notice?: Notice | null
  onDismissNotice?: () => void
}

const navigation: { label: string; href: string; page: Page }[] = [
  { label: 'Home', href: '/', page: 'home' },
  { label: 'Enter', href: '/enter', page: 'enter' },
  { label: 'Search', href: '/search', page: 'search' },
]

function AppFrame({
  activePage,
  children,
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

function DashboardPage() {
  return (
    <AppFrame activePage="home">
      <section className="welcome-panel" aria-labelledby="welcome-title">
        <p className="eyebrow">Work search activity</p>
        <h1 id="welcome-title">Welcome</h1>
        <p>
          Keep your work-search activity organized in one place. Record a new
          activity or visit Search to see what’s coming next.
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
                Activity search will be available in a future phase.
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

function EnterPage() {
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
      notice={notice}
      onDismissNotice={() => setNotice(null)}
    >
      <section className="page-intro" aria-labelledby="enter-title">
        <p className="eyebrow">Work search activity</p>
        <h1 id="enter-title">Enter an activity</h1>
        <p>Record the details of an employer contact or job application.</p>
      </section>
      <ActivityForm
        isSubmitting={isSubmitting}
        onClear={handleClear}
        onSubmit={handleSubmit}
      />
    </AppFrame>
  )
}

function SearchPage() {
  return (
    <AppFrame activePage="search">
      <ActivitySearchPage />
    </AppFrame>
  )
}

function App() {
  const path = window.location.pathname.replace(/\/+$/, '') || '/'

  if (path === '/enter') {
    return <EnterPage />
  }

  if (path === '/search') {
    return <SearchPage />
  }

  return <DashboardPage />
}

export default App
