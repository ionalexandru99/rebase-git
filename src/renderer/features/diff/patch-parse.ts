import { type FileDiffMetadata, parsePatchFiles } from '@pierre/diffs'

// The parser can only fail loudly if we ask it to: in its default mode a combined `@@@` diff comes
// back as a plausible-looking rename with no hunks instead of an error.
const THROW_ON_ERROR = true

export type ParsedPatchResult =
  | { kind: 'parsed'; files: FileDiffMetadata[]; patchMetadata?: string }
  | { kind: 'raw'; patch: string }

/**
 * Parse raw `git diff` text. Anything the parser rejects falls back to the raw text so a diff we
 * can't structure still has something to show.
 */
export function parsePatch(patch: string, cacheKey: string): ParsedPatchResult {
  try {
    const parsed = parsePatchFiles(patch, cacheKey, THROW_ON_ERROR)
    const files = parsed.flatMap((entry) => entry.files).map(compactPartialHunkOffsets)
    const patchMetadata = parsed.find((entry) => entry.patchMetadata)?.patchMetadata
    return patchMetadata === undefined
      ? { kind: 'parsed', files }
      : { kind: 'parsed', files, patchMetadata }
  } catch {
    return { kind: 'raw', patch }
  }
}

/**
 * Rebase hunk offsets onto the rows we actually render.
 *
 * For a patch-sourced diff the parser reports `splitLineStart`/`unifiedLineStart` and the file
 * totals in source-file coordinates, counting the collapsed context between hunks that only a
 * whole-file diff could render. We render hunks back to back, so a virtualizer trusting those
 * numbers would reserve scroll space for lines that never appear.
 */
export function compactPartialHunkOffsets(file: FileDiffMetadata): FileDiffMetadata {
  if (!file.isPartial) {
    return file
  }
  let splitLineStart = 0
  let unifiedLineStart = 0
  const hunks = file.hunks.map((hunk) => {
    const compacted = { ...hunk, splitLineStart, unifiedLineStart }
    splitLineStart += hunk.splitLineCount
    unifiedLineStart += hunk.unifiedLineCount
    return compacted
  })
  return { ...file, hunks, splitLineCount: splitLineStart, unifiedLineCount: unifiedLineStart }
}
