export type GitFailureKind =
  | 'auth-missing'
  | 'auth-rejected'
  | 'host-key-unknown'
  | 'host-key-changed'
  | 'network'
  | 'remote-missing'
  | 'no-remote'
  | 'hook-rejected'
  | 'non-fast-forward'
  | 'diverged'
  | 'no-upstream'
  | 'detached-head'
  | 'dirty-tree'
  | 'untracked-overwrite'
  | 'conflict'
  | 'unrelated-histories'
  | 'index-lock'
  | 'ref-exists'
  | 'branch-not-merged'
  | 'nothing-to-commit'
  | 'unknown'

export interface GitFailure {
  kind: GitFailureKind
  message: string
}

type Transport = 'ssh' | 'https' | 'unknown'

const UNREPORTED = 'Git failed without reporting a reason.'
const UNRECOGNISED = 'Git rejected the operation. The full output is in the developer console.'

const NAMED_PATH_LIMIT = 2

function remoteHost(raw: string): string | null {
  const httpsUrl = raw.match(/https?:\/\/(?:[^\s'"@/]+@)?([^\s'"/:]+)/i)
  if (httpsUrl) {
    return httpsUrl[1]
  }
  const sshUrl = raw.match(/ssh:\/\/(?:[^\s'"@/]+@)?([^\s'"/:]+)/i)
  if (sshUrl) {
    return sshUrl[1]
  }
  const scpLike = raw.match(/[\w.-]+@([\w.-]+):/)
  if (scpLike) {
    return scpLike[1]
  }
  const authenticity = raw.match(/authenticity of host '([^\s']+)/i)
  if (authenticity) {
    return authenticity[1]
  }
  const sshConnect = raw.match(/connect to host ([\w.-]+)/i)
  return sshConnect ? sshConnect[1] : null
}

function transportOf(raw: string, lowered: string): Transport {
  if (/https?:\/\//i.test(raw)) {
    return 'https'
  }
  if (
    /ssh:\/\//i.test(raw) ||
    /[\w.-]+@[\w.-]+:/.test(raw) ||
    lowered.includes('publickey') ||
    lowered.includes('known_hosts') ||
    lowered.includes('ssh_exchange')
  ) {
    return 'ssh'
  }
  return 'unknown'
}

function hostPhrase(raw: string): string {
  return remoteHost(raw) ?? 'the remote'
}

function describePaths(paths: readonly string[], noun: string): string {
  if (paths.length > NAMED_PATH_LIMIT) {
    return `${paths.length} ${noun}`
  }
  return paths.join(' and ')
}

function pathsUnder(raw: string, header: RegExp): string[] {
  const lines = raw.split('\n')
  const headerIndex = lines.findIndex((line) => header.test(line))
  if (headerIndex === -1) {
    return []
  }
  const paths: string[] = []
  for (const line of lines.slice(headerIndex + 1)) {
    if (!/^\s+\S/.test(line)) {
      break
    }
    paths.push(line.trim())
  }
  return paths
}

const trackedOverwritePaths = (raw: string): string[] =>
  pathsUnder(raw, /local changes to the following files would be overwritten/i)

const untrackedOverwritePaths = (raw: string): string[] =>
  pathsUnder(raw, /untracked (?:working tree )?files would be overwritten/i)

function authMissing(raw: string, transport: Transport): GitFailure {
  const host = hostPhrase(raw)
  if (transport === 'ssh') {
    return {
      kind: 'auth-missing',
      message: `Connecting to ${host} needs an SSH key, and Rebase never prompts. Start an SSH agent holding a key ${host} accepts, then try again.`
    }
  }
  return {
    kind: 'auth-missing',
    message: `${host} asked for credentials and no credential helper answered — Rebase runs Git without prompts. Configure a credential helper for ${host}, or switch the remote to SSH.`
  }
}

function authRejected(raw: string, transport: Transport): GitFailure {
  const host = hostPhrase(raw)
  if (transport === 'ssh') {
    return {
      kind: 'auth-rejected',
      message: `${host} refused your SSH key. Check that your agent holds a key that host accepts — \`ssh-add -l\` lists the loaded keys.`
    }
  }
  return {
    kind: 'auth-rejected',
    message: `${host} rejected your credentials. An expired token or a stale entry in your credential helper is the usual cause — update it and try again.`
  }
}

function networkFailure(raw: string, lowered: string): GitFailure {
  const host = hostPhrase(raw)
  if (lowered.includes('could not resolve host')) {
    return {
      kind: 'network',
      message: `Couldn't resolve ${host}. Check the remote URL and your network or DNS, then try again.`
    }
  }
  if (
    lowered.includes('ssl certificate problem') ||
    lowered.includes('certificate verify failed')
  ) {
    return {
      kind: 'network',
      message: `The TLS certificate for ${host} could not be verified. A proxy or a missing corporate root certificate is the usual cause.`
    }
  }
  return {
    kind: 'network',
    message: `Couldn't reach ${host}. Check your network, VPN or proxy, then try again.`
  }
}

function blockedByWorkingTree(raw: string): GitFailure {
  const tracked = trackedOverwritePaths(raw)
  const untracked = untrackedOverwritePaths(raw)
  if (tracked.length > 0 && untracked.length > 0) {
    return {
      kind: 'dirty-tree',
      message: `Uncommitted changes (${describePaths(tracked, 'files')}) and untracked files (${describePaths(untracked, 'files')}) would be overwritten. Commit or stash the changes, move the untracked files, then try again.`
    }
  }
  if (untracked.length > 0) {
    return {
      kind: 'untracked-overwrite',
      message: `Untracked files would be overwritten — ${describePaths(untracked, 'files')}. Move, delete or commit them first, then try again.`
    }
  }
  const subject =
    tracked.length > 0
      ? `Uncommitted changes would be overwritten — ${describePaths(tracked, 'files')}`
      : 'Uncommitted changes would be overwritten'
  return {
    kind: 'dirty-tree',
    message: `${subject}. Commit or stash them first, then try again.`
  }
}

function hookRejected(raw: string): GitFailure {
  return {
    kind: 'hook-rejected',
    message: `${hostPhrase(raw)} rejected the push — branch protection or a server-side hook blocked it. The remote's own words are in the developer console.`
  }
}

export function classifyGitFailure(rawMessage: string): GitFailure {
  const raw = rawMessage.trim()
  if (raw.length === 0) {
    return { kind: 'unknown', message: UNREPORTED }
  }
  const lowered = raw.toLowerCase()
  const transport = transportOf(raw, lowered)

  if (
    lowered.includes('terminal prompts disabled') ||
    lowered.includes('could not read username') ||
    lowered.includes('could not read password') ||
    lowered.includes('no askpass program specified')
  ) {
    return authMissing(raw, transport)
  }
  if (
    lowered.includes('remote host identification has changed') ||
    lowered.includes('host key for') ||
    lowered.includes('key verification failed for')
  ) {
    return {
      kind: 'host-key-changed',
      message: `The SSH host key for ${hostPhrase(raw)} no longer matches the one in your known_hosts. Confirm the new fingerprint with your Git host before trusting it — a mismatch can also mean an intercepted connection.`
    }
  }
  if (
    lowered.includes('host key verification failed') ||
    lowered.includes('authenticity of host') ||
    lowered.includes('no matching host key type found')
  ) {
    return {
      kind: 'host-key-unknown',
      message: `${hostPhrase(raw)} isn't a known SSH host on this machine, and Rebase can't answer the trust prompt. Verify the fingerprint your Git host publishes and add it to ~/.ssh/known_hosts.`
    }
  }
  const missingTarget = raw.match(/'([^']+)' does not appear to be a git repository/)
  if (missingTarget) {
    const target = missingTarget[1]
    return /[/\\:]/.test(target)
      ? {
          kind: 'remote-missing',
          message: `${target} is not a Git repository. Check the remote's URL.`
        }
      : {
          kind: 'no-remote',
          message: `This repository has no remote named ${target}, so there is nothing to sync with. Add one, then try again.`
        }
  }
  if (
    lowered.includes('permission denied (publickey') ||
    lowered.includes('authentication failed') ||
    lowered.includes('invalid username or password') ||
    lowered.includes('returned error: 401') ||
    lowered.includes('returned error: 403') ||
    lowered.includes('access denied') ||
    /permission to .+ denied/.test(lowered) ||
    (transport === 'ssh' &&
      lowered.includes('could not read from remote repository') &&
      lowered.includes('correct access rights'))
  ) {
    return authRejected(raw, transport)
  }
  if (
    lowered.includes('could not resolve host') ||
    lowered.includes('connection timed out') ||
    lowered.includes('operation timed out') ||
    lowered.includes('connection refused') ||
    lowered.includes('network is unreachable') ||
    lowered.includes('failed to connect to') ||
    lowered.includes('ssl certificate problem') ||
    lowered.includes('certificate verify failed') ||
    lowered.includes('the remote end hung up unexpectedly') ||
    lowered.includes('unable to access')
  ) {
    return networkFailure(raw, lowered)
  }
  if (lowered.includes('repository not found') || lowered.includes('returned error: 404')) {
    return {
      kind: 'remote-missing',
      message: `${hostPhrase(raw)} has no repository at that URL, or your account can't see it. Check the remote URL and that your account has access.`
    }
  }
  if (
    lowered.includes('no configured push destination') ||
    lowered.includes('no such remote') ||
    lowered.includes('does not appear to have a remote')
  ) {
    return {
      kind: 'no-remote',
      message: 'This repository has no remote configured, so there is nothing to sync with.'
    }
  }
  if (lowered.includes('pre-receive hook declined') || lowered.includes('[remote rejected]')) {
    return hookRejected(raw)
  }
  if (
    lowered.includes('(fetch first)') ||
    lowered.includes('(non-fast-forward)') ||
    lowered.includes('updates were rejected')
  ) {
    return {
      kind: 'non-fast-forward',
      message:
        'The remote branch has commits your branch does not. Pull them first, or force push if you meant to replace the remote history.'
    }
  }
  if (
    lowered.includes('not possible to fast-forward') ||
    lowered.includes('divergent branches') ||
    lowered.includes('need to specify how to reconcile')
  ) {
    return {
      kind: 'diverged',
      message:
        'Your branch and its upstream have both moved, so a fast-forward pull is not possible. Merge or rebase the upstream commits to continue.'
    }
  }
  if (
    lowered.includes('no tracking information for the current branch') ||
    lowered.includes('has no upstream branch') ||
    lowered.includes('no upstream configured')
  ) {
    return {
      kind: 'no-upstream',
      message:
        'This branch is not tracking a remote branch yet. Push it once to publish it and set the upstream.'
    }
  }
  if (lowered.includes('detached head')) {
    return {
      kind: 'detached-head',
      message: 'HEAD is detached, so there is no branch to publish. Check out a branch first.'
    }
  }
  if (
    lowered.includes('would be overwritten') ||
    lowered.includes('you have unstaged changes') ||
    lowered.includes('cannot pull with rebase') ||
    lowered.includes('please commit your changes or stash them')
  ) {
    return blockedByWorkingTree(raw)
  }
  if (
    lowered.includes('automatic merge failed') ||
    lowered.includes('fix conflicts and then commit') ||
    lowered.includes('after resolving the conflicts') ||
    lowered.includes('conflicts prevent') ||
    lowered.includes('could not apply')
  ) {
    return {
      kind: 'conflict',
      message:
        'Conflicts stopped the operation. Resolve the conflicted files and commit, or abort to go back.'
    }
  }
  if (lowered.includes('refusing to merge unrelated histories')) {
    return {
      kind: 'unrelated-histories',
      message:
        'These branches share no history, so Git refuses to merge them. Check that you picked the right branch.'
    }
  }
  if (
    lowered.includes('index.lock') ||
    lowered.includes('another git process seems to be running')
  ) {
    return {
      kind: 'index-lock',
      message:
        'Another Git process holds this repository. Wait for it to finish; if nothing is running, delete .git/index.lock.'
    }
  }
  if (lowered.includes('already exists')) {
    return {
      kind: 'ref-exists',
      message: 'That name is already taken in this repository. Pick another one.'
    }
  }
  if (lowered.includes('is not fully merged')) {
    return {
      kind: 'branch-not-merged',
      message:
        'The branch has commits that are not merged anywhere else. Delete it with force if you are sure you do not need them.'
    }
  }
  if (lowered.includes('nothing to commit') || lowered.includes('no changes added to commit')) {
    return { kind: 'nothing-to-commit', message: 'There is nothing staged to commit.' }
  }
  return { kind: 'unknown', message: UNRECOGNISED }
}
