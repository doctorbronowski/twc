import { type FormEvent, useState } from 'react'

export interface ActivityFormValues {
  activity_date: string
  job_source: string
  job_title: string
  employer_name: string
  employer_address1: string
  employer_address2: string
  employer_city: string
  employer_state: string
  employer_zip: string
  employer_phone: string
  employer_contact: string
  employer_email: string
  hiring_result: string
  start_date: string
  application_filed: boolean
  result_other: string
  notes: string
}

interface ActivityFormProps {
  isSubmitting: boolean
  onClear: () => void
  onSubmit: (activity: ActivityFormValues) => Promise<void>
}

type TextFieldName = Exclude<keyof ActivityFormValues, 'application_filed'>

const initialActivity: ActivityFormValues = {
  activity_date: '',
  job_source: '',
  job_title: '',
  employer_name: '',
  employer_address1: '',
  employer_address2: '',
  employer_city: '',
  employer_state: '',
  employer_zip: '',
  employer_phone: '',
  employer_contact: '',
  employer_email: '',
  hiring_result: '',
  start_date: '',
  application_filed: false,
  result_other: '',
  notes: '',
}

const states = [
  ['AL', 'Alabama'],
  ['AK', 'Alaska'],
  ['AZ', 'Arizona'],
  ['AR', 'Arkansas'],
  ['CA', 'California'],
  ['CO', 'Colorado'],
  ['CT', 'Connecticut'],
  ['DE', 'Delaware'],
  ['DC', 'District of Columbia'],
  ['FL', 'Florida'],
  ['GA', 'Georgia'],
  ['HI', 'Hawaii'],
  ['ID', 'Idaho'],
  ['IL', 'Illinois'],
  ['IN', 'Indiana'],
  ['IA', 'Iowa'],
  ['KS', 'Kansas'],
  ['KY', 'Kentucky'],
  ['LA', 'Louisiana'],
  ['ME', 'Maine'],
  ['MD', 'Maryland'],
  ['MA', 'Massachusetts'],
  ['MI', 'Michigan'],
  ['MN', 'Minnesota'],
  ['MS', 'Mississippi'],
  ['MO', 'Missouri'],
  ['MT', 'Montana'],
  ['NE', 'Nebraska'],
  ['NV', 'Nevada'],
  ['NH', 'New Hampshire'],
  ['NJ', 'New Jersey'],
  ['NM', 'New Mexico'],
  ['NY', 'New York'],
  ['NC', 'North Carolina'],
  ['ND', 'North Dakota'],
  ['OH', 'Ohio'],
  ['OK', 'Oklahoma'],
  ['OR', 'Oregon'],
  ['PA', 'Pennsylvania'],
  ['RI', 'Rhode Island'],
  ['SC', 'South Carolina'],
  ['SD', 'South Dakota'],
  ['TN', 'Tennessee'],
  ['TX', 'Texas'],
  ['UT', 'Utah'],
  ['VT', 'Vermont'],
  ['VA', 'Virginia'],
  ['WA', 'Washington'],
  ['WV', 'West Virginia'],
  ['WI', 'Wisconsin'],
  ['WY', 'Wyoming'],
] as const

