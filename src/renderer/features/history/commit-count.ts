export interface CommitCountSummary {
  loadedCount: number
  visibleTotal?: number
  visibleBranchCount?: number
  hasMore?: boolean
}

export function commitCountLabel(summary: CommitCountSummary): string {
  const visible = summary.visibleTotal ?? summary.loadedCount
  if (!visible && summary.loadedCount === 0) {
    return 'Repository timeline'
  }
  const commitLabel = `${visible.toLocaleString()} commit${visible === 1 ? '' : 's'}`
  const visibleBranchCount = summary.visibleBranchCount ?? 0
  const branchLabel =
    visibleBranchCount === 0
      ? ' · no branches visible'
      : ` · ${visibleBranchCount} branch${visibleBranchCount === 1 ? '' : 'es'} visible`
  if (summary.hasMore) {
    return `${commitLabel}${branchLabel} · ${summary.loadedCount.toLocaleString()} loaded · more available`
  }
  return `${commitLabel}${branchLabel}`
}
