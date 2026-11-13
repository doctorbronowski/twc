export interface ActivityInput {
  activity_date: string | null
  job_source: string | null
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

export type ParsedActivity = { ok: true; value: ActivityInput } | { ok: false }

const invalid = Symbol('invalid')

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function optionalText(
  value: unknown,
  maxLength: number,
): string | null | typeof invalid {
  if (value === undefined || value === null) {
    return null
  }

  if (typeof value !== 'string' || value.length > maxLength) {
    return invalid
  }

  return value
}

function optionalDate(value: unknown): string | null | typeof invalid {
  if (value === undefined || value === null || value === '') {
    return null
  }

  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return invalid
  }

  const parsedDate = new Date(`${value}T00:00:00.000Z`)
  return Number.isNaN(parsedDate.getTime()) ||
    parsedDate.toISOString().slice(0, 10) !== value
    ? invalid
    : value
}

function optionalPhone(value: unknown): string | null | typeof invalid {
  if (value === undefined || value === null || value === '') {
    return null
  }

  if (typeof value !== 'string' || !/^[\d\s()+.-]*$/.test(value)) {
    return invalid
  }

  const digits = value.replace(/\D/g, '')
  return digits.length > 10 ? invalid : digits || null
}

export function parseActivity(value: unknown): ParsedActivity {
  if (!isRecord(value)) {
    return { ok: false }
  }

  const activityDate = optionalDate(value.activity_date)
  const jobSource = optionalText(value.job_source, 255)
  const jobTitle = optionalText(value.job_title, 255)
  const employerName = optionalText(value.employer_name, 255)
  const employerAddress1 = optionalText(value.employer_address1, 255)
  const employerAddress2 = optionalText(value.employer_address2, 255)
  const employerCity = optionalText(value.employer_city, 100)
  const employerState = optionalText(value.employer_state, 2)
  const employerZip = optionalText(value.employer_zip, 10)
  const employerPhone = optionalPhone(value.employer_phone)
  const employerContact = optionalText(value.employer_contact, 255)
  const employerEmail = optionalText(value.employer_email, 255)
  const hiringResult =
    value.hiring_result === undefined ||
    value.hiring_result === null ||
    value.hiring_result === ''
      ? null
      : value.hiring_result
  const startDate = optionalDate(value.start_date)
  const resultOther = optionalText(value.result_other, 255)
  const notes = optionalText(value.notes, 65_535)
  const applicationFiled =
    value.application_filed === undefined ? false : value.application_filed

  if (
    activityDate === invalid ||
    jobSource === invalid ||
    jobTitle === invalid ||
    employerName === invalid ||
    employerAddress1 === invalid ||
    employerAddress2 === invalid ||
    employerCity === invalid ||
    employerState === invalid ||
    employerZip === invalid ||
    employerPhone === invalid ||
    employerContact === invalid ||
    employerEmail === invalid ||
    (hiringResult !== null &&
      hiringResult !== 'hired' &&
      hiringResult !== 'not_hired') ||
    startDate === invalid ||
    typeof applicationFiled !== 'boolean' ||
    resultOther === invalid ||
    notes === invalid
  ) {
    return { ok: false }
  }

  return {
    ok: true,
    value: {
      activity_date: activityDate,
      job_source: jobSource,
      job_title: jobTitle,
      employer_name: employerName,
      employer_address1: employerAddress1,
      employer_address2: employerAddress2,
      employer_city: employerCity,
      employer_state: employerState,
      employer_zip: employerZip,
      employer_phone: employerPhone,
      employer_contact: employerContact,
      employer_email: employerEmail,
      hiring_result: hiringResult,
      start_date: startDate,
      application_filed: applicationFiled,
      result_other: resultOther,
      notes,
    },
  }
}
