import { fingerprintHunk } from '@shared/hunk-fingerprint'
import { describe, expect, it } from 'vitest'
import { buildHunkPatch, buildSelectedLinesPatch, parseUnifiedDiff, toFileDiff } from '../diff'

const MODIFIED_DIFF = `diff --git a/src/app.ts b/src/app.ts
index 1111111..2222222 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,4 +1,5 @@ import header
 import { a } from './a'
+import { b } from './b'

-export function run() {
+export function run(config: Config) {
   return a()
@@ -20,3 +21,4 @@ function tail() {
   return 1
 }
+export const VERSION = '1.0'
`

const NEW_FILE_DIFF = `diff --git a/notes.md b/notes.md
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/notes.md
@@ -0,0 +1,2 @@
+hello
+world
\\ No newline at end of file
`

const BINARY_DIFF = `diff --git a/logo.png b/logo.png
index 4444444..5555555 100644
Binary files a/logo.png and b/logo.png differ
`

describe('parseUnifiedDiff', () => {
  it('splits header and hunks with parsed ranges', () => {
    const parsed = parseUnifiedDiff(MODIFIED_DIFF)

    expect(parsed.binary).toBe(false)
    expect(parsed.rawHeader).toBe(
      'diff --git a/src/app.ts b/src/app.ts\nindex 1111111..2222222 100644\n--- a/src/app.ts\n+++ b/src/app.ts\n'
    )
    expect(parsed.hunks).toHaveLength(2)
    expect(parsed.hunks[0]).toMatchObject({
      header: '@@ -1,4 +1,5 @@ import header',
      oldStart: 1,
      oldCount: 4,
      newStart: 1,
      newCount: 5
    })
    expect(parsed.hunks[1]).toMatchObject({ oldStart: 20, oldCount: 3, newStart: 21, newCount: 4 })
  })

  it('classifies lines and assigns line numbers', () => {
    const parsed = parseUnifiedDiff(MODIFIED_DIFF)
    const lines = parsed.hunks[0].lines

    expect(lines[0]).toEqual({
      kind: 'context',
      text: "import { a } from './a'",
      oldLine: 1,
      newLine: 1
    })
    expect(lines[1]).toEqual({
      kind: 'add',
      text: "import { b } from './b'",
      oldLine: null,
      newLine: 2
    })
    expect(lines[3]).toEqual({
      kind: 'del',
      text: 'export function run() {',
      oldLine: 3,
      newLine: null
    })
    expect(lines[4]).toEqual({
      kind: 'add',
      text: 'export function run(config: Config) {',
      oldLine: null,
      newLine: 4
    })
    expect(lines[5]).toEqual({ kind: 'context', text: '  return a()', oldLine: 4, newLine: 5 })
  })

  it('keeps each hunk raw text verbatim', () => {
    const parsed = parseUnifiedDiff(MODIFIED_DIFF)

    expect(parsed.hunks[1].raw).toBe(
      "@@ -20,3 +21,4 @@ function tail() {\n   return 1\n }\n+export const VERSION = '1.0'\n"
    )
  })

  it('handles new-file diffs with a no-newline marker', () => {
    const parsed = parseUnifiedDiff(NEW_FILE_DIFF)

    expect(parsed.hunks).toHaveLength(1)
    const lines = parsed.hunks[0].lines
    expect(lines[0]).toEqual({ kind: 'add', text: 'hello', oldLine: null, newLine: 1 })
    expect(lines[1]).toEqual({ kind: 'add', text: 'world', oldLine: null, newLine: 2 })
    expect(lines[2].kind).toBe('meta')
  })

  it('flags binary diffs and produces no hunks', () => {
    const parsed = parseUnifiedDiff(BINARY_DIFF)

    expect(parsed.binary).toBe(true)
    expect(parsed.hunks).toHaveLength(0)
  })

  it('returns an empty result for an empty diff', () => {
    const parsed = parseUnifiedDiff('')

    expect(parsed.rawHeader).toBe('')
    expect(parsed.binary).toBe(false)
    expect(parsed.hunks).toHaveLength(0)
  })
})

describe('buildHunkPatch', () => {
  it('reassembles header plus the selected hunk verbatim', () => {
    const parsed = parseUnifiedDiff(MODIFIED_DIFF)

    const patch = buildHunkPatch(parsed, '@@ -20,3 +21,4 @@ function tail() {')

    expect(patch).toBe(
      'diff --git a/src/app.ts b/src/app.ts\n' +
        'index 1111111..2222222 100644\n' +
        '--- a/src/app.ts\n' +
        '+++ b/src/app.ts\n' +
        '@@ -20,3 +21,4 @@ function tail() {\n' +
        '   return 1\n' +
        ' }\n' +
        "+export const VERSION = '1.0'\n"
    )
  })

  it('returns null for an unknown hunk header', () => {
    const parsed = parseUnifiedDiff(MODIFIED_DIFF)
    expect(buildHunkPatch(parsed, '@@ -99,1 +99,1 @@')).toBeNull()
  })

  it('returns null when the diff is empty', () => {
    expect(buildHunkPatch(parseUnifiedDiff(''), '@@ -1,1 +1,1 @@')).toBeNull()
  })
})

describe('toFileDiff', () => {
  it('strips raw hunk text and carries file metadata', () => {
    const parsed = parseUnifiedDiff(MODIFIED_DIFF)
    const fileDiff = toFileDiff('src/app.ts', parsed)

    expect(fileDiff.filePath).toBe('src/app.ts')
    expect(fileDiff.binary).toBe(false)
    expect(fileDiff.hunks).toHaveLength(2)
    expect('raw' in fileDiff.hunks[0]).toBe(false)
  })
})

describe('buildSelectedLinesPatch derived starts', () => {
  const DELETED_FILE_DIFF = `diff --git a/f.txt b/f.txt
deleted file mode 100644
index 1111111..0000000
--- a/f.txt
+++ /dev/null
@@ -1,3 +0,0 @@
-one
-two
-three
`

  const STAGED_NEW_FILE_DIFF = `diff --git a/f.txt b/f.txt
new file mode 100644
index 0000000..1111111
--- /dev/null
+++ b/f.txt
@@ -0,0 +1,3 @@
+one
+two
+three
`

  function selectionFor(raw: string, lineIndexes: number[]) {
    const parsed = parseUnifiedDiff(raw)
    const hunk = parsed.hunks[0]
    const fingerprint = fingerprintHunk(raw, hunk.header)
    if (fingerprint === null) {
      throw new Error('no fingerprint')
    }
    return { parsed, selections: [{ hunkHeader: hunk.header, lineIndexes, fingerprint }] }
  }

  it('starts a non-empty derived new side at 1 when partially staging a deletion', () => {
    const { parsed, selections } = selectionFor(DELETED_FILE_DIFF, [1])
    const patch = buildSelectedLinesPatch(parsed, selections, 'stage')
    expect(patch).toContain('@@ -1,3 +1,2 @@')
  })

  it('starts a non-empty derived old side at 1 when partially unstaging a staged-new file', () => {
    const { parsed, selections } = selectionFor(STAGED_NEW_FILE_DIFF, [1])
    const patch = buildSelectedLinesPatch(parsed, selections, 'unstage')
    expect(patch).toContain('@@ -1,2 +1,3 @@')
  })

  it('keeps start 0 for a side that stays empty', () => {
    const { parsed, selections } = selectionFor(STAGED_NEW_FILE_DIFF, [0, 1, 2])
    const patch = buildSelectedLinesPatch(parsed, selections, 'unstage')
    expect(patch).toContain('@@ -0,0 +1,3 @@')
  })
})
