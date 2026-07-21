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
import type { RefKind, ResetMode } from '@shared/schemas/ipc'
import { useMemo } from 'react'
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
import type { ActionRunner } from '@/stores/git'

const shortSha = (sha: string) => sha.slice(0, 7)

export function useGitActions(runner: ActionRunner) {
  return useMemo(
    () => ({
      createBranch: (
        name: string,
        startPoint?: string,
        checkout?: boolean,
        startPointKind?: RefKind
      ) =>
        runner.runAction(
          checkout ? 'createBranchCheckout' : CreateBranch._tag,
          (path) => rpcCreateBranch(path, name, startPoint, checkout, startPointKind),
          checkout ? `Created and switched to ${name}` : `Created branch ${name}`
        ),
      deleteBranch: (name: string, force?: boolean) =>
        runner.runAction(
          DeleteBranch._tag,
          (path) => rpcDeleteBranch(path, name, force),
          `Deleted branch ${name}`
        ),
      renameBranch: (oldName: string, newName: string) =>
        runner.runAction(
          RenameBranch._tag,
          (path) => rpcRenameBranch(path, oldName, newName),
          `Renamed ${oldName} to ${newName}`
        ),
      mergeBranch: (refKind: RefKind, fullPath: string) =>
        runner.runAction(
          MergeBranch._tag,
          (path) => rpcMergeBranch(path, refKind, fullPath),
          `Merged ${fullPath}`
        ),
      resetToCommit: (sha: string, mode: ResetMode) =>
        runner.runAction(
          Reset._tag,
          (path) => rpcReset(path, sha, mode),
          `Reset (${mode}) to ${shortSha(sha)}`
        ),
      revertCommit: (sha: string) =>
        runner.runAction(
          RevertCommit._tag,
          (path) => rpcRevertCommit(path, sha),
          `Reverted ${shortSha(sha)}`
        ),
      cherryPick: (sha: string) =>
        runner.runAction(
          CherryPick._tag,
          (path) => rpcCherryPick(path, sha),
          `Cherry-picked ${shortSha(sha)}`
        ),
      createTag: (name: string, ref?: string, message?: string, refKind?: RefKind) =>
        runner.runAction(
          CreateTag._tag,
          (path) => rpcCreateTag(path, name, ref, message, refKind),
          `Created tag ${name}`
        ),
      deleteTag: (name: string) =>
        runner.runAction(DeleteTag._tag, (path) => rpcDeleteTag(path, name), `Deleted tag ${name}`),
      discardChanges: (files: string[], label: string) =>
        runner.runAction(DiscardChanges._tag, (path) => rpcDiscardChanges(path, files), label),
      discardAll: () =>
        runner.runAction(DiscardAll._tag, (path) => rpcDiscardAll(path), 'Discarded all changes'),
      stashPush: (message?: string, includeUntracked?: boolean, files?: string[]) =>
        runner.runAction(
          StashPush._tag,
          (path) => rpcStashPush(path, message, includeUntracked, files),
          'Stashed changes'
        ),
      stashApply: (index: number, expectedOid: string) =>
        runner.runAction(
          StashApply._tag,
          (path) => rpcStashApply(path, index, expectedOid),
          'Applied stash'
        ),
      stashPop: (index: number, expectedOid: string) =>
        runner.runAction(
          StashPop._tag,
          (path) => rpcStashPop(path, index, expectedOid),
          'Popped stash'
        ),
      stashDrop: (index: number, expectedOid: string) =>
        runner.runAction(
          StashDrop._tag,
          (path) => rpcStashDrop(path, index, expectedOid),
          'Dropped stash'
        )
    }),
    [runner.runAction]
  )
}

export type GitActions = ReturnType<typeof useGitActions>
