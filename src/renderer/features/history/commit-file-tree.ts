import type { CommitDetailFile } from '@shared/schemas/git'

export interface CommitTreeDirectoryRow {
  kind: 'directory'
  /** Full path of the deepest directory in a collapsed chain — stable across rebuilds. */
  key: string
  label: string
  depth: number
  fileCount: number
  collapsed: boolean
}

export interface CommitTreeFileRow {
  kind: 'file'
  key: string
  label: string
  depth: number
  file: CommitDetailFile
}

export type CommitTreeRow = CommitTreeDirectoryRow | CommitTreeFileRow

interface DirectoryNode {
  name: string
  path: string
  directories: Map<string, DirectoryNode>
  files: CommitDetailFile[]
  fileCount: number
}

const makeDirectory = (name: string, path: string): DirectoryNode => ({
  name,
  path,
  directories: new Map(),
  files: [],
  fileCount: 0
})

const byName = <T extends { name: string }>(left: T, right: T): number =>
  left.name.localeCompare(right.name)

const basename = (path: string): string => path.slice(path.lastIndexOf('/') + 1)
const dirname = (path: string): string => {
  const cut = path.lastIndexOf('/')
  return cut === -1 ? '' : path.slice(0, cut)
}

function fileLabel(file: CommitDetailFile): string {
  const name = basename(file.path)
  if (file.oldPath === undefined) {
    return name
  }
  // A rename inside one directory only needs the two names; one that moved needs the old path to
  // say where the file came from.
  const oldLabel =
    dirname(file.oldPath) === dirname(file.path) ? basename(file.oldPath) : file.oldPath
  return `${oldLabel} → ${name}`
}

function buildTree(files: readonly CommitDetailFile[]): DirectoryNode {
  const root = makeDirectory('', '')
  for (const file of files) {
    const segments = file.path.split('/')
    let node = root
    for (const segment of segments.slice(0, -1)) {
      node.fileCount += 1
      const path = node.path === '' ? segment : `${node.path}/${segment}`
      const child = node.directories.get(segment) ?? makeDirectory(segment, path)
      node.directories.set(segment, child)
      node = child
    }
    node.fileCount += 1
    node.files.push(file)
  }
  return root
}

// A directory with no files and exactly one subdirectory adds a row that says nothing on its own, so
// the chain reads as one row — `src/features/history` rather than three nested rows.
function collapseChain(node: DirectoryNode): { label: string; node: DirectoryNode } {
  let label = node.name
  let current = node
  while (current.files.length === 0 && current.directories.size === 1) {
    const [only] = current.directories.values()
    label = `${label}/${only.name}`
    current = only
  }
  return { label, node: current }
}

function appendRows(
  node: DirectoryNode,
  depth: number,
  collapsedDirs: ReadonlySet<string>,
  rows: CommitTreeRow[]
): void {
  for (const child of [...node.directories.values()].sort(byName)) {
    const chain = collapseChain(child)
    const collapsed = collapsedDirs.has(chain.node.path)
    rows.push({
      kind: 'directory',
      key: chain.node.path,
      label: chain.label,
      depth,
      fileCount: child.fileCount,
      collapsed
    })
    if (!collapsed) {
      appendRows(chain.node, depth + 1, collapsedDirs, rows)
    }
  }
  for (const file of [...node.files].sort((left, right) => left.path.localeCompare(right.path))) {
    rows.push({
      kind: 'file',
      key: file.path,
      label: fileLabel(file),
      depth,
      file
    })
  }
}

export function buildCommitFileTreeRows(
  files: readonly CommitDetailFile[],
  collapsedDirs: ReadonlySet<string>
): CommitTreeRow[] {
  const rows: CommitTreeRow[] = []
  appendRows(buildTree(files), 0, collapsedDirs, rows)
  return rows
}

/** The file the panel opens on: whichever one reads first with everything expanded. */
export function firstCommitTreeFile(
  files: readonly CommitDetailFile[]
): CommitDetailFile | undefined {
  for (const row of buildCommitFileTreeRows(files, new Set())) {
    if (row.kind === 'file') {
      return row.file
    }
  }
  return undefined
}
