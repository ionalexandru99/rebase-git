import type { GitLogEntry } from '@/types'

export interface CommitLogBuffer {
  readonly entries: GitLogEntry[]
  readonly length: number
  beginStream: () => void
  restore: (entries: readonly GitLogEntry[], published: boolean) => void
  clear: () => void
  append: (commits: readonly GitLogEntry[]) => boolean
  markCurrentAsPublished: () => GitLogEntry[]
  getPublishableSnapshot: () => GitLogEntry[] | null
  markCurrentAsFlushed: () => void
}

export function createCommitLogBuffer(): CommitLogBuffer {
  let entries: GitLogEntry[] = []
  let publishedEntries: GitLogEntry[] | null = null
  let hashes = new Set<string>()
  let revision = 0
  let publishedRevision = -1

  const replaceEntries = (nextEntries: GitLogEntry[]) => {
    entries = nextEntries
    publishedEntries = null
    hashes = new Set(entries.map((commit) => commit.hash))
    revision += 1
  }

  return {
    get entries() {
      return entries
    },
    get length() {
      return entries.length
    },
    beginStream() {
      replaceEntries([])
    },
    restore(nextEntries, published) {
      replaceEntries([...nextEntries])
      publishedRevision = published ? revision : -1
    },
    clear() {
      replaceEntries([])
      publishedRevision = -1
    },
    append(commits) {
      let appended = false
      for (const commit of commits) {
        if (hashes.has(commit.hash)) {
          continue
        }
        if (!appended && publishedEntries === entries) {
          entries = [...entries]
          publishedEntries = null
        }
        hashes.add(commit.hash)
        entries.push(commit)
        appended = true
      }
      if (appended) {
        revision += 1
      }
      return appended
    },
    markCurrentAsPublished() {
      publishedEntries = entries
      return entries
    },
    getPublishableSnapshot() {
      if (publishedRevision === revision) {
        return null
      }
      return entries
    },
    markCurrentAsFlushed() {
      publishedEntries = entries
      publishedRevision = revision
    }
  }
}
