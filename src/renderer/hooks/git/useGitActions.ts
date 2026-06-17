import type { ResetMode } from '@shared/schemas/ipc'
import { SidecarOp } from '@shared/sidecar-ops'
import type { SidecarRequest, SidecarResponse } from '@shared/sidecar-registry'
import { toast } from 'sonner'
import { sidecarFetch } from '@/lib/sidecar-fetch'
import type { GitStore } from '@/stores/git'

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

type GitMutationOp =
  | typeof SidecarOp.createBranch
  | typeof SidecarOp.deleteBranch
  | typeof SidecarOp.renameBranch
  | typeof SidecarOp.resetToCommit
  | typeof SidecarOp.createTag
  | typeof SidecarOp.deleteTag
  | typeof SidecarOp.discardChanges
  | typeof SidecarOp.discardAll
  | typeof SidecarOp.stashPush
  | typeof SidecarOp.stashDrop

type ConflictableMutationOp =
  | typeof SidecarOp.mergeBranch
  | typeof SidecarOp.revertCommit
  | typeof SidecarOp.cherryPick
  | typeof SidecarOp.stashApply
  | typeof SidecarOp.stashPop

async function fetchAction<Op extends GitMutationOp | ConflictableMutationOp>(
  op: Op,
  body: Record<string, unknown>
): Promise<SidecarResponse<Op>> {
  return sidecarFetch(op, body as SidecarRequest<Op>)
}

export function useGitActions(git: GitStore) {
  const repoPath = () => git.state.repoPath

  async function mutate(
    op: GitMutationOp,
    body: Record<string, unknown>,
    label: string,
    refresh: (path: string) => Promise<void>
  ): Promise<boolean> {
    const path = repoPath()
    if (!path) {
      toast.error('Repository is not open')
      return false
    }
    try {
      const response = await fetchAction(op, { repoPath: path, ...body })
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

  async function mutateConflictable(
    op: ConflictableMutationOp,
    body: Record<string, unknown>,
    label: string
  ): Promise<boolean> {
    const path = repoPath()
    if (!path) {
      toast.error('Repository is not open')
      return false
    }
    try {
      const response = await fetchAction(op, { repoPath: path, ...body })
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

  const refreshBranches = (path: string) => git.refreshBranchesOnly(path)
  const refreshAll = (path: string) => git.refreshAfterMutation(path)
  const refreshWorkingTree = (path: string) => git.refreshWorkingTree(path)

  async function stashConflictable(
    op: typeof SidecarOp.stashApply | typeof SidecarOp.stashPop,
    index: number,
    label: string
  ): Promise<boolean> {
    const path = repoPath()
    if (!path) {
      toast.error('Repository is not open')
      return false
    }
    const response = await fetchAction(op, { repoPath: path, index }).catch((error: unknown) => {
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
      mutate(
        SidecarOp.createBranch,
        { name, startPoint, checkout },
        checkout ? `Created and switched to ${name}` : `Created branch ${name}`,
        checkout ? refreshAll : refreshBranches
      ),
    deleteBranch: (name: string, force?: boolean) =>
      mutate(SidecarOp.deleteBranch, { name, force }, `Deleted branch ${name}`, refreshBranches),
    renameBranch: (oldName: string, newName: string) =>
      mutate(
        SidecarOp.renameBranch,
        { oldName, newName },
        `Renamed ${oldName} to ${newName}`,
        refreshBranches
      ),
    mergeBranch: (ref: string) =>
      mutateConflictable(SidecarOp.mergeBranch, { ref }, `Merged ${ref}`),
    resetToCommit: (sha: string, mode: ResetMode) =>
      mutate(
        SidecarOp.resetToCommit,
        { sha, mode },
        `Reset (${mode}) to ${sha.slice(0, 7)}`,
        refreshAll
      ),
    revertCommit: (sha: string) =>
      mutateConflictable(SidecarOp.revertCommit, { sha }, `Reverted ${sha.slice(0, 7)}`),
    cherryPick: (sha: string) =>
      mutateConflictable(SidecarOp.cherryPick, { sha }, `Cherry-picked ${sha.slice(0, 7)}`),
    createTag: (name: string, ref?: string, message?: string) =>
      mutate(SidecarOp.createTag, { name, ref, message }, `Created tag ${name}`, refreshBranches),
    deleteTag: (name: string) =>
      mutate(SidecarOp.deleteTag, { name }, `Deleted tag ${name}`, refreshBranches),
    discardChanges: (files: string[], label: string) =>
      mutate(SidecarOp.discardChanges, { files }, label, refreshWorkingTree),
    discardAll: () => mutate(SidecarOp.discardAll, {}, 'Discarded all changes', refreshWorkingTree),
    stashPush: (message?: string, includeUntracked?: boolean, files?: string[]) =>
      mutate(
        SidecarOp.stashPush,
        { message, includeUntracked, files },
        'Stashed changes',
        refreshWorkingTree
      ),
    stashApply: (index: number) => stashConflictable(SidecarOp.stashApply, index, 'Applied stash'),
    stashPop: (index: number) => stashConflictable(SidecarOp.stashPop, index, 'Popped stash'),
    stashDrop: (index: number) =>
      mutate(SidecarOp.stashDrop, { index }, 'Dropped stash', (path) => git.refreshStashes(path))
  }
}

export type GitActions = ReturnType<typeof useGitActions>
