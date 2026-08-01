export interface BranchTracking {
  ahead: number
  behind: number
}

export interface LocalBranchSnapshot {
  current: string
  all: string[]
  tracking: Record<string, BranchTracking>
  lastCommitAt: Record<string, string>
}

export interface RemoteAndTagRefs {
  remotes: string[]
  tags: string[]
  remoteLastCommitAt: Record<string, string>
  tagLastCommitAt: Record<string, string>
}

export const LOCAL_BRANCH_FORMAT =
  '%(refname:short)%00%(HEAD)%00%(upstream:track)%00%(committerdate:iso-strict)'
export const REMOTE_AND_TAG_FORMAT =
  '%(refname)%00%(symref)%00%(committerdate:iso-strict)%00%(*committerdate:iso-strict)'

const FIELD_SEP = '\x00'
const REMOTE_PREFIX = 'refs/remotes/'
const TAG_PREFIX = 'refs/tags/'

function parseTrack(trackStr: string): BranchTracking | null {
  if (!trackStr || trackStr.includes('[gone]')) {
    return null
  }
  const aheadMatch = trackStr.match(/ahead (\d+)/)
  const behindMatch = trackStr.match(/behind (\d+)/)
  const ahead = aheadMatch ? Number.parseInt(aheadMatch[1], 10) : 0
  const behind = behindMatch ? Number.parseInt(behindMatch[1], 10) : 0
  if (ahead > 0 || behind > 0) {
    return { ahead, behind }
  }
  return null
}

export function parseLocalBranchRefs(rawOutput: string): LocalBranchSnapshot {
  const all: string[] = []
  let current = ''
  const tracking: Record<string, BranchTracking> = {}
  const lastCommitAt: Record<string, string> = {}
  for (const line of rawOutput.split('\n')) {
    if (!line) {
      continue
    }
    const [name, headMarker, trackStr, committerDate] = line.split(FIELD_SEP)
    if (!name) {
      continue
    }
    all.push(name)
    if (headMarker === '*') {
      current = name
    }
    const track = parseTrack(trackStr ?? '')
    if (track) {
      tracking[name] = track
    }
    if (committerDate) {
      lastCommitAt[name] = committerDate.trim()
    }
  }
  return { current, all, tracking, lastCommitAt }
}

export function parseRemoteAndTagRefs(rawOutput: string): RemoteAndTagRefs {
  const remotes: string[] = []
  const tags: string[] = []
  const remoteLastCommitAt: Record<string, string> = {}
  const tagLastCommitAt: Record<string, string> = {}
  for (const line of rawOutput.split('\n')) {
    if (!line) {
      continue
    }
    const [refname, symref, committerDate, peeledCommitterDate] = line.split(FIELD_SEP)
    if (!refname || symref) {
      continue
    }
    const lastCommitAt = (peeledCommitterDate || committerDate || '').trim()
    if (refname.startsWith(REMOTE_PREFIX)) {
      const name = refname.slice(REMOTE_PREFIX.length)
      remotes.push(name)
      if (lastCommitAt) {
        remoteLastCommitAt[name] = lastCommitAt
      }
    } else if (refname.startsWith(TAG_PREFIX)) {
      const name = refname.slice(TAG_PREFIX.length)
      tags.push(name)
      if (lastCommitAt) {
        tagLastCommitAt[name] = lastCommitAt
      }
    }
  }
  return { remotes, tags, remoteLastCommitAt, tagLastCommitAt }
}
