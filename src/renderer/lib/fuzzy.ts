import fuzzysort from 'fuzzysort'

export function fuzzyFilter(query: string, items: readonly string[]): string[] {
  const trimmed = query.trim()
  if (!trimmed) {
    return [...items]
  }
  return fuzzysort.go(trimmed, items).map((result) => result.target)
}

export function fuzzyMatchSet<T>(
  query: string,
  items: readonly T[],
  keys: ReadonlyArray<keyof T & string>,
  getId: (item: T) => string
): Set<string> | null {
  const trimmed = query.trim()
  if (!trimmed) {
    return null
  }
  const matches = new Set<string>()
  for (const result of fuzzysort.go(trimmed, items, { keys: [...keys] })) {
    matches.add(getId(result.obj))
  }
  return matches
}
