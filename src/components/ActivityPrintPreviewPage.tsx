import { readExportPreview } from '../exportStorage.ts'
import { getActivityDetails } from './ActivityDetailsDialog.tsx'

function ActivityPrintPreviewPage() {
  const activities = readExportPreview()

  if (!activities) {
    return (
      <section className="placeholder-panel" aria-labelledby="preview-title">
        <p className="eyebrow">Export/Print Activities</p>
        <h1 id="preview-title">Print preview unavailable</h1>
        <p role="status">
          This preview is missing or has expired. Return to Export/Print
          Activities and select the records again.
        </p>
        <a className="button button-secondary" href="/export">
          Back to Export
        </a>
      </section>
    )
  }

  return (
    <section
      className="print-preview-page"
      aria-labelledby="print-preview-title"
    >
      <div className="print-preview-intro">
        <p className="eyebrow">Export/Print Activities</p>
        <h1 id="print-preview-title">Print preview</h1>
        <p>
          Review the {activities.length} selected activities before printing.
        </p>
      </div>
      <div className="print-controls">
        <button
          className="button button-primary"
          type="button"
          onClick={() => window.print()}
        >
          Print / Save as PDF
        </button>
        <a className="button button-secondary" href="/export">
          Back to Export
        </a>
      </div>
      <p className="print-instructions">
        To save a PDF, click <strong>Print / Save as PDF</strong>, choose{' '}
        <strong>Save as PDF</strong> in your browser’s print dialog, select a
        destination, and save. Dialog wording may vary by browser.
      </p>
      <div className="print-activities">
        {activities.map((activity, index) => (
          <article
            className="print-activity"
            key={activity.id}
            aria-labelledby={`print-activity-${index + 1}`}
          >
            <h2 id={`print-activity-${index + 1}`}>Activity {index + 1}</h2>
            <table className="activity-details-table print-details-table">
              <tbody>
                {getActivityDetails(activity).map(({ label, value }) => (
                  <tr key={label}>
                    <th scope="row">{label}</th>
                    <td>{value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </article>
        ))}
      </div>
    </section>
  )
}

export default ActivityPrintPreviewPage
