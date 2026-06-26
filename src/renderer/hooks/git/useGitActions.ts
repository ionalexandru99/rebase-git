import {
  CherryPick,
  CreateBranch,
  CreateTag,
  DeleteBranch,
  DeleteTag,
  DiscardAll,
  DiscardChanges,
  MergeBranch,
  RenameBranch,
  Reset,
  RevertCommit,
  StashApply,
  StashDrop,
  StashPop,
  StashPush
} from '@shared/rpc'
import type { ResetMode } from '@shared/schemas/ipc'
import {
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

const shortSha = (sha: string) => sha.slice(0, 7)

export function useGitActions(git: GitStore) {
  return {
    createBranch: (name: string, startPoint?: string, checkout?: boolean) =>
      git.runAction(
        CreateBranch._tag,
        (path) => rpcCreateBranch(path, name, startPoint, checkout),
        checkout ? `Created and switched to ${name}` : `Created branch ${name}`
      ),
    deleteBranch: (name: string, force?: boolean) =>
      git.runAction(
        DeleteBranch._tag,
        (path) => rpcDeleteBranch(path, name, force),
        `Deleted branch ${name}`
      ),
    renameBranch: (oldName: string, newName: string) =>
      git.runAction(
        RenameBranch._tag,
        (path) => rpcRenameBranch(path, oldName, newName),
        `Renamed ${oldName} to ${newName}`
      ),
    mergeBranch: (ref: string) =>
      git.runAction(MergeBranch._tag, (path) => rpcMergeBranch(path, ref), `Merged ${ref}`),
    resetToCommit: (sha: string, mode: ResetMode) =>
      git.runAction(
        Reset._tag,
        (path) => rpcReset(path, sha, mode),
        `Reset (${mode}) to ${shortSha(sha)}`
      ),
    revertCommit: (sha: string) =>
      git.runAction(
        RevertCommit._tag,
        (path) => rpcRevertCommit(path, sha),
        `Reverted ${shortSha(sha)}`
      ),
    cherryPick: (sha: string) =>
      git.runAction(
        CherryPick._tag,
        (path) => rpcCherryPick(path, sha),
        `Cherry-picked ${shortSha(sha)}`
      ),
    createTag: (name: string, ref?: string, message?: string) =>
      git.runAction(
        CreateTag._tag,
        (path) => rpcCreateTag(path, name, ref, message),
        `Created tag ${name}`
      ),
    deleteTag: (name: string) =>
      git.runAction(DeleteTag._tag, (path) => rpcDeleteTag(path, name), `Deleted tag ${name}`),
    discardChanges: (files: string[], label: string) =>
      git.runAction(DiscardChanges._tag, (path) => rpcDiscardChanges(path, files), label),
    discardAll: () =>
      git.runAction(DiscardAll._tag, (path) => rpcDiscardAll(path), 'Discarded all changes'),
    stashPush: (message?: string, includeUntracked?: boolean, files?: string[]) =>
      git.runAction(
        StashPush._tag,
        (path) => rpcStashPush(path, message, includeUntracked, files),
        'Stashed changes'
      ),
    stashApply: (index: number) =>
      git.runAction(StashApply._tag, (path) => rpcStashApply(path, index), 'Applied stash'),
    stashPop: (index: number) =>
      git.runAction(StashPop._tag, (path) => rpcStashPop(path, index), 'Popped stash'),
    stashDrop: (index: number) =>
      git.runAction(StashDrop._tag, (path) => rpcStashDrop(path, index), 'Dropped stash')
  }
}

export type GitActions = ReturnType<typeof useGitActions>
