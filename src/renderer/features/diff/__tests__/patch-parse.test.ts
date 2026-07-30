import type { FileDiffMetadata } from '@pierre/diffs'
import { describe, expect, it } from 'vitest'
import { compactPartialHunkOffsets, parsePatch } from '@/features/diff/patch-parse'
import {
  BINARY_PATCH,
  COMBINED_DIFF_PATCH,
  CONFLICT_OURS_PATCH,
  CRLF_PATCH,
  DELETE_PATCH,
  MODIFY_PATCH,
  MULTI_HUNK_PATCH,
  NO_TRAILING_NEWLINE_PATCH,
  PATCH_LOOKALIKE_CONTENT_PATCH,
  PURE_RENAME_PATCH,
  RENAME_WITH_EDIT_PATCH,
  UNTRACKED_PATCH
} from './patch-fixtures'

function parseOneFile(patch: string, cacheKey: string): FileDiffMetadata {
  const parsed = parsePatch(patch, cacheKey)
  if (parsed.kind !== 'parsed') {
    throw new Error(`expected ${cacheKey} to parse, got ${parsed.kind}`)
  }
  expect(parsed.files).toHaveLength(1)
  return parsed.files[0]
}

describe('parsePatch over real git output', () => {
  it('parses a plain modification', () => {
    const file = parseOneFile(MODIFY_PATCH, 'modify')

    expect(file).toMatchObject({ name: 'simple.txt', type: 'change', isPartial: true })
    expect(file.hunks).toHaveLength(1)
    expect(file.additionLines).toEqual(['line 1\n', 'line 2 EDITED\n', 'line 3\n'])
    expect(file.deletionLines).toEqual(['line 1\n', 'line 2\n', 'line 3\n'])
  })

  it('parses every hunk of a multi-hunk patch and records the gap between them', () => {
    const file = parseOneFile(MULTI_HUNK_PATCH, 'multi-hunk')

    expect(file.hunks).toHaveLength(2)
    expect(file.hunks[0].collapsedBefore).toBe(0)
    expect(file.hunks[1].collapsedBefore).toBe(28)
    expect(file.hunks[1].deletionStart).toBe(33)
    expect(file.hunks[1].additionStart).toBe(33)
  })

  it('reads an untracked file, diffed against /dev/null, as a new file', () => {
    const file = parseOneFile(UNTRACKED_PATCH, 'untracked')

    expect(file).toMatchObject({ name: 'untracked.txt', type: 'new' })
    expect(file.deletionLines).toEqual([])
    expect(file.additionLines).toEqual(['alpha\n', 'beta\n'])
  })

  it('reads a rename with edits, keeping the previous path', () => {
    const file = parseOneFile(RENAME_WITH_EDIT_PATCH, 'rename-changed')

    expect(file).toMatchObject({
      name: 'renamed-dst.txt',
      prevName: 'renamed-src.txt',
      type: 'rename-changed'
    })
    expect(file.hunks).toHaveLength(1)
  })

  it('reads a pure rename as a rename with no hunks', () => {
    const file = parseOneFile(PURE_RENAME_PATCH, 'rename-pure')

    expect(file).toMatchObject({
      name: 'renamed-final.txt',
      prevName: 'renamed-dst.txt',
      type: 'rename-pure'
    })
    expect(file.hunks).toEqual([])
  })

  it('reads a deletion', () => {
    const file = parseOneFile(DELETE_PATCH, 'delete')

    expect(file).toMatchObject({ name: 'deleted.txt', type: 'deleted' })
    expect(file.additionLines).toEqual([])
    expect(file.deletionLines).toEqual(['gone\n'])
  })

  it('flags a missing trailing newline on both sides', () => {
    const file = parseOneFile(NO_TRAILING_NEWLINE_PATCH, 'no-eol')

    expect(file.hunks[0].noEOFCRDeletions).toBe(true)
    expect(file.hunks[0].noEOFCRAdditions).toBe(true)
    expect(file.additionLines).toEqual(['no newline changed'])
  })

  it('keeps carriage returns in CRLF content', () => {
    const file = parseOneFile(CRLF_PATCH, 'crlf')

    expect(file.deletionLines).toEqual(['x\r\n', 'y\r\n', 'z\r\n'])
    expect(file.additionLines).toEqual(['x\r\n', 'Y\r\n', 'z\r\n'])
  })

  it('treats content that looks like patch syntax as content', () => {
    const file = parseOneFile(PATCH_LOOKALIKE_CONTENT_PATCH, 'lookalike')

    expect(file.name).toBe('tricky.txt')
    expect(file.hunks).toHaveLength(1)
    expect(file.additionLines).toEqual([
      'diff --git a/fake b/fake\n',
      '@@ fake hunk @@\n',
      'real content EDITED\n'
    ])
  })

  it('keeps the `* Unmerged path` preamble of a conflict diff as patch metadata', () => {
    const parsed = parsePatch(CONFLICT_OURS_PATCH, 'conflict-ours')
    if (parsed.kind !== 'parsed') {
      throw new Error('expected the --ours diff to parse')
    }

    expect(parsed.patchMetadata).toContain('* Unmerged path conflict.txt')
    expect(parsed.files[0].additionLines).toEqual([
      '<<<<<<< HEAD\n',
      'main\n',
      '=======\n',
      'side\n',
      '>>>>>>> side\n'
    ])
  })

  it('yields a file with no hunks for a binary patch', () => {
    const file = parseOneFile(BINARY_PATCH, 'binary')

    expect(file.name).toBe('blob.bin')
    expect(file.hunks).toEqual([])
  })

  it('falls back to raw text for a combined diff instead of mis-parsing it', () => {
    expect(parsePatch(COMBINED_DIFF_PATCH, 'combined')).toEqual({
      kind: 'raw',
      patch: COMBINED_DIFF_PATCH
    })
  })

  it('yields no files for text that is not a patch', () => {
    expect(parsePatch('not a patch at all\n', 'garbage')).toMatchObject({
      kind: 'parsed',
      files: []
    })
  })

  it('parses an empty patch to no files', () => {
    expect(parsePatch('', 'empty')).toEqual({ kind: 'parsed', files: [] })
  })
})

