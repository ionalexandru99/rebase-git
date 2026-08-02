import type { CommitSummary, HeadCommit } from '@shared/schemas/git'

const NUL = '\x00'

export interface AmendHeadCommit {
  sha: string
  parents: string[]
  authorName: string
  authorEmail: string
  authorDate: string
}

export function parseAmendHeadCommit(output: string): AmendHeadCommit {
  const fields = output.trimEnd().split(NUL)
  if (
    fields.length !== 5 ||
    fields.some((field, index) => index !== 1 && field.trim().length === 0)
  ) {
    throw new Error('Invalid amend HEAD metadata')
  }
  const [sha, parentsField, authorName, authorEmail, authorDate] = fields
  return {
    sha,
    parents: parentsField.split(' ').filter((parent) => parent.length > 0),
    authorName,
    authorEmail,
    authorDate
  }
}

export function stripTrailingNewlines(message: string): string {
  return message.replace(/\n+$/, '')
}

export function parseAmendNameStatus(output: string): HeadCommit['files'] {
  if (output.length === 0) {
    return []
  }
  if (!output.endsWith(NUL)) {
    throw new Error('Invalid amend name-status output')
  }
  const files: HeadCommit['files'] = []
  const fields = output.split(NUL)
  for (let index = 0; index < fields.length - 1; ) {
    const status = fields[index++]
    if (status.length === 0) {
      throw new Error('Invalid amend name-status output')
    }
    if (status.startsWith('R') || status.startsWith('C')) {
      const sourcePath = fields[index++]
      const filePath = fields[index++]
      if (!sourcePath || !filePath) {
        throw new Error('Invalid amend name-status output')
      }
      files.push({
        status,
        path: filePath,
        ...(status.startsWith('R') ? { renameSource: sourcePath } : {})
      })
      continue
    }
    const filePath = fields[index++]
    if (!filePath) {
      throw new Error('Invalid amend name-status output')
    }
    files.push({ status, path: filePath })
  }
  return files
}

export function parseAmendDiffSummary(output: string): CommitSummary['summary'] {
  let changes = 0
  let insertions = 0
  let deletions = 0
  const countOf = (field: string | undefined): number => {
    if (field === undefined || field === '-') {
      return 0
    }
    const parsed = Number(field)
    return Number.isFinite(parsed) ? parsed : 0
  }
  for (const line of output.split('\n')) {
    if (line.trim().length === 0) {
      continue
    }
    changes += 1
    const [added, deleted] = line.split('\t')
    insertions += countOf(added)
    deletions += countOf(deleted)
  }
  return { changes, insertions, deletions }
}
