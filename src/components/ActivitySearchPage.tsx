import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  type ActivityPageSize,
  activityPageSizes,
  fetchActivityApi,
  isActivityListResponse,
} from '../activityApi.ts'
import { readExportSelection, saveExportSelection } from '../exportStorage.ts'
import ActivityDetailsDialog, {
  type SearchActivity,
} from './ActivityDetailsDialog.tsx'
import type { ActivityFormValues } from './ActivityForm.tsx'
import EditActivityDialog from './EditActivityDialog.tsx'

interface ActivitySearchPageProps {
  onEditSuccess: () => void
  onNoticeChange: (
    notice: { type: 'success' | 'error'; message: string } | null,
  ) => void
}

function displayValue(value: string | null): string {
  return value?.trim() ? value : '—'
}

function ActivitySearchPage({
  onEditSuccess,
  onNoticeChange,
}: ActivitySearchPageProps) {
  const [activities, setActivities] = useState<SearchActivity[]>([])
  const [selectedActivity, setSelectedActivity] =
    useState<SearchActivity | null>(null)
  const [editingActivity, setEditingActivity] = useState<SearchActivity | null>(
    null,
  )
  const [activityToDelete, setActivityToDelete] =
    useState<SearchActivity | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [hasLoadError, setHasLoadError] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState<ActivityPageSize>(
    activityPageSizes[0],
  )
  const [totalRecords, setTotalRecords] = useState(0)
  const [totalPages, setTotalPages] = useState(0)
  const [refreshVersion, setRefreshVersion] = useState(0)
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const viewButtonRef = useRef<HTMLButtonElement | null>(null)
  const editButtonRef = useRef<HTMLButtonElement | null>(null)
  const deleteButtonRef = useRef<HTMLButtonElement | null>(null)
  const deleteDialogRef = useRef<HTMLDialogElement | null>(null)
  const cancelDeleteRef = useRef<HTMLButtonElement | null>(null)
  const searchTitleRef = useRef<HTMLHeadingElement | null>(null)

  useLayoutEffect(() => {
    if (
      activityToDelete &&
      deleteDialogRef.current &&
      !deleteDialogRef.current.open
    ) {
      deleteDialogRef.current.showModal()
      cancelDeleteRef.current?.focus()
    }
  }, [activityToDelete])

  useEffect(() => {
    const controller = new AbortController()

    async function loadActivities() {
      setIsLoading(true)
      if (refreshVersion > 0) {
        setHasLoadError(false)
      }

      try {
        const response = await fetchActivityApi(
          `/api/activities?page=${currentPage}&pageSize=${pageSize}`,
          { signal: controller.signal },
        )

        if (!response.ok) {
          throw new Error(`Activity search returned HTTP ${response.status}.`)
        }

        const body: unknown = await response.json()
        if (!isActivityListResponse(body, pageSize)) {
          throw new Error('Activity search returned an invalid response.')
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
  }, [currentPage, pageSize, refreshVersion])

  const firstResult = (currentPage - 1) * pageSize + 1
  const lastResult = Math.min(currentPage * pageSize, totalRecords)

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

  async function handleEditSave(
    id: number,
    values: ActivityFormValues,
  ): Promise<void> {
    const response = await fetchActivityApi(`/api/activities/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values),
    })

    if (!response.ok) {
      throw new Error(`Activity update returned HTTP ${response.status}.`)
    }

    onEditSuccess()
    setRefreshVersion((version) => version + 1)
  }

  async function handleDelete(id: number) {
    onNoticeChange(null)
    setDeletingId(id)
    try {
      const response = await fetchActivityApi(`/api/activities/${id}`, {
        method: 'DELETE',
      })
      if (!response.ok) {
        throw new Error(`Activity deletion returned HTTP ${response.status}.`)
      }

      const selection = readExportSelection()
      const selectionUpdated =
        !selection.unavailable &&
        (!selection.items.some((item) => item.id === id) ||
          saveExportSelection(selection.items.filter((item) => item.id !== id)))
      onNoticeChange(
        selectionUpdated
          ? { type: 'success', message: 'Activity deleted successfully.' }
          : {
              type: 'error',
              message:
                'Activity deleted, but the export selection could not be updated. Check it before exporting.',
            },
      )
      setRefreshVersion((version) => version + 1)
      searchTitleRef.current?.focus({ preventScroll: true })
    } catch {
      onNoticeChange({
        type: 'error',
        message: 'The activity could not be deleted. Please try again.',
      })
    } finally {
      setDeletingId(null)
    }
  }

  function cancelDelete() {
    setActivityToDelete(null)
    requestAnimationFrame(() => deleteButtonRef.current?.focus())
  }

  return (
    <>
      <section className="page-intro" aria-labelledby="search-title">
        <p className="eyebrow">Work search activity</p>
        <h1 id="search-title" ref={searchTitleRef} tabIndex={-1}>
          Search
        </h1>
        <p>
          Browse all activities, sorted by activity date, employer/agency, and
          job title.
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
            aria-label="Search results"
          >
            <table className="search-table">
              <caption className="search-results-title">
                Recent work-search activities
              </caption>
              <thead>
                <tr>
                  <th scope="col" aria-label="Activity actions"></th>
                  <th scope="col" aria-label="Edit activity action"></th>
                  <th scope="col">Date of Activity</th>
                  <th scope="col">Employer/Agency Name</th>
                  <th scope="col">Job Title</th>
                  <th scope="col" aria-label="Delete activity"></th>
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
                    <td>
                      <button
                        className="view-activity-button"
                        type="button"
                        aria-label={`Edit activity for ${displayValue(activity.employer_name)}`}
                        onClick={(event) => {
                          editButtonRef.current = event.currentTarget
                          setEditingActivity(activity)
                        }}
                      >
                        Edit
                      </button>
                    </td>
                    <td>{displayValue(activity.activity_date)}</td>
                    <td>{displayValue(activity.employer_name)}</td>
                    <td>{displayValue(activity.job_title)}</td>
                    <td>
                      <button
                        className="delete-activity-button"
                        type="button"
                        aria-label={`Delete activity for ${displayValue(activity.employer_name)}`}
                        title="Delete activity"
                        disabled={deletingId !== null}
                        onClick={(event) => {
                          deleteButtonRef.current = event.currentTarget
                          setActivityToDelete(activity)
                        }}
                      >
                        <svg
                          aria-hidden="true"
                          width="20"
                          height="20"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 10v6M14 10v6" />
                        </svg>
                      </button>
                    </td>
                  </tr>
                ))}
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

      <ActivityDetailsDialog
        activity={selectedActivity}
        onClose={() => {
          setSelectedActivity(null)
          requestAnimationFrame(() => viewButtonRef.current?.focus())
        }}
      />
      <EditActivityDialog
        activity={editingActivity}
        onClose={() => {
          setEditingActivity(null)
          requestAnimationFrame(() => {
            if (editButtonRef.current?.isConnected) {
              editButtonRef.current.focus()
            } else {
              searchTitleRef.current?.focus()
            }
          })
        }}
        onSave={handleEditSave}
      />
      {activityToDelete && (
        <dialog
          ref={deleteDialogRef}
          className="activity-dialog"
          aria-labelledby="delete-activity-title"
          aria-describedby="delete-activity-message"
          onCancel={(event) => {
            event.preventDefault()
            cancelDelete()
          }}
        >
          <div className="activity-dialog-header">
            <h2 id="delete-activity-title">Delete activity?</h2>
          </div>
          <div className="activity-dialog-body">
            <p id="delete-activity-message">
              Are you sure you want to remove this activity? This cannot be
              undone.
            </p>
            <p>
              {displayValue(activityToDelete.employer_name)} —{' '}
              {displayValue(activityToDelete.job_title)} —{' '}
              {displayValue(activityToDelete.activity_date)}
            </p>
          </div>
          <div className="activity-dialog-footer delete-confirmation-actions">
            <button
              ref={cancelDeleteRef}
              className="button button-secondary"
              type="button"
              onClick={cancelDelete}
            >
              Cancel
            </button>
            <button
              className="button button-danger"
              type="button"
              onClick={() => {
                setActivityToDelete(null)
                void handleDelete(activityToDelete.id)
              }}
            >
              Delete activity
            </button>
          </div>
        </dialog>
      )}
    </>
  )
}

export default ActivitySearchPage
