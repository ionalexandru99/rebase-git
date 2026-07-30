export function isSafeCheckoutRef(ref: string): boolean {
  return ref.length > 0 && !ref.includes('\0') && !ref.startsWith('-')
}

export function isSafeRefArg(value: string): boolean {
  return value.length > 0 && !value.includes('\0') && !value.startsWith('-')
}
