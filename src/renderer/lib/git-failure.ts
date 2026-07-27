import type { HelpTopic } from '@shared/help-links'

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
  /** What went wrong and what the user can do about it. Safe to show on its own. */
  description: string
  helpTopic?: HelpTopic
}

type Transport = 'ssh' | 'https' | 'unknown'

const UNREPORTED = 'Git failed without reporting a reason.'

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

// "the remote" reads badly in a sentence that already names a host, so callers pick one or the other.
function hostPhrase(raw: string): string {
  return remoteHost(raw) ?? 'the remote'
}

function formatPaths(paths: readonly string[]): string {
  if (paths.length <= 3) {
    return paths.join(', ')
  }
  return `${paths.slice(0, 3).join(', ')} and ${paths.length - 3} more`
}

// git lists the blocking files on their own indented lines between the "would be overwritten" header
// and the "Please commit…" advice.
function overwrittenPaths(raw: string): string[] {
  const lines = raw.split('\n')
  const header = lines.findIndex((line) => /would be overwritten/i.test(line))
  if (header === -1) {
    return []
  }
  const paths: string[] = []
  for (const line of lines.slice(header + 1)) {
    if (!/^\s+\S/.test(line)) {
      break
    }
    paths.push(line.trim())
  }
  return paths
}

function remoteSaid(raw: string): string | null {
  const lines = raw
    .split('\n')
    .filter((line) => /^remote:/.test(line.trim()))
    .map((line) => line.trim().replace(/^remote:\s*/, ''))
    .filter((line) => line.length > 0 && !/^\s*$/.test(line))
  return lines.length > 0 ? lines.join(' ') : null
}

function authMissing(raw: string, transport: Transport): GitFailure {
  const host = hostPhrase(raw)
  if (transport === 'ssh') {
    return {
      kind: 'auth-missing',
      description: `Connecting to ${host} needs an SSH key, and Rebase never prompts. Start an SSH agent holding a key ${host} accepts, then try again.`,
      helpTopic: 'ssh-keys'
    }
  }
  return {
    kind: 'auth-missing',
    description: `${host} asked for credentials and no credential helper answered — Rebase runs Git without prompts. Configure a credential helper for ${host}, or switch the remote to SSH.`,
    helpTopic: 'git-credentials'
  }
}

function authRejected(raw: string, transport: Transport): GitFailure {
  const host = hostPhrase(raw)
  if (transport === 'ssh') {
    return {
      kind: 'auth-rejected',
      description: `${host} refused your SSH key. Check that your agent holds a key that host accepts — \`ssh-add -l\` lists the loaded keys.`,
      helpTopic: 'ssh-keys'
    }
  }
  return {
    kind: 'auth-rejected',
    description: `${host} rejected your credentials. An expired token or a stale entry in your credential helper is the usual cause — update it and try again.`,
    helpTopic: 'git-credentials'
  }
}

function networkFailure(raw: string, lowered: string): GitFailure {
  const host = hostPhrase(raw)
  if (lowered.includes('could not resolve host')) {
    return {
      kind: 'network',
      description: `Couldn't resolve ${host}. Check the remote URL and your network or DNS, then try again.`
    }
  }
  if (
    lowered.includes('ssl certificate problem') ||
    lowered.includes('certificate verify failed')
  ) {
    return {
      kind: 'network',
      description: `The TLS certificate for ${host} could not be verified. A proxy or a missing corporate root certificate is the usual cause.`
    }
  }
  return {
    kind: 'network',
    description: `Couldn't reach ${host}. Check your network, VPN or proxy, then try again.`
  }
}

function dirtyTree(raw: string): GitFailure {
  const paths = overwrittenPaths(raw)
  const subject =
    paths.length > 0 ? `Uncommitted changes to ${formatPaths(paths)}` : 'Uncommitted changes'
  return {
    kind: 'dirty-tree',
    description: `${subject} would be overwritten. Commit or stash them first, then try again.`
  }
}

function untrackedOverwrite(raw: string): GitFailure {
  const paths = overwrittenPaths(raw)
  const subject = paths.length > 0 ? `Untracked files (${formatPaths(paths)})` : 'Untracked files'
  return {
    kind: 'untracked-overwrite',
    description: `${subject} would be overwritten. Move, delete or commit them first, then try again.`
  }
}

