import type { SearchActivity } from './components/ActivityDetailsDialog.tsx'

export const activityPageSizes = [5, 10, 25, 50, 100] as const
export type ActivityPageSize = (typeof activityPageSizes)[number]

export interface ActivityListResponse {
  activities: SearchActivity[]
  page: number
  pageSize: number
  totalRecords: number
  totalPages: number
}

const nullableStringFields = [
  'activity_date',
  'job_source',
  'job_source_url',
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

export function isSearchActivity(value: unknown): value is SearchActivity {
  if (!isRecord(value)) {
    return false
  }

  const hiringResult = value.hiring_result

  return (
    typeof value.id === 'number' &&
    Number.isSafeInteger(value.id) &&
    value.id > 0 &&
    nullableStringFields.every(
      (field) => value[field] === null || typeof value[field] === 'string',
    ) &&
    (hiringResult === null ||
      hiringResult === 'hired' ||
      hiringResult === 'not_hired') &&
    typeof value.application_filed === 'boolean'
  )
}

export function isActivityListResponse(
  value: unknown,
  requestedPageSize: number,
): value is ActivityListResponse {
  return (
    isRecord(value) &&
    Array.isArray(value.activities) &&
    value.activities.every(isSearchActivity) &&
    typeof value.page === 'number' &&
    Number.isInteger(value.page) &&
    value.page > 0 &&
    value.pageSize === requestedPageSize &&
    typeof value.totalRecords === 'number' &&
    Number.isInteger(value.totalRecords) &&
    value.totalRecords >= 0 &&
    typeof value.totalPages === 'number' &&
    Number.isInteger(value.totalPages) &&
    value.totalPages === Math.ceil(value.totalRecords / requestedPageSize)
  )
}

export function isExportResponse(
  value: unknown,
  expectedRecordCount: number,
): value is { activities: SearchActivity[] } {
  return (
    isRecord(value) &&
    Array.isArray(value.activities) &&
    value.activities.length === expectedRecordCount &&
    value.activities.every(isSearchActivity)
  )
}
