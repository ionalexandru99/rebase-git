import type { CommitDetailFile, CommitFileStatus } from '@shared/schemas/git'

const NUL = '\x00'

export interface CommitNameStatusEntry {
  status: CommitFileStatus
  path: string
  oldPath?: string
}

export interface CommitNumstatEntry {
  path: string
  additions: number
  deletions: number
  binary: boolean
}

function normalizeStatus(raw: string): CommitFileStatus {
  switch (raw[0]) {
    case 'A':
      return 'A'
    case 'D':
      return 'D'
    case 'R':
    case 'C':
      return 'R'
    default:
      return 'M'
  }
}

// `-z` output is a flat run of NUL-terminated fields with no per-record delimiter, so the reader
// has to know a rename/copy record carries two paths where every other record carries one.
export function parseCommitNameStatus(output: string): CommitNameStatusEntry[] {
  const fields = output.split(NUL)
  const entries: CommitNameStatusEntry[] = []
  for (let index = 0; index < fields.length - 1; ) {
    const raw = fields[index++]
    const status = normalizeStatus(raw)
    if (raw.startsWith('R') || raw.startsWith('C')) {
      const oldPath = fields[index++]
      entries.push({ status, path: fields[index++], oldPath })
      continue
    }
    entries.push({ status, path: fields[index++] })
  }
  return entries
}

function countOf(field: string): number {
  const parsed = Number(field)
  return Number.isFinite(parsed) ? parsed : 0
}

// numstat rows are `adds TAB dels TAB path`, except for a rename where the path field is empty and
// the source and destination follow as two separate NUL-terminated fields. `-z` leaves paths
// unquoted, so everything past the second tab is the path — a filename may contain tabs of its own.
export function parseCommitNumstat(output: string): CommitNumstatEntry[] {
  const fields = output.split(NUL)
  const entries: CommitNumstatEntry[] = []
  for (let index = 0; index < fields.length - 1; ) {
    const [added, deleted, ...pathFields] = fields[index++].split('\t')
    let path = pathFields.join('\t')
    if (path === '') {
      index++
      path = fields[index++]
    }
    entries.push({
      path,
      additions: countOf(added),
      deletions: countOf(deleted),
      binary: added === '-' && deleted === '-'
    })
  }
  return entries
}

export function buildCommitFiles(
  nameStatus: readonly CommitNameStatusEntry[],
  numstat: readonly CommitNumstatEntry[]
): CommitDetailFile[] {
  const countsByPath = new Map(numstat.map((entry) => [entry.path, entry]))
  return nameStatus
    .map((entry) => {
      const counts = countsByPath.get(entry.path)
      return {
        path: entry.path,
        status: entry.status,
        additions: counts?.additions ?? 0,
        deletions: counts?.deletions ?? 0,
        binary: counts?.binary ?? false,
        ...(entry.oldPath === undefined ? {} : { oldPath: entry.oldPath })
      }
    })
    .sort((left, right) => left.path.localeCompare(right.path))
}
