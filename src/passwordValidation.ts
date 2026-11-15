export function isValidPassword(value: string): boolean {
  return (
    value.length >= 8 &&
    value.length <= 1024 &&
    /[a-z]/.test(value) &&
    /[A-Z]/.test(value) &&
    /\d/.test(value)
  )
}
