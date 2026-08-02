import { act } from '@testing-library/react'
import { vi } from 'vitest'

export interface LogStreamHandle {
  fire: (chunk: {
    repoPath: string
    commits: Array<{
      hash: string
      message: string
      author_name: string
      date: string
      parents: string[]
      refs: string
    }>
    done?: boolean
    hasMore?: boolean
    error?: string
    streamId?: number
  }) => void
  fireDone: (repoPath: string, hasMore?: boolean) => void
}

export function setupLogStream(): LogStreamHandle {
  const listeners: Array<(chunk: unknown) => void> = []
  vi.mocked(window.electronAPI.onLogChunk).mockImplementation((callback) => {
    listeners.push(callback as (chunk: unknown) => void)
    return () => {
      const index = listeners.indexOf(callback as (chunk: unknown) => void)
      if (index !== -1) {
        listeners.splice(index, 1)
      }
    }
  })
  vi.mocked(window.electronAPI.startLogStream).mockResolvedValue({ _tag: 'Ok' })
  vi.mocked(window.electronAPI.cancelLogStream).mockResolvedValue({})
  return {
    fire: (chunk) => {
      act(() => {
        for (const callback of listeners.slice()) {
          callback({ done: false, ...chunk })
        }
      })
    },
    fireDone: (repoPath, hasMore) => {
      act(() => {
        for (const callback of listeners.slice()) {
          callback({ repoPath, commits: [], done: true, hasMore })
        }
      })
    }
  }
}

export interface RepoChangedHandle {
  fire: (event: { repoPath: string; kind: 'refs' | 'workingTree' | 'index' }) => void
}

export function setupRepoChanged(): RepoChangedHandle {
  const listeners: Array<(event: unknown) => void> = []
  vi.mocked(window.electronAPI.onRepoChanged).mockImplementation((callback) => {
    listeners.push(callback as (event: unknown) => void)
    return () => {
      const index = listeners.indexOf(callback as (event: unknown) => void)
      if (index !== -1) {
        listeners.splice(index, 1)
      }
    }
  })
  return {
    fire: (event) => {
      act(() => {
        for (const callback of listeners.slice()) {
          callback(event)
        }
      })
    }
  }
}
