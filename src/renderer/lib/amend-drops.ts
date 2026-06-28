// The pending drop selection for an amend, keyed by file. A file absent from the map is fully kept;
// 'all' drops the whole file; a Set drops just those hunk headers. Nothing mutates the repo until the
// amend lands — this is the renderer's source of truth, so it owns the file⇄hunk consistency itself.
export type FileDrops = ReadonlyMap<string, 'all' | ReadonlySet<string>>

export type HeadDropState = 'kept' | 'partial' | 'dropped'

export function dropStateOf(drops: FileDrops, file: string): HeadDropState {
  const entry = drops.get(file)
  if (entry === undefined) {
    return 'kept'
  }
  return entry === 'all' ? 'dropped' : 'partial'
}

export function hunkDropped(drops: FileDrops, file: string, hunkHeader: string): boolean {
  const entry = drops.get(file)
  if (entry === undefined) {
    return false
  }
  return entry === 'all' || entry.has(hunkHeader)
}

export function toggleFileDrop(drops: FileDrops, file: string): FileDrops {
  const next = new Map(drops)
  if (next.has(file)) {
    next.delete(file)
  } else {
    next.set(file, 'all')
  }
  return next
}

// Toggling a hunk needs the file's full hunk list so it can normalize: dropping the last kept hunk
// collapses to a whole-file drop, un-dropping the last one clears the file, and toggling a hunk of an
// already-whole-dropped file expands it back into the explicit per-hunk set.
export function toggleHunkDrop(
  drops: FileDrops,
  file: string,
  hunkHeader: string,
  allHeaders: readonly string[]
): FileDrops {
  const entry = drops.get(file)
  const current = new Set<string>(entry === 'all' ? allHeaders : (entry ?? []))
  if (current.has(hunkHeader)) {
    current.delete(hunkHeader)
  } else {
    current.add(hunkHeader)
  }
  const next = new Map(drops)
  if (current.size === 0) {
    next.delete(file)
  } else if (current.size === allHeaders.length) {
    next.set(file, 'all')
  } else {
    next.set(file, current)
  }
  return next
}

export function assembleDrops(drops: FileDrops): {
  droppedHeadPaths: string[]
  droppedHeadHunks: { file: string; hunks: string[] }[]
} {
  const droppedHeadPaths: string[] = []
  const droppedHeadHunks: { file: string; hunks: string[] }[] = []
  for (const [file, entry] of drops) {
    if (entry === 'all') {
      droppedHeadPaths.push(file)
    } else if (entry.size > 0) {
      droppedHeadHunks.push({ file, hunks: [...entry] })
    }
  }
  return { droppedHeadPaths, droppedHeadHunks }
}
