import { useEffect, useRef } from 'react'

export interface SearchActivity {
  id: number
  activity_date: string | null
  job_source: string | null
  job_source_url: string | null
  job_title: string | null
  employer_name: string | null
  employer_address1: string | null
  employer_address2: string | null
  employer_city: string | null
  employer_state: string | null
  employer_zip: string | null
  employer_phone: string | null
  employer_contact: string | null
  employer_email: string | null
  hiring_result: 'hired' | 'not_hired' | null
  start_date: string | null
  application_filed: boolean
  result_other: string | null
  notes: string | null
}

interface ActivityDetailsDialogProps {
  activity: SearchActivity | null
  onClose: () => void
}

export interface ActivityDetailRow {
  label: string
  value: string
}

function displayValue(value: string | null): string {
  return value?.trim() ? value : '—'
}

function formatPhone(value: string | null): string {
  if (!value) {
    return '—'
  }

  return /^\d{10}$/.test(value)
    ? `(${value.slice(0, 3)}) ${value.slice(3, 6)}-${value.slice(6)}`
    : value
}

export function getActivityDetails(
  activity: SearchActivity,
): ActivityDetailRow[] {
  return [
    { label: 'Date of Activity', value: displayValue(activity.activity_date) },
    { label: 'Job Source', value: displayValue(activity.job_source) },
    { label: 'Job Source URL', value: displayValue(activity.job_source_url) },
    { label: 'Job Title', value: displayValue(activity.job_title) },
    {
      label: 'Employer/Agency Name',
      value: displayValue(activity.employer_name),
    },
    {
      label: 'Employer/Agency Address 1',
      value: displayValue(activity.employer_address1),
    },
    {
      label: 'Employer/Agency Address 2',
      value: displayValue(activity.employer_address2),
    },
    {
      label: 'Employer/Agency City',
      value: displayValue(activity.employer_city),
    },
    {
      label: 'Employer/Agency State',
      value: displayValue(activity.employer_state),
    },
    {
      label: 'Employer/Agency ZIP',
      value: displayValue(activity.employer_zip),
    },
    {
      label: 'Employer/Agency Phone',
      value: formatPhone(activity.employer_phone),
    },
    {
      label: 'Employer/Agency Contact',
      value: displayValue(activity.employer_contact),
    },
    {
      label: 'Employer/Agency Email',
      value: displayValue(activity.employer_email),
    },
    {
      label: 'Hired/Not Hired',
      value:
        activity.hiring_result === 'hired'
          ? 'Hired'
          : activity.hiring_result === 'not_hired'
            ? 'Not Hired'
            : '—',
    },
    ...(activity.hiring_result === 'hired'
      ? [{ label: 'Start Date', value: displayValue(activity.start_date) }]
      : []),
    {
      label: 'Application Filed',
      value: activity.application_filed ? 'Yes' : 'No',
    },
    { label: 'Result Other', value: displayValue(activity.result_other) },
    { label: 'Notes', value: displayValue(activity.notes) },
  ]
}

function ActivityDetailsDialog({
  activity,
  onClose,
}: ActivityDetailsDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (activity && dialogRef.current && !dialogRef.current.open) {
      dialogRef.current.showModal()
      closeButtonRef.current?.focus()
    }
  }, [activity])

  if (!activity) {
    return null
  }

  const details = getActivityDetails(activity)

  return (
    <dialog
      ref={dialogRef}
      className="activity-dialog"
      aria-labelledby="activity-dialog-title"
      onClose={onClose}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          dialogRef.current?.close()
        }
      }}
      onCancel={(event) => {
        event.preventDefault()
        dialogRef.current?.close()
      }}
    >
      <div className="activity-dialog-content">
        <div className="activity-dialog-header">
          <h2 id="activity-dialog-title">Activity details</h2>
        </div>
        <div className="activity-dialog-body">
          <table className="activity-details-table">
            <tbody>
              {details.map(({ label, value }) => (
                <tr key={label}>
                  <th scope="row">{label}</th>
                  <td>{value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="activity-dialog-footer">
          <button
            ref={closeButtonRef}
            className="button button-secondary"
            type="button"
            onClick={() => dialogRef.current?.close()}
          >
            Close
          </button>
        </div>
      </div>
    </dialog>
  )
}

export default ActivityDetailsDialog
