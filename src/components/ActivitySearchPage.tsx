import { useEffect, useRef, useState } from 'react'
import ActivityDetailsDialog, {
  type SearchActivity,
} from './ActivityDetailsDialog.tsx'

const nullableStringFields = [
  'activity_date',
  'job_source',
  'job_title',
  'employer_name',
  'employer_address1',
  'employer_address2',
  'employer_city',
  'employer_state',
  'employer_zip',
  'employer_phone',
  'employer_contact',
  'employer_email',
  'start_date',
  'result_other',
  'notes',
] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isSearchActivity(value: unknown): value is SearchActivity {
  if (!isRecord(value)) {
    return false
  }

  const hiringResult = value.hiring_result

  return (
    typeof value.id === 'number' &&
    Number.isInteger(value.id) &&
    nullableStringFields.every(
      (field) => value[field] === null || typeof value[field] === 'string',
    ) &&
    (hiringResult === null ||
      hiringResult === 'hired' ||
      hiringResult === 'not_hired') &&
    typeof value.application_filed === 'boolean'
  )
}

function isActivityListResponse(
  value: unknown,
): value is { activities: SearchActivity[] } {
  return (
    isRecord(value) &&
    Array.isArray(value.activities) &&
    value.activities.every(isSearchActivity)
  )
}

function displayValue(value: string | null): string {
  return value?.trim() ? value : '—'
}

function ActivitySearchPage() {
  const [activities, setActivities] = useState<SearchActivity[]>([])
  const [selectedActivity, setSelectedActivity] =
    useState<SearchActivity | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [hasLoadError, setHasLoadError] = useState(false)
  const viewButtonRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    const controller = new AbortController()

    async function loadActivities() {
      setIsLoading(true)
      setHasLoadError(false)

      try {
        const response = await fetch('/api/activities', {
          signal: controller.signal,
        })

        if (!response.ok) {
          throw new Error(`Activity search returned HTTP ${response.status}.`)
        }

        const body: unknown = await response.json()
        if (!isActivityListResponse(body)) {
          throw new Error('Activity search returned an invalid response.')
        }

        setActivities(body.activities)
      } catch {
        if (!controller.signal.aborted) {
          setHasLoadError(true)
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false)
        }
      }
    }

    void loadActivities()
    return () => controller.abort()
  }, [])

  return (
    <>
      <section className="page-intro" aria-labelledby="search-title">
        <p className="eyebrow">Work search activity</p>
        <h1 id="search-title">Search</h1>
        <p>
          View your 50 most recent activities, sorted by activity date,
          employer, and job title.
        </p>
      </section>

      {isLoading ? (
        <p className="search-state" role="status">
          Loading activities…
        </p>
      ) : hasLoadError ? (
        <div className="search-state search-error" role="alert">
          <p>Activities could not be loaded. Refresh the page to try again.</p>
        </div>
      ) : activities.length === 0 ? (
        <p className="search-state" role="status">
          No activities to display.
        </p>
      ) : (
        <>
          <p className="search-results-count" role="status">
            Showing {activities.length}{' '}
            {activities.length === 1 ? 'activity' : 'activities'}
          </p>
          <section
            className="search-table-container"
            aria-label="Search results"
          >
            <table className="search-table">
              <caption className="visually-hidden">
                Recent work-search activities
              </caption>
              <thead>
                <tr>
                  <th scope="col">View</th>
                  <th scope="col">Date of Activity</th>
                  <th scope="col">Employer Name</th>
                  <th scope="col">Job Title</th>
                </tr>
              </thead>
              <tbody>
                {activities.map((activity) => (
                  <tr key={activity.id}>
                    <td>
                      <button
                        className="view-activity-button"
                        type="button"
                        aria-label={`View activity for ${displayValue(activity.employer_name)}`}
                        onClick={(event) => {
                          viewButtonRef.current = event.currentTarget
                          setSelectedActivity(activity)
                        }}
                      >
                        View
                      </button>
                    </td>
                    <td>{displayValue(activity.activity_date)}</td>
                    <td>{displayValue(activity.employer_name)}</td>
                    <td>{displayValue(activity.job_title)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}

      <ActivityDetailsDialog
        activity={selectedActivity}
        onClose={() => {
          setSelectedActivity(null)
          requestAnimationFrame(() => viewButtonRef.current?.focus())
        }}
      />
    </>
  )
}

export default ActivitySearchPage
