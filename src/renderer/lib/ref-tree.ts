import { REF_TREE_REMOTE_SECTION_KEY, REF_TREE_TAG_SECTION_KEY } from '@shared/ref-tree-toggles'

export type RefKind = 'local' | 'remote' | 'tag' | 'stash'

export interface StashRowData {
  index: number
  ref: string
  message: string
  branch: string
}

export interface BranchTracking {
  ahead: number
  behind: number
}

export interface RefLeafRow {
  kind: 'leaf'
  refKind: RefKind
  fullPath: string
  name: string
  depth: number
  isCurrent: boolean
  ahead?: number
  behind?: number
}

export interface RefFolderRow {
  kind: 'folder'
  refKind: RefKind
  fullPath: string
  name: string
  depth: number
  expanded: boolean
  childCount: number
}

export interface RefStashRow {
  kind: 'stash'
  refKind: 'stash'
  index: number
  ref: string
  message: string
  branch: string
}

export interface RefSectionRow {
  kind: 'section'
  refKind: RefKind
  label: string
  count: number
  expanded: boolean
}

export interface RefEmptyRow {
  kind: 'empty'
  refKind: RefKind
  label: string
}

export interface RefSkeletonRow {
  kind: 'skeleton'
  refKind: RefKind
  idx: number
}

export type RefRow =
  | RefLeafRow
  | RefFolderRow
  | RefStashRow
  | RefSectionRow
  | RefEmptyRow
  | RefSkeletonRow

export const REF_TREE_ROW_HEIGHT = 30

import { REF_TREE_OVERSCAN as REF_TREE_OVERSCAN_VALUE } from '@/lib/virtual-config'

export const REF_TREE_OVERSCAN = REF_TREE_OVERSCAN_VALUE
export const REF_TREE_INDENT_PX = 12

export function sectionKey(refKind: RefKind): string {
  if (refKind === 'local') {
    return 'section:local'
  }
  if (refKind === 'remote') {
    return REF_TREE_REMOTE_SECTION_KEY
  }
  if (refKind === 'stash') {
    return 'section:stash'
  }
  return REF_TREE_TAG_SECTION_KEY
}

export function folderKey(refKind: RefKind, fullPath: string): string {
  return `folder:${refKind}:${fullPath}`
}

function isSectionExpanded(toggles: Set<string>, refKind: RefKind): boolean {
  const hasToggle = toggles.has(sectionKey(refKind))
  return refKind === 'local' || refKind === 'stash' ? !hasToggle : hasToggle
}

function isFolderExpanded(toggles: Set<string>, refKind: RefKind, fullPath: string): boolean {
  return toggles.has(folderKey(refKind, fullPath))
}

export function rowKey(row: RefRow): string {
  if (row.kind === 'section') {
    return `s:${row.refKind}`
  }
  if (row.kind === 'empty') {
    return `e:${row.refKind}`
  }
  if (row.kind === 'skeleton') {
    return `sk:${row.refKind}:${row.idx}`
  }
  if (row.kind === 'stash') {
    return `stash:${row.ref}`
  }
  return `${row.refKind}:${row.kind}:${row.fullPath}`
}

interface BuildRowsOptions {
  localBranches: string[]
  remoteBranches: string[]
  tags: string[]
  toggles: Set<string>
  currentBranch: string
  localLoading: boolean
  tracking?: Record<string, BranchTracking>
  stashes?: StashRowData[]
}

export function buildRefTreeRows({
  localBranches,
  remoteBranches,
  tags,
  toggles,
  currentBranch,
  localLoading,
  tracking,
  stashes
}: BuildRowsOptions): RefRow[] {
  const out: RefRow[] = []
  const noLocalData = localBranches.length === 0
  if (localLoading && noLocalData) {
    pushSkeletonSection(out, 'local', 'Local branches', toggles, 4)
  } else {
    buildSection(out, 'local', 'Local branches', localBranches, toggles, currentBranch, tracking)
  }
  buildSection(out, 'remote', 'Remote branches', remoteBranches, toggles, currentBranch)
  buildSection(out, 'tag', 'Tags', tags, toggles, currentBranch)
  buildStashSection(out, stashes ?? [], toggles)
  return out
}

