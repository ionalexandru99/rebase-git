import type { GitStatus } from '@/types'

type StatusFileCode = NonNullable<GitStatus['files']>[number]

const withoutFile = (files: string[], file: string): string[] =>
  files.filter((candidate) => candidate !== file)

const withFile = (files: string[], file: string): string[] =>
  files.includes(file) ? files : [...files, file]

const stagedCodes = (
  index: string,
  workingDirectory: string
): { index: string; working_dir: string } => {
  if (index === '?' || workingDirectory === '?') {
    return { index: 'A', working_dir: ' ' }
  }
  return {
    index: workingDirectory !== ' ' ? workingDirectory : index,
    working_dir: ' '
  }
}

const unstagedCodes = (index: string): { index: string; working_dir: string } => {
  if (index === 'A') {
    return { index: '?', working_dir: '?' }
  }
  return { index: ' ', working_dir: index !== ' ' ? index : 'M' }
}

const mapFileCodes = (
  status: GitStatus,
  file: string,
  next: (entry: StatusFileCode) => { index: string; working_dir: string }
): StatusFileCode[] =>
  (status.files ?? []).map((entry) => (entry.path === file ? { ...entry, ...next(entry) } : entry))

export const applyStageToStatus = (status: GitStatus, file: string): GitStatus => ({
  ...status,
  staged: withFile(status.staged, file),
  modified: withoutFile(status.modified, file),
  not_added: withoutFile(status.not_added, file),
  created: withoutFile(status.created, file),
  deleted: withoutFile(status.deleted, file),
  files: mapFileCodes(status, file, (entry) => stagedCodes(entry.index, entry.working_dir))
})

export const applyUnstageToStatus = (status: GitStatus, file: string): GitStatus => ({
  ...status,
  staged: withoutFile(status.staged, file),
  modified: withFile(status.modified, file),
  files: mapFileCodes(status, file, (entry) => unstagedCodes(entry.index))
})
