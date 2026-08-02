import type {
  GitIdentity,
  IdentityField,
  IdentityScope,
  ResolvedIdentity
} from '@shared/schemas/git'
import { Effect } from 'effect'
import { GitError, gitError } from '../git/errors'
import { nonInteractiveEnv, runGit } from '../git/spawn'

const NAME_KEY = 'user.name'
const EMAIL_KEY = 'user.email'
const CONFIG_KEYS: Record<IdentityField, string> = { name: NAME_KEY, email: EMAIL_KEY }

const KEY_NOT_FOUND_EXIT = 1

async function readConfigValue(scopeArgs: string[], key: string): Promise<string | undefined> {
  const output = await runGit([...scopeArgs, '--get', key], {
    env: nonInteractiveEnv(),
    okExitCodes: [0, KEY_NOT_FOUND_EXIT]
  })
  const value = output.trim()
  return value.length > 0 ? value : undefined
}

async function readIdentity(scopeArgs: string[]): Promise<GitIdentity> {
  const [name, email] = await Promise.all([
    readConfigValue(scopeArgs, NAME_KEY),
    readConfigValue(scopeArgs, EMAIL_KEY)
  ])
  return { name, email }
}

async function resolveIdentity(repoPath: string | undefined): Promise<ResolvedIdentity> {
  const globalIdentity = await readIdentity(['config', '--global'])
  if (!repoPath) {
    return { local: {}, global: globalIdentity, effective: globalIdentity }
  }
  const [local, effective] = await Promise.all([
    readIdentity(['-C', repoPath, 'config', '--local']),
    readIdentity(['-C', repoPath, 'config'])
  ])
  return { local, global: globalIdentity, effective }
}

export function getIdentity(
  repoPath: string | undefined
): Effect.Effect<ResolvedIdentity, GitError> {
  return Effect.tryPromise({ try: () => resolveIdentity(repoPath), catch: gitError })
}

export interface IdentityWrite {
  scope: IdentityScope
  repoPath: string | undefined
  name: string | undefined
  email: string | undefined
}

const MISSING_REPO = 'a repository is required to change its local identity'
const BLANK_NAME = 'the name cannot be empty'
const BLANK_EMAIL = 'the email cannot be empty'

function blankValueMessage(identity: GitIdentity): string | null {
  if (identity.name !== undefined && identity.name.trim().length === 0) {
    return BLANK_NAME
  }
  if (identity.email !== undefined && identity.email.trim().length === 0) {
    return BLANK_EMAIL
  }
  return null
}

function scopeArgsFor(scope: IdentityScope, repoPath: string | undefined): string[] | null {
  if (scope === 'global') {
    return ['config', '--global']
  }
  return repoPath ? ['-C', repoPath, 'config', '--local'] : null
}

async function writeIdentity(scopeArgs: string[], identity: GitIdentity): Promise<void> {
  const writes: [string, string][] = []
  if (identity.name !== undefined) {
    writes.push([NAME_KEY, identity.name])
  }
  if (identity.email !== undefined) {
    writes.push([EMAIL_KEY, identity.email])
  }
  for (const [key, value] of writes) {
    await runGit([...scopeArgs, key, value], { env: nonInteractiveEnv() })
  }
}

export function setIdentity(write: IdentityWrite): Effect.Effect<void, GitError> {
  return Effect.suspend(() => {
    const identity: GitIdentity = { name: write.name, email: write.email }
    const blank = blankValueMessage(identity)
    if (blank) {
      return Effect.fail(new GitError({ message: blank }))
    }
    const scopeArgs = scopeArgsFor(write.scope, write.repoPath)
    if (!scopeArgs) {
      return Effect.fail(new GitError({ message: MISSING_REPO }))
    }
    return Effect.tryPromise({ try: () => writeIdentity(scopeArgs, identity), catch: gitError })
  })
}

const KEY_ALREADY_ABSENT_EXIT = 5

async function unsetLocalIdentity(repoPath: string, fields: readonly IdentityField[]) {
  for (const field of fields) {
    await runGit(['-C', repoPath, 'config', '--local', '--unset', CONFIG_KEYS[field]], {
      env: nonInteractiveEnv(),
      okExitCodes: [0, KEY_ALREADY_ABSENT_EXIT]
    })
  }
}

export function clearIdentity(
  repoPath: string,
  fields: readonly IdentityField[]
): Effect.Effect<void, GitError> {
  return Effect.tryPromise({ try: () => unsetLocalIdentity(repoPath, fields), catch: gitError })
}