function hookRejected(raw: string): GitFailure {
  const said = remoteSaid(raw)
  return {
    kind: 'hook-rejected',
    description: said
      ? `${hostPhrase(raw)} rejected the push: ${said}`
      : `${hostPhrase(raw)} rejected the push — branch protection or a server-side hook blocked it.`
  }
}

/**
 * Turns raw git stderr into a message that names the failure and the fix. Anything we do not
 * recognise is passed through verbatim rather than softened — an honest raw message beats a vague
 * friendly one.
 */
export function classifyGitFailure(rawMessage: string): GitFailure {
  const raw = rawMessage.trim()
  if (raw.length === 0) {
    return { kind: 'unknown', description: UNREPORTED }
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
      description: `The SSH host key for ${hostPhrase(raw)} no longer matches the one in your known_hosts. Confirm the new fingerprint with your Git host before trusting it — a mismatch can also mean an intercepted connection.`,
      helpTopic: 'ssh-known-hosts'
    }
  }
  if (
    lowered.includes('host key verification failed') ||
    lowered.includes('authenticity of host') ||
    lowered.includes('no matching host key type found')
  ) {
    return {
      kind: 'host-key-unknown',
      description: `${hostPhrase(raw)} isn't a known SSH host on this machine, and Rebase can't answer the trust prompt. Verify the fingerprint your Git host publishes and add it to ~/.ssh/known_hosts.`,
      helpTopic: 'ssh-known-hosts'
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
    (lowered.includes('could not read from remote repository') &&
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
  if (
    lowered.includes('repository not found') ||
    lowered.includes('does not appear to be a git repository') ||
    lowered.includes('returned error: 404')
  ) {
    return {
      kind: 'remote-missing',
      description: `${hostPhrase(raw)} has no repository at that URL, or your account can't see it. Check the remote URL and that your account has access.`
    }
  }
  if (
    lowered.includes('no configured push destination') ||
    lowered.includes('no such remote') ||
    lowered.includes('does not appear to have a remote')
  ) {
    return {
      kind: 'no-remote',
      description: 'This repository has no remote configured, so there is nothing to sync with.'
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
      description:
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
      description:
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
      description:
        'This branch is not tracking a remote branch yet. Push it once to publish it and set the upstream.'
    }
  }
  if (lowered.includes('detached head')) {
    return {
      kind: 'detached-head',
      description: 'HEAD is detached, so there is no branch to publish. Check out a branch first.'
    }
  }
  if (lowered.includes('untracked working tree files would be overwritten')) {
    return untrackedOverwrite(raw)
  }
  if (
    lowered.includes('would be overwritten') ||
    lowered.includes('you have unstaged changes') ||
    lowered.includes('cannot pull with rebase') ||
    lowered.includes('please commit your changes or stash them')
  ) {
    return dirtyTree(raw)
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
      description:
        'Conflicts stopped the operation. Resolve the conflicted files and commit, or abort to go back.'
    }
  }
  if (lowered.includes('refusing to merge unrelated histories')) {
    return {
      kind: 'unrelated-histories',
      description:
        'These branches share no history, so Git refuses to merge them. Check that you picked the right branch.'
    }
  }
  if (
    lowered.includes('index.lock') ||
    lowered.includes('another git process seems to be running')
  ) {
    return {
      kind: 'index-lock',
      description:
        'Another Git process holds this repository. Wait for it to finish; if nothing is running, delete .git/index.lock.'
    }
  }
  if (lowered.includes('already exists')) {
    return {
      kind: 'ref-exists',
      description: 'That name is already taken in this repository. Pick another one.'
    }
  }
  if (lowered.includes('is not fully merged')) {
    return {
      kind: 'branch-not-merged',
      description:
        'The branch has commits that are not merged anywhere else. Delete it with force if you are sure you do not need them.'
    }
  }
  if (lowered.includes('nothing to commit') || lowered.includes('no changes added to commit')) {
    return { kind: 'nothing-to-commit', description: 'There is nothing staged to commit.' }
  }
  return { kind: 'unknown', description: raw }
}

/** Single-line form for the tab's error banner, which has no room for a title and a body. */
export function gitFailureBannerText(label: string, rawMessage: string): string {
  return `${label}: ${classifyGitFailure(rawMessage).description}`
}
