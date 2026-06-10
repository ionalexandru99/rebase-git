export interface BranchTracking {
  ahead: number
  behind: number
}

export interface LocalBranchSnapshot {
  current: string
  all: string[]
  tracking: Record<string, BranchTracking>
}

export interface RemoteAndTagRefs {
  remotes: string[]
  tags: string[]
}

export const LOCAL_BRANCH_FORMAT = '%(refname:short)%00%(HEAD)%00%(upstream:track)'
export const REMOTE_AND_TAG_FORMAT = '%(refname)%00%(symref)'

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
  for (const line of rawOutput.split('\n')) {
    if (!line) {
      continue
    }
    const [name, headMarker, trackStr] = line.split(FIELD_SEP)
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
  }
  return { current, all, tracking }
}

export function parseRemoteAndTagRefs(rawOutput: string): RemoteAndTagRefs {
  const remotes: string[] = []
  const tags: string[] = []
  for (const line of rawOutput.split('\n')) {
    if (!line) {
      continue
    }
    const [refname, symref] = line.split(FIELD_SEP)
    if (!refname || symref) {
      continue
    }
    if (refname.startsWith(REMOTE_PREFIX)) {
      remotes.push(refname.slice(REMOTE_PREFIX.length))
    } else if (refname.startsWith(TAG_PREFIX)) {
      tags.push(refname.slice(TAG_PREFIX.length))
    }
  }
  return { remotes, tags }
}