describe('compactPartialHunkOffsets', () => {
  it('rebases hunk starts and file totals onto the rendered rows', () => {
    const parsed = parsePatch(MULTI_HUNK_PATCH, 'multi-hunk-compact')
    if (parsed.kind !== 'parsed') {
      throw new Error('expected the multi-hunk patch to parse')
    }
    const [file] = parsed.files

    expect(file.hunks[0].splitLineStart).toBe(0)
    expect(file.hunks[0].unifiedLineStart).toBe(0)
    expect(file.hunks[1].splitLineStart).toBe(file.hunks[0].splitLineCount)
    expect(file.hunks[1].unifiedLineStart).toBe(file.hunks[0].unifiedLineCount)
    expect(file.splitLineCount).toBe(file.hunks[0].splitLineCount + file.hunks[1].splitLineCount)
    expect(file.unifiedLineCount).toBe(
      file.hunks[0].unifiedLineCount + file.hunks[1].unifiedLineCount
    )
  })

  it('leaves a whole-file diff alone, whose offsets already are the rendered rows', () => {
    const wholeFile = {
      name: 'whole.txt',
      type: 'change',
      isPartial: false,
      hunks: [
        { splitLineStart: 10, splitLineCount: 3, unifiedLineStart: 12, unifiedLineCount: 4 },
        { splitLineStart: 40, splitLineCount: 5, unifiedLineStart: 44, unifiedLineCount: 6 }
      ],
      splitLineCount: 80,
      unifiedLineCount: 90,
      additionLines: [],
      deletionLines: []
    } as unknown as FileDiffMetadata

    expect(compactPartialHunkOffsets(wholeFile)).toBe(wholeFile)
  })

  it('handles a file with no hunks', () => {
    const empty = {
      name: 'renamed.txt',
      type: 'rename-pure',
      isPartial: true,
      hunks: [],
      splitLineCount: 0,
      unifiedLineCount: 0,
      additionLines: [],
      deletionLines: []
    } as unknown as FileDiffMetadata

    expect(compactPartialHunkOffsets(empty)).toMatchObject({
      splitLineCount: 0,
      unifiedLineCount: 0,
      hunks: []
    })
  })
})
