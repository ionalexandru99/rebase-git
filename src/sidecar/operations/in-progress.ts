import { access } from 'node:fs/promises'
import path from 'node:path'
import { Effect } from 'effect'
import { type GitError, OperationInProgress } from '../git/errors'
import { runGit } from '../git/spawn'
import { tryGit } from './helpers'

export type InProgressOperation = OperationInProgress['operation']

const IN_PROGRESS_MARKERS: readonly { gitPath: string; operation: InProgressOperation }[] = [
  { gitPath: 'rebase-merge', operation: 'rebase' },
  { gitPath: 'rebase-apply', operation: 'rebase' },
  { gitPath: 'MERGE_HEAD', operation: 'merge' },
  { gitPath: 'CHERRY_PICK_HEAD', operation: 'cherry-pick' },
  { gitPath: 'REVERT_HEAD', operation: 'revert' }
]

const pathExists = (target: string): Promise<boolean> =>
  access(target).then(
    () => true,
    () => false
  )

export async function detectInProgressOperation(
  key: string
): Promise<InProgressOperation | undefined> {
  const args = [
    '-C',
    key,
    'rev-parse',
    ...IN_PROGRESS_MARKERS.flatMap((marker) => ['--git-path', marker.gitPath])
  ]
  const markerPaths = (await runGit(args)).trimEnd().split('\n')
  for (const [index, marker] of IN_PROGRESS_MARKERS.entries()) {
    if (await pathExists(path.resolve(key, markerPaths[index]))) {
      return marker.operation
    }
  }
  return undefined
}

export function requireNoOperation(
  repoPath: string
): Effect.Effect<void, GitError | OperationInProgress> {
  return Effect.gen(function* () {
    const inProgress = yield* tryGit(() => detectInProgressOperation(repoPath))
    if (inProgress) {
      return yield* Effect.fail(new OperationInProgress({ operation: inProgress }))
    }
  })
}

const INCOMING_REFS: Record<InProgressOperation, string | undefined> = {
  merge: 'MERGE_HEAD',
  'cherry-pick': 'CHERRY_PICK_HEAD',
  revert: 'REVERT_HEAD',
  rebase: 'REBASE_HEAD'
}

async function revision(repoPath: string, spec: string): Promise<string | undefined> {
  const output = await runGit(['-C', repoPath, 'rev-parse', '--verify', '--quiet', spec], {
    okExitCodes: [0, 1]
  })
  const resolved = output.trim()
  return resolved.length > 0 ? resolved : undefined
}

async function stepRange(
  repoPath: string,
  operation: InProgressOperation
): Promise<{ from: string; to: string } | undefined> {
  const incoming = INCOMING_REFS[operation]
  if (!incoming) {
    return undefined
  }
  const to = await revision(repoPath, incoming)
  if (!to) {
    return undefined
  }
  if (operation === 'merge') {
    const base = await runGit(['-C', repoPath, 'merge-base', 'HEAD', to], {
      okExitCodes: [0, 1]
    }).catch(() => '')
    const from = base.trim()
    return from.length > 0 ? { from, to } : undefined
  }
  const from = await revision(repoPath, `${to}^`)
  return from ? { from, to } : undefined
}

interface RenamePair {
  from: string
  to: string
}

async function detectedRenames(repoPath: string, from: string): Promise<RenamePair[]> {
  const output = await runGit([
    '-C',
    repoPath,
    'diff',
    '-M',
    '--name-status',
    '--diff-filter=R',
    '-z',
    from,
    'HEAD'
  ])
  const fields = output.split('\0')
  const renames: RenamePair[] = []
  for (let index = 0; index + 2 < fields.length; index += 3) {
    if (!fields[index].startsWith('R')) {
      break
    }
    renames.push({ from: fields[index + 1], to: fields[index + 2] })
  }
  return renames
}

const parentOf = (filePath: string): string => {
  const cut = filePath.lastIndexOf('/')
  return cut === -1 ? '' : filePath.slice(0, cut)
}

function relocationsOf(renames: readonly RenamePair[], touched: ReadonlySet<string>): string[] {
  const relocated: string[] = []
  const directories: RenamePair[] = []
  for (const rename of renames) {
    if (touched.has(rename.from)) {
      relocated.push(rename.to)
    }
    const fromParent = parentOf(rename.from)
    const toParent = parentOf(rename.to)
    if (fromParent !== toParent && fromParent !== '') {
      directories.push({ from: fromParent, to: toParent })
    }
  }
  for (const filePath of touched) {
    for (const directory of directories) {
      if (filePath.startsWith(`${directory.from}/`)) {
        const tail = filePath.slice(directory.from.length + 1)
        relocated.push(directory.to === '' ? tail : `${directory.to}/${tail}`)
      }
    }
  }
  return relocated
}

async function operationPaths(
  repoPath: string,
  operation: InProgressOperation,
  files: readonly string[]
): Promise<string[]> {
  const range = await stepRange(repoPath, operation)
  if (!range) {
    return [...files]
  }
  const changed = await runGit(['-C', repoPath, 'diff', '--name-only', '-z', range.from, range.to])
  const touched = new Set(changed.split('\0').filter((line) => line.length > 0))
  const renames = await detectedRenames(repoPath, range.from)
  for (const relocated of relocationsOf(renames, touched)) {
    touched.add(relocated)
  }
  return files.filter((file) => touched.has(file))
}

export interface PathGuardOptions {
  exempt?: readonly string[]
}

export function requireNoOperationForPaths(
  repoPath: string,
  files: readonly string[],
  options?: PathGuardOptions
): Effect.Effect<void, GitError | OperationInProgress> {
  return Effect.gen(function* () {
    const inProgress = yield* tryGit(() => detectInProgressOperation(repoPath))
    if (!inProgress) {
      return
    }
    const exempt = new Set(options?.exempt ?? [])
    const guarded = files.filter((file) => !exempt.has(file))
    if (guarded.length === 0) {
      return
    }
    const owned = yield* tryGit(() => operationPaths(repoPath, inProgress, guarded))
    if (owned.length > 0) {
      return yield* Effect.fail(new OperationInProgress({ operation: inProgress }))
    }
  })
}
