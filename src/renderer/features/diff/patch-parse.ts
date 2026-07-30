import { type FileDiffMetadata, parsePatchFiles } from '@pierre/diffs'

const THROW_ON_ERROR = true

export type ParsedPatchResult =
  | { kind: 'parsed'; files: FileDiffMetadata[]; patchMetadata?: string }
  | { kind: 'raw'; patch: string }

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
