import {
  ConflictableMutationResponseSchema,
  GitMutationResponseSchema,
  type ResetMode
} from '@shared/schemas/ipc'
import { SidecarOp } from '@shared/sidecar-ops'
import { toast } from 'sonner'
import { sidecarFetch } from '@/lib/sidecar-fetch'
import type { GitStore } from '@/stores/git'

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function useGitActions(git: GitStore) {
  const repoPath = () => git.state.repoPath

  async function mutate(
    op: string,
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
      const response = await sidecarFetch(
        op,
        { repoPath: path, ...body },
        GitMutationResponseSchema
      )
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
    op: string,
    body: Record<string, unknown>,
    label: string
  ): Promise<boolean> {
    const path = repoPath()
    if (!path) {
      toast.error('Repository is not open')
      return false
    }
    try {
      const response = await sidecarFetch(
        op,
        { repoPath: path, ...body },
        ConflictableMutationResponseSchema
      )
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
      mutate(SidecarOp.deleteTag, { name }, `Deleted tag ${name}`, refreshBranches)
  }
}

export type GitActions = ReturnType<typeof useGitActions>
