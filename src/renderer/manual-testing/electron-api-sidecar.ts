import type { RepoChangedEvent, StatusFileCode } from '@shared/schemas/git'
import type { IElectronAPI } from '../../preload'
import {
  addRef,
  bodyString,
  bodyStrings,
  captureFiles,
  cloneManualStatus,
  deleteRef,
  findRefCommitIndex,
  type ManualGitState,
  makeDiff,
  moveHead,
  nextObjectId,
  refsForCommit,
  reindexStashes,
  removeFiles,
  renameRef,
  restoreFiles,
  stageFile,
  unstageFile,
  updateCommitRefs,
  updateFileCodesAfterCommit,
  without,
  withValue
} from './electron-api-state'

interface ManualSidecarOptions {
  repoPath: string
  notifyRepoChanged: (kind: RepoChangedEvent['kind']) => void
}

export function createManualSidecarRequest(
  state: ManualGitState,
  options: ManualSidecarOptions
): IElectronAPI['sidecarRequest'] {
  const ok = { _tag: 'Ok' as const }

  return async (operation, body) => {
    const repoPath = bodyString(body, 'repoPath')
    if (repoPath && repoPath !== options.repoPath) {
      return { _tag: 'RepoNotOpen' }
    }

    switch (operation) {
      case 'getStatus':
        return { ...ok, status: cloneManualStatus(state.status) }
      case 'getLocalBranches':
        return {
          ...ok,
          branches: {
            current: state.status.current,
            all: [...state.branches],
            tracking: { main: { ahead: 1, behind: 0 } }
          }
        }
      case 'getRemoteRefs':
        return {
          ...ok,
          refs: {
            remotes: ['origin/main', 'origin/feature/streaming'],
            tags: [...state.tags]
          }
        }
      case 'getDiff':
        return { ...ok, patch: makeDiff(bodyString(body, 'file')), binary: false }
      case 'getHeadCommit': {
        const head = state.commits[findRefCommitIndex(state, undefined)]
        return {
          ...ok,
          result: {
            sha: head.hash,
            message: head.message,
            files: [
              { status: 'M', path: 'src/main/index.ts' },
              { status: 'A', path: 'src/renderer/manual-testing/electron-api.ts' }
            ],
            parentCount: head.parents.length
          }
        }
      }
      case 'stashList':
        return {
          ...ok,
          stashes: state.stashes.map(({ files: _, ...stash }) => ({ ...stash }))
        }
      case 'stageFile':
      case 'stageHunk':
        stageFile(state, bodyString(body, 'file'))
        options.notifyRepoChanged('index')
        return ok
      case 'stageAll':
        for (const file of bodyStrings(body, 'files')) {
          stageFile(state, file)
        }
        options.notifyRepoChanged('index')
        return ok
      case 'unstageFile':
      case 'unstageHunk':
        unstageFile(state, bodyString(body, 'file'))
        options.notifyRepoChanged('index')
        return ok
      case 'unstageAll':
        for (const file of bodyStrings(body, 'files')) {
          unstageFile(state, file)
        }
        options.notifyRepoChanged('index')
        return ok
      case 'discardChanges':
        removeFiles(state, bodyStrings(body, 'files'))
        options.notifyRepoChanged('workingTree')
        return ok
      case 'discardAll':
        removeFiles(
          state,
          state.status.files.map((file) => file.path)
        )
        options.notifyRepoChanged('workingTree')
        return ok
      case 'commit': {
        const message = bodyString(body, 'message')
        const changedFiles = [...state.status.staged]
        const currentHeadIndex = findRefCommitIndex(state, undefined)
        const previousHead = state.commits[currentHeadIndex]
        const hash = nextObjectId(state)
        state.commits = state.commits.map((commit) =>
          updateCommitRefs(
            commit,
            refsForCommit(commit).filter((ref) => !ref.startsWith('HEAD -> '))
          )
        )
        state.commits.unshift({
          hash,
          message,
          author_name: 'Playwright MCP',
          date: new Date().toISOString(),
          parents: [previousHead.hash],
          refs: `HEAD -> ${state.status.current}`
        })
        state.status.staged = []
        state.status.files = state.status.files
          .map(updateFileCodesAfterCommit)
          .filter((file): file is StatusFileCode => file !== null)
        options.notifyRepoChanged('refs')
        return {
          ...ok,
          result: {
            commit: hash,
            branch: state.status.current,
            summary: { changes: changedFiles.length, insertions: 4, deletions: 1 }
          }
        }
      }
      case 'amendCommit': {
        const message = bodyString(body, 'message')
        const headIndex = findRefCommitIndex(state, undefined)
        state.commits[headIndex] = { ...state.commits[headIndex], message }
        options.notifyRepoChanged('refs')
        return {
          ...ok,
          result: {
            commit: state.commits[headIndex].hash,
            branch: state.status.current,
            summary: { changes: state.status.staged.length, insertions: 2, deletions: 1 }
          }
        }
      }
      case 'checkout': {
        const checkedOut = bodyString(body, 'fullPath').replace(/^origin\//, '')
        state.status.current = checkedOut
        state.branches = withValue(state.branches, checkedOut)
        moveHead(state, checkedOut)
        options.notifyRepoChanged('refs')
        return { ...ok, checkedOut }
      }
      case 'createBranch': {
        const branch = bodyString(body, 'name')
        state.branches = withValue(state.branches, branch)
        addRef(
          state,
          findRefCommitIndex(state, bodyString(body, 'startPoint') || undefined),
          branch
        )
        if (body.checkout === true) {
          state.status.current = branch
          moveHead(state, branch)
        }
        options.notifyRepoChanged('refs')
        return ok
      }
      case 'deleteBranch':
        state.branches = without(state.branches, bodyString(body, 'name'))
        deleteRef(state, bodyString(body, 'name'))
        options.notifyRepoChanged('refs')
        return ok
      case 'renameBranch': {
        const oldName = bodyString(body, 'oldName')
        const newName = bodyString(body, 'newName')
        state.branches = state.branches.map((branch) => (branch === oldName ? newName : branch))
        renameRef(state, oldName, newName)
        if (state.status.current === oldName) {
          state.status.current = newName
        }
        options.notifyRepoChanged('refs')
        return ok
      }
      case 'createTag':
        state.tags = withValue(state.tags, bodyString(body, 'name'))
        addRef(
          state,
          findRefCommitIndex(state, bodyString(body, 'ref') || undefined),
          `tag: ${bodyString(body, 'name')}`
        )
        options.notifyRepoChanged('refs')
        return ok
      case 'deleteTag':
        state.tags = without(state.tags, bodyString(body, 'name'))
        deleteRef(state, bodyString(body, 'name'))
        options.notifyRepoChanged('refs')
        return ok
      case 'stashDrop': {
        const expectedOid = bodyString(body, 'expectedOid')
        state.stashes = reindexStashes(state.stashes.filter((stash) => stash.oid !== expectedOid))
        return ok
      }
      case 'stashPush': {
        const requestedFiles = bodyStrings(body, 'files')
        const files =
          requestedFiles.length > 0 ? requestedFiles : state.status.files.map((file) => file.path)
        const stashedFiles = captureFiles(state, files)
        removeFiles(state, files)
        state.stashes = reindexStashes([
          {
            index: 0,
            ref: 'stash@{0}',
            oid: nextObjectId(state),
            message: bodyString(body, 'message') || 'WIP on main',
            branch: state.status.current,
            files: stashedFiles
          },
          ...state.stashes
        ])
        options.notifyRepoChanged('workingTree')
        return ok
      }
      case 'stashPop': {
        const expectedOid = bodyString(body, 'expectedOid')
        const stash = state.stashes.find((entry) => entry.oid === expectedOid)
        if (stash) {
          restoreFiles(state, stash.files)
          state.stashes = reindexStashes(state.stashes.filter((entry) => entry.oid !== expectedOid))
        }
        options.notifyRepoChanged('workingTree')
        return ok
      }
      case 'stashApply': {
        const stash = state.stashes.find((entry) => entry.oid === bodyString(body, 'expectedOid'))
        if (stash) {
          restoreFiles(state, stash.files)
        }
        options.notifyRepoChanged('workingTree')
        return ok
      }
      case 'fetch':
      case 'push':
      case 'pull':
      case 'mergeBranch':
      case 'revertCommit':
      case 'cherryPick':
      case 'reset':
        options.notifyRepoChanged('refs')
        return ok
      default:
        return { _tag: 'GitError', message: `Unsupported manual RPC: ${operation}` }
    }
  }
}
