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

  const details = [
    ['Date of Activity', displayValue(activity.activity_date)],
    ['Job Source', displayValue(activity.job_source)],
    ['Job Source URL', displayValue(activity.job_source_url)],
    ['Job Title', displayValue(activity.job_title)],
    ['Employer Name', displayValue(activity.employer_name)],
    ['Employer Address 1', displayValue(activity.employer_address1)],
    ['Employer Address 2', displayValue(activity.employer_address2)],
    ['Employer City', displayValue(activity.employer_city)],
    ['Employer State', displayValue(activity.employer_state)],
    ['Employer ZIP', displayValue(activity.employer_zip)],
    ['Employer Phone', formatPhone(activity.employer_phone)],
    ['Employer Contact', displayValue(activity.employer_contact)],
    ['Employer Email', displayValue(activity.employer_email)],
    [
      'Hired/Not Hired',
      activity.hiring_result === 'hired'
        ? 'Hired'
        : activity.hiring_result === 'not_hired'
          ? 'Not Hired'
          : '—',
    ],
    ...(activity.hiring_result === 'hired'
      ? [['Start Date', displayValue(activity.start_date)]]
      : []),
    ['Application Filed', activity.application_filed ? 'Yes' : 'No'],
    ['Result Other', displayValue(activity.result_other)],
    ['Notes', displayValue(activity.notes)],
  ]

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
              {details.map(([label, value]) => (
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
