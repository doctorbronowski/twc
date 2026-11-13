import { useEffect, useRef, useState } from 'react'
import type { SearchActivity } from './ActivityDetailsDialog.tsx'
import ActivityForm, {
  type ActivityFormValues,
  formatPhone,
} from './ActivityForm.tsx'

interface EditActivityDialogProps {
  activity: SearchActivity | null
  onClose: () => void
  onSave: (id: number, values: ActivityFormValues) => Promise<void>
}

function toFormValues(activity: SearchActivity): ActivityFormValues {
  return {
    activity_date: activity.activity_date ?? '',
    job_source: activity.job_source ?? '',
    job_source_url: activity.job_source_url ?? '',
    job_title: activity.job_title ?? '',
    employer_name: activity.employer_name ?? '',
    employer_address1: activity.employer_address1 ?? '',
    employer_address2: activity.employer_address2 ?? '',
    employer_city: activity.employer_city ?? '',
    employer_state: activity.employer_state ?? '',
    employer_zip: activity.employer_zip ?? '',
    employer_phone: formatPhone(activity.employer_phone ?? ''),
    employer_contact: activity.employer_contact ?? '',
    employer_email: activity.employer_email ?? '',
    hiring_result: activity.hiring_result ?? '',
    start_date: activity.start_date ?? '',
    application_filed: activity.application_filed,
    result_other: activity.result_other ?? '',
    notes: activity.notes ?? '',
  }
}

function EditActivityDialog({
  activity,
  onClose,
  onSave,
}: EditActivityDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    if (activity && dialogRef.current && !dialogRef.current.open) {
      setErrorMessage(null)
      setIsSubmitting(false)
      dialogRef.current.showModal()
      dialogRef.current
        .querySelector<HTMLInputElement>('#activity-date')
        ?.focus({ preventScroll: true })
    }
  }, [activity])

  if (!activity) {
    return null
  }

  const selectedActivity = activity

  async function handleSubmit(values: ActivityFormValues) {
    setErrorMessage(null)
    setIsSubmitting(true)

    try {
      await onSave(selectedActivity.id, values)
      dialogRef.current?.close()
    } catch {
      setErrorMessage('The activity could not be updated. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="activity-dialog activity-edit-dialog"
      aria-labelledby="edit-activity-dialog-title"
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
          <h2 id="edit-activity-dialog-title">Edit activity</h2>
        </div>
        <ActivityForm
          key={selectedActivity.id}
          isSubmitting={isSubmitting}
          initialValue={toFormValues(selectedActivity)}
          isModal
          onCancel={() => dialogRef.current?.close()}
          onSubmit={handleSubmit}
          errorMessage={errorMessage}
          submitLabel="Save Changes"
        />
      </div>
    </dialog>
  )
}

export default EditActivityDialog
