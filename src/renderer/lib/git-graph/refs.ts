export interface ParsedRef {
  label: string
  kind: 'head' | 'branch' | 'remote' | 'tag' | 'stash'
}

function dedupeExactRefs(parsed: ParsedRef[]): ParsedRef[] {
  const seen = new Set<string>()
  return parsed.filter((ref) => {
    const key = `${ref.kind}:${ref.label}`
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
}

export function parseRefs(refs: string, remoteNames?: Set<string>): ParsedRef[] {
  if (!refs) {
    return []
  }
  const parsed = refs
    .split(',')
    .map((raw) => raw.trim())
    .filter(Boolean)
    .map<ParsedRef | null>((part) => {
      if (part.startsWith('HEAD -> ')) {
        return { label: part.slice(8), kind: 'branch' }
      }
      if (part === 'HEAD') {
        return null
      }
      if (part.startsWith('tag: ')) {
        return { label: part.slice(5), kind: 'tag' }
      }
      if (/^stash@\{/.test(part)) {
        return { label: part, kind: 'stash' }
      }
      if (part.includes('/')) {
        const first = part.slice(0, part.indexOf('/'))
        const haveRemotes = remoteNames && remoteNames.size > 0
        const isRemote = haveRemotes ? remoteNames.has(first) : first === 'origin'
        if (isRemote) {
          if (part.slice(first.length + 1) === 'HEAD') {
            return null
          }
          return { label: part, kind: 'remote' }
        }
      }
      return { label: part, kind: 'branch' }
    })
    .filter((ref): ref is ParsedRef => ref !== null)
  return dedupeExactRefs(parsed)
}

export function splitRemoteRef(label: string): { remote: string; branch: string } {
  const slash = label.indexOf('/')
  if (slash === -1) {
    return { remote: label, branch: '' }
  }
  return { remote: label.slice(0, slash), branch: label.slice(slash + 1) }
}

export function refClass(kind: ParsedRef['kind']): string {
  switch (kind) {
    case 'tag':
      return 'border-chart-3/50 bg-chart-3/20 text-chart-3'
    case 'stash':
      return 'border-amber-500/50 bg-amber-500/20 text-amber-600 dark:text-amber-400'
    default:
      return ''
  }
}
