const SCHEME_URL = /^(?:https?|ssh|git|file):\/\/\S+$/i
const SCP_LIKE = /^[A-Za-z0-9_.+-]+@[A-Za-z0-9_.-]+:\S+$/

export function isSupportedCloneUrl(url: string): boolean {
  const trimmed = url.trim()
  if (trimmed.length === 0 || /[\s\0]/.test(trimmed)) {
    return false
  }
  return SCHEME_URL.test(trimmed) || SCP_LIKE.test(trimmed)
}

export function isSafeCloneFolderName(name: string): boolean {
  if (name.length === 0 || name === '.' || name === '..') {
    return false
  }
  if (name.startsWith('-') || name.startsWith('.')) {
    return false
  }
  return !/[/\\\0]/.test(name)
}

export function deriveCloneFolderName(url: string): string | null {
  const trimmed = url.trim().replace(/[/\\]+$/, '')
  if (trimmed.length === 0) {
    return null
  }
  const withoutQuery = trimmed.split(/[?#]/)[0]
  const lastSegment =
    withoutQuery
      .split(/[/\\:]/)
      .filter(Boolean)
      .at(-1) ?? ''
  const name = lastSegment.replace(/\.git$/i, '')
  return isSafeCloneFolderName(name) ? name : null
}
