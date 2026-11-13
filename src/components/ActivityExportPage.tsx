import { useEffect, useState } from 'react'
import {
  type ActivityPageSize,
  activityPageSizes,
  isActivityListResponse,
  isExportResponse,
} from '../activityApi.ts'
import {
  type ExportSelectionItem,
  readExportSelection,
  saveExportPreview,
  saveExportSelection,
} from '../exportStorage.ts'
import type { SearchActivity } from './ActivityDetailsDialog.tsx'

const maximumSelection = 10

function displayValue(value: string | null): string {
  return value?.trim() ? value : '—'
}

function selectionFromActivity(activity: SearchActivity): ExportSelectionItem {
  return {
    id: activity.id,
    activity_date: activity.activity_date,
    employer_name: activity.employer_name,
    job_title: activity.job_title,
  }
}

function ActivityExportPage() {
  const [storedSelection] = useState(readExportSelection)
  const [activities, setActivities] = useState<SearchActivity[]>([])
  const [selectedActivities, setSelectedActivities] = useState(
    storedSelection.items,
  )
  const [isLoading, setIsLoading] = useState(true)
  const [hasLoadError, setHasLoadError] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const [selectionStorageError, setSelectionStorageError] = useState(
    storedSelection.unavailable,
  )
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState<ActivityPageSize>(5)
  const [totalRecords, setTotalRecords] = useState(0)
  const [totalPages, setTotalPages] = useState(0)

  useEffect(() => {
    const controller = new AbortController()

    async function loadActivities() {
      setIsLoading(true)
      setHasLoadError(false)

      try {
        const response = await fetch(
          `/api/activities?page=${currentPage}&pageSize=${pageSize}`,
          { signal: controller.signal },
        )
        if (!response.ok) {
          throw new Error(`Activity list returned HTTP ${response.status}.`)
        }

        const body: unknown = await response.json()
        if (!isActivityListResponse(body, pageSize)) {
          throw new Error('Activity list returned an invalid response.')
        }

        setActivities(body.activities)
        setCurrentPage(body.page)
        setTotalRecords(body.totalRecords)
        setTotalPages(body.totalPages)
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
  }, [currentPage, pageSize])

  const firstResult = (currentPage - 1) * pageSize + 1
  const lastResult = Math.min(currentPage * pageSize, totalRecords)
  const selectedIds = new Set(selectedActivities.map((activity) => activity.id))

  function updateSelection(nextSelection: ExportSelectionItem[]) {
    setSelectedActivities(nextSelection)
    setSelectionStorageError(!saveExportSelection(nextSelection))
  }

  function handlePageSizeChange(value: string) {
    const selectedPageSize = activityPageSizes.find(
      (size) => size.toString() === value,
    )
    if (selectedPageSize === undefined) {
      return
    }

    setPageSize(selectedPageSize)
    setCurrentPage(1)
  }

  function toggleActivity(activity: SearchActivity, checked: boolean) {
    if (checked) {
      if (
        selectedIds.has(activity.id) ||
        selectedActivities.length >= maximumSelection
      ) {
        return
      }
      updateSelection([...selectedActivities, selectionFromActivity(activity)])
      return
    }

    updateSelection(
      selectedActivities.filter((selected) => selected.id !== activity.id),
    )
  }

  async function handleExport() {
    if (selectedActivities.length === 0 || isExporting) {
      return
    }

    setExportError(null)
    setIsExporting(true)
    try {
      const ids = selectedActivities.map((activity) => activity.id)
      const response = await fetch('/api/activities/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      })

      if (response.status === 404) {
        setExportError(
          'One or more selected activities are no longer available. Remove them and try again.',
        )
        return
      }
      if (!response.ok) {
        throw new Error(`Export request returned HTTP ${response.status}.`)
      }

      const body: unknown = await response.json()
      if (!isExportResponse(body, ids.length)) {
        throw new Error('Export request returned invalid activity details.')
      }

      const returnedIds = new Set(
        body.activities.map((activity) => activity.id),
      )
      if (ids.some((id) => !returnedIds.has(id))) {
        throw new Error(
          'Export response did not contain every selected record.',
        )
      }
      if (!saveExportPreview(body.activities)) {
        setExportError(
          'The print preview could not be opened in this browser session. Please allow session storage and try again.',
        )
        return
      }

      window.location.assign('/export/print')
    } catch {
      setExportError(
        'The selected activities could not be prepared for export. Please try again.',
      )
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <>
      <section className="page-intro" aria-labelledby="export-title">
        <p className="eyebrow">Work search activity</p>
        <h1 id="export-title">Export/Print Activities</h1>
        <p>
          Select up to 10 activities across pages, then review and print them or
          save them as a PDF.
        </p>
      </section>

      <section
        className="export-selection-panel"
        aria-labelledby="selection-title"
      >
        <div className="export-selection-heading">
          <div>
            <h2 id="selection-title">Selected activities</h2>
            <p role="status">{selectedActivities.length} of 10 selected</p>
          </div>
          <button
            className="button button-primary"
            type="button"
            disabled={selectedActivities.length === 0 || isExporting}
            onClick={() => void handleExport()}
          >
            {isExporting ? 'Preparing preview…' : 'Export checked records'}
          </button>
        </div>
        {selectedActivities.length > 0 ? (
          <ul className="export-selected-list">
            {selectedActivities.map((activity) => (
              <li key={activity.id}>
                <span>
                  {displayValue(activity.activity_date)} ·{' '}
                  {displayValue(activity.employer_name)} ·{' '}
                  {displayValue(activity.job_title)}
                </span>
                <button
                  className="view-activity-button"
                  type="button"
                  aria-label={`Remove ${displayValue(activity.employer_name)} from export selection`}
                  onClick={() =>
                    updateSelection(
                      selectedActivities.filter(
                        (selected) => selected.id !== activity.id,
                      ),
                    )
                  }
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="export-selection-empty">
            Choose activities below. Your selection stays checked as you move
            between pages.
          </p>
        )}
        {selectionStorageError && (
          <p className="export-warning" role="status">
            Your selection could not be saved for return navigation in this
            browser session.
          </p>
        )}
        {exportError && (
          <p className="export-error" role="alert">
            {exportError}
          </p>
        )}
      </section>

      {isLoading ? (
        <p className="search-state" role="status">
          Loading activities…
        </p>
      ) : hasLoadError ? (
        <p className="search-state search-error" role="alert">
          Activities could not be loaded. Refresh the page to try again.
        </p>
      ) : activities.length === 0 ? (
        <p className="search-state" role="status">
          No activities to display.
        </p>
      ) : (
        <>
          <div className="search-results-toolbar">
            <p className="search-results-count" role="status">
              Showing {firstResult}–{lastResult} of {totalRecords} activities
            </p>
            <label className="page-size-control">
              Rows per page
              <select
                value={pageSize}
                onChange={(event) =>
                  handlePageSizeChange(event.currentTarget.value)
                }
              >
                {activityPageSizes.map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <section
            className="search-table-container"
            aria-label="Activities available to export"
          >
            <table className="search-table export-table">
              <caption className="search-results-title">
                Work-search activities
              </caption>
              <thead>
                <tr>
                  <th scope="col" aria-label="Select activity"></th>
                  <th scope="col">Date of Activity</th>
                  <th scope="col">Employer/Agency Name</th>
                  <th scope="col">Job Title</th>
                </tr>
              </thead>
              <tbody>
                {activities.map((activity) => {
                  const isSelected = selectedIds.has(activity.id)
                  const isDisabled =
                    !isSelected && selectedActivities.length >= maximumSelection

                  return (
                    <tr key={activity.id}>
                      <td>
                        <input
                          className="export-activity-checkbox"
                          type="checkbox"
                          checked={isSelected}
                          disabled={isDisabled}
                          aria-label={`Select activity for ${displayValue(activity.employer_name)} on ${displayValue(activity.activity_date)}`}
                          onChange={(event) =>
                            toggleActivity(
                              activity,
                              event.currentTarget.checked,
                            )
                          }
                        />
                      </td>
                      <td>{displayValue(activity.activity_date)}</td>
                      <td>{displayValue(activity.employer_name)}</td>
                      <td>{displayValue(activity.job_title)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </section>
          {totalPages > 1 && (
            <nav className="pagination-controls" aria-label="Activity pages">
              <button
                className="button button-secondary"
                type="button"
                disabled={currentPage <= 1}
                onClick={() => setCurrentPage((page) => page - 1)}
              >
                Previous
              </button>
              <span aria-live="polite">
                Page {currentPage} of {totalPages}
              </span>
              <button
                className="button button-secondary"
                type="button"
                disabled={currentPage >= totalPages}
                onClick={() => setCurrentPage((page) => page + 1)}
              >
                Next
              </button>
            </nav>
          )}
        </>
      )}
    </>
  )
}

export default ActivityExportPage