function buildStashSection(out: RefRow[], stashes: StashRowData[], toggles: Set<string>): void {
  if (stashes.length === 0) {
    return
  }
  const expanded = isSectionExpanded(toggles, 'stash')
  out.push({ kind: 'section', refKind: 'stash', label: 'Stashes', count: stashes.length, expanded })
  if (!expanded) {
    return
  }
  for (const stash of stashes) {
    out.push({
      kind: 'stash',
      refKind: 'stash',
      index: stash.index,
      ref: stash.ref,
      message: stash.message,
      branch: stash.branch
    })
  }
}

function pushSkeletonSection(
  out: RefRow[],
  refKind: RefKind,
  label: string,
  toggles: Set<string>,
  count: number
): void {
  const expanded = isSectionExpanded(toggles, refKind)
  out.push({ kind: 'section', refKind, label, count: 0, expanded })
  if (!expanded) {
    return
  }
  for (let i = 0; i < count; i++) {
    out.push({ kind: 'skeleton', refKind, idx: i })
  }
}

type TreeMap = Map<string, TreeMap | string>

function buildSection(
  out: RefRow[],
  refKind: RefKind,
  label: string,
  paths: string[],
  toggles: Set<string>,
  currentBranch: string,
  tracking?: Record<string, BranchTracking>
): void {
  const sectionExpanded = isSectionExpanded(toggles, refKind)
  out.push({
    kind: 'section',
    refKind,
    label,
    count: paths.length,
    expanded: sectionExpanded
  })
  if (!sectionExpanded) {
    return
  }
  if (paths.length === 0) {
    out.push({
      kind: 'empty',
      refKind,
      label: refKind === 'tag' ? 'No tags' : `No ${refKind} branches`
    })
    return
  }

  const root: TreeMap = new Map()
  for (const path of paths) {
    const parts = path.split('/').filter(Boolean)
    if (parts.length === 0) {
      continue
    }
    let cursor = root
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      const isLeaf = i === parts.length - 1
      if (isLeaf) {
        cursor.set(part, path)
      } else {
        const next = cursor.get(part)
        if (next instanceof Map) {
          cursor = next
        } else {
          const fresh = new Map<string, TreeMap | string>()
          cursor.set(part, fresh)
          cursor = fresh
        }
      }
    }
  }

  walkTree(out, root, refKind, 1, '', toggles, currentBranch, tracking)
}

function walkTree(
  out: RefRow[],
  node: TreeMap,
  refKind: RefKind,
  depth: number,
  parentPath: string,
  toggles: Set<string>,
  currentBranch: string,
  tracking?: Record<string, BranchTracking>
): void {
  const entries = [...node.entries()].sort((a, b) => {
    const aIsFolder = a[1] instanceof Map
    const bIsFolder = b[1] instanceof Map
    if (aIsFolder !== bIsFolder) {
      return aIsFolder ? -1 : 1
    }
    return a[0].localeCompare(b[0])
  })

  for (const [name, value] of entries) {
    const fullPath = parentPath ? `${parentPath}/${name}` : name
    if (value instanceof Map) {
      const expanded = isFolderExpanded(toggles, refKind, fullPath)
      out.push({
        kind: 'folder',
        refKind,
        fullPath,
        name,
        depth,
        expanded,
        childCount: value.size
      })
      if (expanded) {
        walkTree(out, value, refKind, depth + 1, fullPath, toggles, currentBranch, tracking)
      }
    } else {
      const trackingEntry = refKind === 'local' ? tracking?.[value] : undefined
      out.push({
        kind: 'leaf',
        refKind,
        fullPath: value,
        name,
        depth,
        isCurrent: refKind === 'local' && value === currentBranch,
        ahead: trackingEntry?.ahead,
        behind: trackingEntry?.behind
      })
    }
  }
}
