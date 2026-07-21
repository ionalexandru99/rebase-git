import {
  AmendCommit,
  DiscardChanges,
  GetDiff,
  GetHeadCommit,
  GetStatus,
  MergeBranch,
  ScanForRepos,
  StageFile,
  StageHunk,
  StashApply,
  StashDrop,
  StashPop,
  StashPush,
  UnstageFile
} from '@shared/rpc'
import { Either, Schema } from 'effect'
import { describe, expect, it } from 'vitest'

const decode = <A, I>(schema: Schema.Schema<A, I>, value: unknown) =>
  Schema.decodeUnknownEither(schema)(value)

describe('RPC payload schemas', () => {
  it('accepts a non-empty getStatus repoPath and rejects malformed values', () => {
    const schema = GetStatus.payloadSchema
    expect(Either.isRight(decode(schema, { repoPath: '/repo' }))).toBe(true)
    expect(Either.isLeft(decode(schema, {}))).toBe(true)
    expect(Either.isLeft(decode(schema, { repoPath: '' }))).toBe(true)
    expect(Either.isLeft(decode(schema, { repoPath: 5 }))).toBe(true)
  })

  it('keeps repository paths verbatim', () => {
    const decoded = decode(GetStatus.payloadSchema, { repoPath: ' /repo ' })
    expect(Either.getOrUndefined(decoded)).toEqual({ repoPath: ' /repo ' })
  })

  it('keeps scanned directory and repository paths verbatim', () => {
    const payload = decode(ScanForRepos.payloadSchema, { dirPath: ' /workspaces ' })
    expect(Either.getOrUndefined(payload)).toEqual({ dirPath: ' /workspaces ' })

    const result = decode(ScanForRepos.successSchema, { repos: [' /repo-one ', '\t/repo-two'] })
    expect(Either.getOrUndefined(result)).toEqual({ repos: [' /repo-one ', '\t/repo-two'] })
  })

  it('reject an empty getDiff file field', () => {
    const schema = GetDiff.payloadSchema
    expect(Either.isRight(decode(schema, { repoPath: '/repo', file: 'a.txt' }))).toBe(true)
    expect(Either.isLeft(decode(schema, { repoPath: '/repo', file: '' }))).toBe(true)
    expect(Either.isLeft(decode(schema, { repoPath: '/repo' }))).toBe(true)
  })

  it('accepts an optional getDiff range but rejects an empty one', () => {
    const schema = GetDiff.payloadSchema
    expect(
      Either.isRight(decode(schema, { repoPath: '/repo', file: 'a.txt', range: 'HEAD~1..HEAD' }))
    ).toBe(true)
    expect(Either.isLeft(decode(schema, { repoPath: '/repo', file: 'a.txt', range: '' }))).toBe(
      true
    )
  })

  it('keeps a stageFile file name verbatim — edge whitespace is part of the path', () => {
    const decoded = decode(StageFile.payloadSchema, { repoPath: '/repo', file: ' padded.txt ' })
    expect(Either.getOrUndefined(decoded)).toEqual({ repoPath: '/repo', file: ' padded.txt ' })
    expect(Either.isLeft(decode(StageFile.payloadSchema, { repoPath: '/repo', file: '' }))).toBe(
      true
    )
  })

  it('accepts an optional rename source for unstageFile', () => {
    const payload = {
      repoPath: '/repo',
      file: 'new.ts',
      renameSource: 'old.ts'
    }
    expect(Either.getOrUndefined(decode(UnstageFile.payloadSchema, payload))).toEqual(payload)
    expect(
      Either.isLeft(
        decode(UnstageFile.payloadSchema, { repoPath: '/repo', file: 'new.ts', renameSource: '' })
      )
    ).toBe(true)
  })

  it('keeps structured rename identity in the HEAD commit response', () => {
    const result = {
      result: {
        sha: 'abc123',
        message: 'rename',
        files: [
          { status: 'R100', path: 'new *.ts', renameSource: 'old [source].ts' },
          { status: 'M', path: 'modified.ts' }
        ],
        parentCount: 1
      }
    }

    expect(Either.getOrUndefined(decode(GetHeadCommit.successSchema, result))).toEqual(result)
  })

  it('keeps a getDiff file name verbatim', () => {
    const decoded = decode(GetDiff.payloadSchema, { repoPath: '/repo', file: '\tindent.txt' })
    expect(Either.getOrUndefined(decoded)).toEqual({ repoPath: '/repo', file: '\tindent.txt' })
  })

  it('keeps hunk headers verbatim', () => {
    const hunkHeader = '@@ -1 +1 @@ function context  '
    const decoded = decode(StageHunk.payloadSchema, {
      repoPath: '/repo',
      file: 'file.txt',
      hunkHeader
    })
    expect(Either.getOrUndefined(decoded)).toEqual({
      repoPath: '/repo',
      file: 'file.txt',
      hunkHeader
    })
    expect(
      Either.isLeft(decode(StageHunk.payloadSchema, { repoPath: '/repo', file: 'file.txt' }))
    ).toBe(true)
    expect(
      Either.isLeft(
        decode(StageHunk.payloadSchema, {
          repoPath: '/repo',
          file: 'file.txt',
          hunkHeader: ''
        })
      )
    ).toBe(true)
    expect(
      Either.isLeft(
        decode(StageHunk.payloadSchema, {
          repoPath: '/repo',
          file: 'file.txt',
          hunkHeader: '   '
        })
      )
    ).toBe(true)
  })

  it('keeps discardChanges and stashPush file lists verbatim and rejects empty entries', () => {
    const files = [' padded.txt ', '-u', '*.txt']
    const discarded = decode(DiscardChanges.payloadSchema, { repoPath: '/repo', files })
    expect(Either.getOrUndefined(discarded)).toEqual({ repoPath: '/repo', files })
    const stashed = decode(StashPush.payloadSchema, { repoPath: '/repo', files })
    expect(Either.getOrUndefined(stashed)).toEqual({ repoPath: '/repo', files })
    expect(
      Either.isLeft(decode(DiscardChanges.payloadSchema, { repoPath: '/repo', files: [''] }))
    ).toBe(true)
  })

  it('keeps amendCommit dropped paths and dropped-hunk files verbatim', () => {
    const payload = {
      repoPath: '/repo',
      message: 'subject',
      expectedHead: 'abc123',
      droppedHeadPaths: [' padded.txt '],
      droppedHeadHunks: [{ file: '*.txt ', hunks: ['@@ -1 +1 @@  '] }]
    }
    const decoded = decode(AmendCommit.payloadSchema, payload)
    expect(Either.getOrUndefined(decoded)).toEqual(payload)
    expect(
      Either.isLeft(
        decode(AmendCommit.payloadSchema, {
          repoPath: '/repo',
          message: 'subject',
          droppedHeadPaths: [],
          droppedHeadHunks: []
        })
      )
    ).toBe(true)
  })

  it('keeps the expected HEAD on amend requests', () => {
    const payload = {
      repoPath: '/repo',
      message: 'subject',
      expectedHead: 'abc123',
      droppedHeadPaths: [],
      droppedHeadHunks: []
    }
    const decoded = decode(AmendCommit.payloadSchema, payload)
    expect(Either.getOrUndefined(decoded)).toEqual(payload)
  })

  it('keeps the expected stash OID on stash mutations', () => {
    const payload = { repoPath: '/repo', index: 2, expectedOid: 'abc123' }
    for (const schema of [
      StashApply.payloadSchema,
      StashPop.payloadSchema,
      StashDrop.payloadSchema
    ]) {
      expect(Either.getOrUndefined(decode(schema, payload))).toEqual(payload)
      expect(Either.isLeft(decode(schema, { repoPath: '/repo', index: 2 }))).toBe(true)
    }
  })

  it('requires merge ref identity and keeps the selected full path', () => {
    const payload = { repoPath: '/repo', refKind: 'remote' as const, fullPath: 'origin/feature' }

    expect(Either.getOrUndefined(decode(MergeBranch.payloadSchema, payload))).toEqual(payload)
    expect(
      Either.isLeft(decode(MergeBranch.payloadSchema, { repoPath: '/repo', fullPath: 'feature' }))
    ).toBe(true)
  })
})
