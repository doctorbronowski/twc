import { isSearchActivity } from './activityApi.ts'
import type { SearchActivity } from './components/ActivityDetailsDialog.tsx'

const selectionStorageKey = 'twc.export.selection'
const previewStorageKey = 'twc.export.preview'

export interface ExportSelectionItem {
  id: number
  activity_date: string | null
  employer_name: string | null
  job_title: string | null
}

export interface StoredSelection {
  items: ExportSelectionItem[]
  unavailable: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isExportSelectionItem(value: unknown): value is ExportSelectionItem {
  if (!isRecord(value)) {
    return false
  }

  return (
    typeof value.id === 'number' &&
    Number.isSafeInteger(value.id) &&
    value.id > 0 &&
    (value.activity_date === null || typeof value.activity_date === 'string') &&
    (value.employer_name === null || typeof value.employer_name === 'string') &&
    (value.job_title === null || typeof value.job_title === 'string')
  )
}

export function readExportSelection(): StoredSelection {
  try {
    const stored = window.sessionStorage.getItem(selectionStorageKey)
    if (stored === null) {
      return { items: [], unavailable: false }
    }

    const value: unknown = JSON.parse(stored)
    if (
      Array.isArray(value) &&
      value.length <= 10 &&
      value.every(isExportSelectionItem) &&
      new Set(value.map((item) => item.id)).size === value.length
    ) {
      return { items: value, unavailable: false }
    }

    window.sessionStorage.removeItem(selectionStorageKey)
    return { items: [], unavailable: true }
  } catch {
    return { items: [], unavailable: true }
  }
}

export function saveExportSelection(items: ExportSelectionItem[]): boolean {
  try {
    window.sessionStorage.setItem(selectionStorageKey, JSON.stringify(items))
    return true
  } catch {
    return false
  }
}

export function saveExportPreview(activities: SearchActivity[]): boolean {
  try {
    window.sessionStorage.setItem(previewStorageKey, JSON.stringify(activities))
    return true
  } catch {
    return false
  }
}

export function readExportPreview(): SearchActivity[] | null {
  try {
    const stored = window.sessionStorage.getItem(previewStorageKey)
    if (stored === null) {
      return null
    }

    const value: unknown = JSON.parse(stored)
    if (
      Array.isArray(value) &&
      value.length > 0 &&
      value.length <= 10 &&
      value.every(isSearchActivity) &&
      new Set(value.map((activity) => activity.id)).size === value.length
    ) {
      return value
    }

    window.sessionStorage.removeItem(previewStorageKey)
    return null
  } catch {
    return null
  }
}
