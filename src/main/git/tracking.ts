export interface BranchTracking {
  ahead: number
  behind: number
}

export function parseAheadBehind(rawOutput: string): Record<string, BranchTracking> {
  const result: Record<string, BranchTracking> = {}
  for (const line of rawOutput.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const pipeIdx = trimmed.indexOf('|')
    if (pipeIdx === -1) continue
    const name = trimmed.slice(0, pipeIdx)
    const trackStr = trimmed.slice(pipeIdx + 1)
    if (!name || !trackStr || trackStr.includes('[gone]')) continue
    const aheadMatch = trackStr.match(/ahead (\d+)/)
    const behindMatch = trackStr.match(/behind (\d+)/)
    const ahead = aheadMatch ? Number.parseInt(aheadMatch[1], 10) : 0
    const behind = behindMatch ? Number.parseInt(behindMatch[1], 10) : 0
    if (ahead > 0 || behind > 0) {
      result[name] = { ahead, behind }
    }
  }
  return result
}
