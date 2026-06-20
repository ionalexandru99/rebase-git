export function isSafeCheckoutRef(ref: string): boolean {
  return ref.length > 0 && !ref.includes('\0') && !ref.startsWith('-')
}

// Reject anything that could be read as an option flag (leading '-') or smuggle a NUL. Arguments
// are passed as an array to git (never a shell), so this is the only injection surface that matters.
// Ref-taking commands (checkout/reset/merge) additionally pass a trailing `--` so a ref that
// collides with a path can never be reinterpreted as a pathspec — defense-in-depth atop this guard.
export function isSafeRefArg(value: string): boolean {
  return value.length > 0 && !value.includes('\0') && !value.startsWith('-')
}
