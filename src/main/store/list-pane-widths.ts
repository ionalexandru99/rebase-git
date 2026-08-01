import { clampListPaneWidth, LIST_PANE_DEFAULT_WIDTH } from '@shared/list-layout'

export type ListPaneWidths = Record<string, number>

function isUsableWidth(width: unknown): width is number {
  return typeof width === 'number' && Number.isFinite(width)
}

export function readListPaneWidth(widths: ListPaneWidths, repoPath: string): number {
  const persisted = widths[repoPath]
  if (!isUsableWidth(persisted)) {
    return LIST_PANE_DEFAULT_WIDTH
  }
  return clampListPaneWidth(persisted)
}

export function writeListPaneWidth(
  widths: ListPaneWidths,
  repoPath: string,
  width: number
): ListPaneWidths {
  const next: ListPaneWidths = {}
  for (const [path, persisted] of Object.entries(widths)) {
    if (isUsableWidth(persisted)) {
      next[path] = clampListPaneWidth(persisted)
    }
  }
  next[repoPath] = clampListPaneWidth(width)
  return next
}
