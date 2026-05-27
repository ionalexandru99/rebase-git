import type { GitLogEntry } from '@shared/schemas/git'

export const FS_SEP = '\x1F'
export const RS_SEP = '\x00'
export const LOG_FORMAT = ['%H', '%P', '%aI', '%aN', '%s', '%D'].join(FS_SEP)

export function parseGitLogRecord(record: string): GitLogEntry | null {
  if (!record) {
    return null
  }
  const fields = record.split(FS_SEP)
  if (fields.length < 6) {
    return null
  }
  const [hash, parentsStr, date, author_name, message, refs] = fields
  return {
    hash,
    message: message ?? '',
    author_name: author_name ?? '',
    date: date ?? '',
    parents: parentsStr ? parentsStr.split(' ').filter(Boolean) : [],
    refs: refs ?? ''
  }
}

export function parseGitLogOutput(raw: string): GitLogEntry[] {
  const commits: GitLogEntry[] = []
  for (const record of raw.split(RS_SEP)) {
    const parsed = parseGitLogRecord(record)
    if (parsed) {
      commits.push(parsed)
    }
  }
  return commits
}
