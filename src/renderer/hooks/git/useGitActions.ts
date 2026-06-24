import type { ResetMode } from '@shared/schemas/ipc'
import { toast } from 'sonner'
import {
  type ConflictableResult,
  type RefWriteResult,
  rpcCherryPick,
  rpcCreateBranch,
  rpcCreateTag,
  rpcDeleteBranch,
  rpcDeleteTag,
  rpcDiscardAll,
  rpcDiscardChanges,
  rpcMergeBranch,
  rpcRenameBranch,
  rpcReset,
  rpcRevertCommit,
  rpcStashApply,
  rpcStashDrop,
  rpcStashPop,
  rpcStashPush
} from '@/lib/rpc-client'
import type { GitStore } from '@/stores/git'

type VoidWriteResult = RefWriteResult

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function useGitActions(git: GitStore) {
  const repoPath = git.state.repoPath

  async function mutateConflictable(
    call: (path: string) => Promise<ConflictableResult>,
    label: string
  ): Promise<boolean> {
    const path = repoPath
    if (!path) {
      toast.error('Repository is not open')
      return false
    }
    try {
      const response = await call(path)
      if (response._tag === 'Ok') {
        await git.refreshAfterMutation(path)
        toast.success(label)
        return true
      }
      if (response._tag === 'Conflict') {
        await git.refreshAfterMutation(path)
        toast.warning(`${label} hit conflicts`, {
          description: 'Resolve the conflicted files, then commit or abort.'
        })
        return false
      }
      if (response._tag === 'GitError') {
        toast.error(`${label} failed`, { description: response.message })
      } else {
        toast.error('Repository is not open')
      }
      return false
    } catch (error) {
      toast.error(`${label} failed`, { description: describe(error) })
      return false
    }
  }

  async function runVoidWrite(
    call: (path: string) => Promise<VoidWriteResult>,
    label: string,
    refresh: (path: string) => Promise<void> = (path) => git.refreshWorkingTree(path)
  ): Promise<boolean> {
    const path = repoPath
    if (!path) {
      toast.error('Repository is not open')
      return false
    }
    try {
      const response = await call(path)
      if (response._tag === 'Ok') {
        await refresh(path)
        toast.success(label)
        return true
      }
      if (response._tag === 'GitError') {
        toast.error(`${label} failed`, { description: response.message })
      } else {
        toast.error('Repository is not open')
      }
      return false
    } catch (error) {
      toast.error(`${label} failed`, { description: describe(error) })
      return false
    }
  }

  const refreshBranches = (path: string) => git.refreshBranchesOnly(path)
  const refreshAll = (path: string) => git.refreshAfterMutation(path)
  const refreshWorkingTree = (path: string) => git.refreshWorkingTree(path)

  async function stashConflictable(
    call: (path: string) => Promise<ConflictableResult>,
    label: string
  ): Promise<boolean> {
    const path = repoPath
    if (!path) {
      toast.error('Repository is not open')
      return false
    }
    const response = await call(path).catch((error: unknown) => {
      toast.error(`${label} failed`, { description: describe(error) })
      return null
    })
    if (!response) {
      return false
    }
    if (response._tag === 'Ok' || response._tag === 'Conflict') {
      await git.refreshWorkingTree(path)
    }
    if (response._tag === 'Ok') {
      toast.success(label)
      return true
    }
    if (response._tag === 'Conflict') {
      toast.warning(`${label} hit conflicts`, { description: 'Resolve the conflicts to continue.' })
    } else if (response._tag === 'GitError') {
      toast.error(`${label} failed`, { description: response.message })
    }
    return false
  }

  return {
    createBranch: (name: string, startPoint?: string, checkout?: boolean) =>
      runVoidWrite(
        (path) => rpcCreateBranch(path, name, startPoint, checkout),
        checkout ? `Created and switched to ${name}` : `Created branch ${name}`,
        checkout ? refreshAll : refreshBranches
      ),
    deleteBranch: (name: string, force?: boolean) =>
      runVoidWrite(
        (path) => rpcDeleteBranch(path, name, force),
        `Deleted branch ${name}`,
        refreshBranches
      ),
    renameBranch: (oldName: string, newName: string) =>
      runVoidWrite(
        (path) => rpcRenameBranch(path, oldName, newName),
        `Renamed ${oldName} to ${newName}`,
        refreshBranches
      ),
    mergeBranch: (ref: string) =>
      mutateConflictable((path) => rpcMergeBranch(path, ref), `Merged ${ref}`),
    resetToCommit: (sha: string, mode: ResetMode) =>
      runVoidWrite(
        (path) => rpcReset(path, sha, mode),
        `Reset (${mode}) to ${sha.slice(0, 7)}`,
        refreshAll
      ),
    revertCommit: (sha: string) =>
      mutateConflictable((path) => rpcRevertCommit(path, sha), `Reverted ${sha.slice(0, 7)}`),
    cherryPick: (sha: string) =>
      mutateConflictable((path) => rpcCherryPick(path, sha), `Cherry-picked ${sha.slice(0, 7)}`),
    createTag: (name: string, ref?: string, message?: string) =>
      runVoidWrite(
        (path) => rpcCreateTag(path, name, ref, message),
        `Created tag ${name}`,
        refreshBranches
      ),
    deleteTag: (name: string) =>
      runVoidWrite((path) => rpcDeleteTag(path, name), `Deleted tag ${name}`, refreshBranches),
    discardChanges: (files: string[], label: string) =>
      runVoidWrite((path) => rpcDiscardChanges(path, files), label),
    discardAll: () => runVoidWrite((path) => rpcDiscardAll(path), 'Discarded all changes'),
    stashPush: (message?: string, includeUntracked?: boolean, files?: string[]) =>
      runVoidWrite(
        (path) => rpcStashPush(path, message, includeUntracked, files),
        'Stashed changes',
        refreshWorkingTree
      ),
    stashApply: (index: number) =>
      stashConflictable((path) => rpcStashApply(path, index), 'Applied stash'),
    stashPop: (index: number) =>
      stashConflictable((path) => rpcStashPop(path, index), 'Popped stash'),
    stashDrop: (index: number) =>
      runVoidWrite(
        (path) => rpcStashDrop(path, index),
        'Dropped stash',
        (path) => git.refreshStashes(path)
      )
  }
}

export type GitActions = ReturnType<typeof useGitActions>
