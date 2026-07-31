import { DIFFS_TAG_NAME } from '@pierre/diffs'
import { fingerprintHunk } from '@shared/hunk-fingerprint'
import type { HunkLineSelection } from '@shared/rpc'
import type { ParsedHunk } from '@shared/unified-diff'

export interface SelectedChangeLine {
  kind: 'add' | 'del'
  lineNumber: number
  unifiedIndex: number
}

export function sweepSelectedChangeLines(root: ParentNode): SelectedChangeLine[] {
  const lines: SelectedChangeLine[] = []
  const seen = new Set<string>()
  for (const host of root.querySelectorAll(DIFFS_TAG_NAME)) {
    const scopes: ParentNode[] = host.shadowRoot ? [host.shadowRoot, host] : [host]
    for (const row of scopes.flatMap((scope) =>
      Array.from(scope.querySelectorAll<HTMLElement>('[data-selected-line][data-line]'))
    )) {
      const lineType = row.dataset.lineType
      if (lineType !== 'change-addition' && lineType !== 'change-deletion') {
        continue
      }
      const lineNumber = Number(row.dataset.line)
      const unifiedIndex = Number(row.dataset.lineIndex?.split(',')[0])
      if (!Number.isInteger(lineNumber) || !Number.isInteger(unifiedIndex)) {
        continue
      }
      const kind = lineType === 'change-addition' ? 'add' : 'del'
      const key = `${kind}:${lineNumber}`
      if (seen.has(key)) {
        continue
      }
      seen.add(key)
      lines.push({ kind, lineNumber, unifiedIndex })
    }
  }
  return lines.sort((first, second) => first.unifiedIndex - second.unifiedIndex)
}

export function mapSelectionToHunkSelections(
  hunks: readonly ParsedHunk[],
  patch: string,
  lines: readonly SelectedChangeLine[]
): HunkLineSelection[] {
  const selectedKeys = new Set(lines.map((line) => `${line.kind}:${line.lineNumber}`))
  const selections: HunkLineSelection[] = []
  for (const hunk of hunks) {
    const lineIndexes: number[] = []
    hunk.lines.forEach((line, index) => {
      const lineNumber = line.kind === 'add' ? line.newLine : line.oldLine
      if (
        (line.kind === 'add' || line.kind === 'del') &&
        selectedKeys.has(`${line.kind}:${lineNumber}`)
      ) {
        lineIndexes.push(index)
      }
    })
    if (lineIndexes.length === 0) {
      continue
    }
    const fingerprint = fingerprintHunk(patch, hunk.header)
    if (fingerprint === null) {
      continue
    }
    selections.push({ hunkHeader: hunk.header, lineIndexes, fingerprint })
  }
  return selections
}