function formatPhone(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 10)

  if (digits.length === 0) {
    return ''
  }

  if (digits.length < 4) {
    return `(${digits}`
  }

  if (digits.length < 7) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3)}`
  }

  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
}

function ActivityForm({ isSubmitting, onClear, onSubmit }: ActivityFormProps) {
  const [activity, setActivity] = useState(initialActivity)

  function updateField(field: TextFieldName, value: string) {
    setActivity((currentActivity) => ({ ...currentActivity, [field]: value }))
  }

  function handleClear() {
    setActivity(initialActivity)
    onClear()
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await onSubmit(activity)
  }

  return (
    <form className="activity-form" onSubmit={handleSubmit}>
      <fieldset className="form-section">
        <legend>Activity details</legend>
        <div className="form-grid">
          <div className="form-field">
            <label htmlFor="activity-date">Date of Activity</label>
            <input
              id="activity-date"
              name="activity_date"
              type="date"
              value={activity.activity_date}
              onChange={(event) =>
                updateField('activity_date', event.target.value)
              }
            />
          </div>
          <div className="form-field">
            <label htmlFor="job-source">Job Source</label>
            <input
              id="job-source"
              name="job_source"
              type="text"
              value={activity.job_source}
              onChange={(event) =>
                updateField('job_source', event.target.value)
              }
            />
          </div>
          <div className="form-field">
            <label htmlFor="job-title">Job Title</label>
            <input
              id="job-title"
              name="job_title"
              type="text"
              value={activity.job_title}
              onChange={(event) => updateField('job_title', event.target.value)}
            />
          </div>
        </div>
      </fieldset>

      <fieldset className="form-section">
        <legend>Employer details</legend>
        <div className="form-grid">
          <div className="form-field">
            <label htmlFor="employer-name">Employer Name</label>
            <input
              id="employer-name"
              name="employer_name"
              type="text"
              autoComplete="organization"
              value={activity.employer_name}
              onChange={(event) =>
                updateField('employer_name', event.target.value)
              }
            />
          </div>
          <div className="form-field">
            <label htmlFor="employer-address1">Employer Address 1</label>
            <input
              id="employer-address1"
              name="employer_address1"
              type="text"
              autoComplete="address-line1"
              value={activity.employer_address1}
              onChange={(event) =>
                updateField('employer_address1', event.target.value)
              }
            />
          </div>
          <div className="form-field">
            <label htmlFor="employer-address2">Employer Address 2</label>
            <input
              id="employer-address2"
              name="employer_address2"
              type="text"
              autoComplete="address-line2"
              value={activity.employer_address2}
              onChange={(event) =>
                updateField('employer_address2', event.target.value)
              }
            />
          </div>
          <div className="form-field">
            <label htmlFor="employer-city">Employer City</label>
            <input
              id="employer-city"
              name="employer_city"
              type="text"
              autoComplete="address-level2"
              value={activity.employer_city}
              onChange={(event) =>
                updateField('employer_city', event.target.value)
              }
            />
          </div>
          <div className="form-field">
            <label htmlFor="employer-state">Employer State</label>
            <select
              id="employer-state"
              name="employer_state"
              autoComplete="address-level1"
              value={activity.employer_state}
              onChange={(event) =>
                updateField('employer_state', event.target.value)
              }
            >
              <option value="">Select a state</option>
              {states.map(([code, name]) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            </select>
          </div>
          <div className="form-field">
            <label htmlFor="employer-zip">Employer ZIP</label>
            <input
              id="employer-zip"
              name="employer_zip"
              type="text"
              inputMode="numeric"
              autoComplete="postal-code"
              value={activity.employer_zip}
              onChange={(event) =>
                updateField('employer_zip', event.target.value)
              }
            />
          </div>
          <div className="form-field">
            <label htmlFor="employer-phone">Employer Phone</label>
            <input
              id="employer-phone"
              name="employer_phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              aria-describedby="employer-phone-hint"
              placeholder="(555) 555-5555"
              value={activity.employer_phone}
              onChange={(event) =>
                updateField('employer_phone', formatPhone(event.target.value))
              }
            />
            <span className="field-hint" id="employer-phone-hint">
              US 10-digit phone number
            </span>
          </div>
          <div className="form-field">
            <label htmlFor="employer-contact">Employer Contact</label>
            <input
              id="employer-contact"
              name="employer_contact"
              type="text"
              autoComplete="name"
              value={activity.employer_contact}
              onChange={(event) =>
                updateField('employer_contact', event.target.value)
              }
            />
          </div>
          <div className="form-field">
            <label htmlFor="employer-email">Employer Email</label>
            <input
              id="employer-email"
              name="employer_email"
              type="text"
              autoComplete="email"
              value={activity.employer_email}
              onChange={(event) =>
                updateField('employer_email', event.target.value)
              }
            />
          </div>
        </div>
      </fieldset>

      <fieldset className="form-section">
        <legend>Application result</legend>
        <div className="form-grid">
          <div className="form-field">
            <fieldset className="choice-field">
              <legend className="field-label">Hired/Not Hired</legend>
              <div className="choice-group">
                <label className="choice">
                  <input
                    type="radio"
                    name="hiring_result"
                    value="hired"
                    checked={activity.hiring_result === 'hired'}
                    onChange={(event) =>
                      updateField('hiring_result', event.target.value)
                    }
                  />
                  <span>Hired</span>
                </label>
                <label className="choice">
                  <input
                    type="radio"
                    name="hiring_result"
                    value="not_hired"
                    checked={activity.hiring_result === 'not_hired'}
                    onChange={(event) =>
                      updateField('hiring_result', event.target.value)
                    }
                  />
                  <span>Not Hired</span>
                </label>
              </div>
            </fieldset>
          </div>
          <div className="form-field">
            <label htmlFor="start-date">Start Date</label>
            <input
              id="start-date"
              name="start_date"
              type="date"
              value={activity.start_date}
              onChange={(event) =>
                updateField('start_date', event.target.value)
              }
            />
          </div>
          <div className="form-field checkbox-field">
            <label className="choice checkbox-choice">
              <input
                id="application-filed"
                name="application_filed"
                type="checkbox"
                checked={activity.application_filed}
                onChange={(event) =>
                  setActivity((currentActivity) => ({
                    ...currentActivity,
                    application_filed: event.target.checked,
                  }))
                }
              />
              <span>Application Filed</span>
            </label>
          </div>
          <div className="form-field">
            <label htmlFor="result-other">Result Other</label>
            <input
              id="result-other"
              name="result_other"
              type="text"
              value={activity.result_other}
              onChange={(event) =>
                updateField('result_other', event.target.value)
              }
            />
          </div>
          <div className="form-field field-wide">
            <label htmlFor="notes">Notes</label>
            <textarea
              id="notes"
              name="notes"
              rows={4}
              value={activity.notes}
              onChange={(event) => updateField('notes', event.target.value)}
            />
          </div>
        </div>
      </fieldset>

      <div className="form-actions">
        <button
          className="button button-secondary"
          type="button"
          onClick={handleClear}
          disabled={isSubmitting}
        >
          Clear
        </button>
        <button
          className="button button-primary"
          type="submit"
          disabled={isSubmitting}
        >
          {isSubmitting ? 'Saving…' : 'Submit'}
        </button>
      </div>
    </form>
  )
}

export default ActivityForm
