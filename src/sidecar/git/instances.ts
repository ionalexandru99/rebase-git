import type { ChildProcess, SpawnOptions } from 'node:child_process'
import { normalizeRepoPath } from '@shared/repo-path'
import { type SimpleGit, simpleGit } from 'simple-git'
import { registerRepoChild } from '../spawn'

export { normalizeRepoPath }

interface SimpleGitPluginHost {
  _plugins: {
    add(plugin: unknown): () => void
  }
}

interface SpawnAfterContext {
  spawned: ChildProcess
}

export function createGit(repoPath: string): SimpleGit {
  const git = simpleGit(repoPath)
  const plugins = (git as unknown as SimpleGitPluginHost)._plugins
  plugins.add({
    type: 'spawn.options',
    action: (options: SpawnOptions) => ({
      ...options,
      detached: process.platform !== 'win32'
    })
  })
  plugins.add({
    type: 'spawn.after',
    action: (_: undefined, context: SpawnAfterContext) => {
      registerRepoChild(repoPath, context.spawned)
    }
  })
  return git
}

export function getOrCreateGit(map: Map<string, SimpleGit>, repoPath: string): SimpleGit {
  const key = normalizeRepoPath(repoPath)
  let git = map.get(key)
  if (!git) {
    git = createGit(key)
    map.set(key, git)
  }
  return git
}

export function lookupGit(map: Map<string, SimpleGit>, repoPath: string): SimpleGit | undefined {
  return map.get(normalizeRepoPath(repoPath))
}
