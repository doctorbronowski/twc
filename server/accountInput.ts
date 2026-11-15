export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const email = value.trim().toLowerCase()
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return null
  }

  const [localPart, domain] = email.split('@')
  if (
    localPart.length > 64 ||
    localPart.startsWith('.') ||
    localPart.endsWith('.') ||
    localPart.includes('..') ||
    domain.split('.').some((label) => !label || label.length > 63)
  ) {
    return null
  }

  return email
}

export function isValidPassword(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 8 &&
    value.length <= 1024 &&
    /[A-Z]/.test(value) &&
    /[a-z]/.test(value) &&
    /\d/.test(value)
  )
}
