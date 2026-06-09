import type { DiffHunk, DiffLine, FileDiff } from '@shared/schemas/git'

export interface ParsedHunk extends DiffHunk {
  raw: string
}

export interface ParsedFileDiff {
  rawHeader: string
  binary: boolean
  hunks: ParsedHunk[]
}

const HUNK_HEADER_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/

export function parseUnifiedDiff(raw: string): ParsedFileDiff {
  const lines = raw.split('\n')
  if (lines.at(-1) === '') {
    lines.pop()
  }
  const headerLines: string[] = []
  const hunks: ParsedHunk[] = []
  let binary = false
  let current: ParsedHunk | null = null
  let currentRaw: string[] = []
  let oldLine = 0
  let newLine = 0

  const flush = () => {
    if (current) {
      current.raw = `${currentRaw.join('\n')}\n`
      hunks.push(current)
      current = null
      currentRaw = []
    }
  }

  for (const line of lines) {
    const headerMatch = line.match(HUNK_HEADER_RE)
    if (headerMatch) {
      flush()
      const oldStart = Number(headerMatch[1])
      const oldCount = headerMatch[2] === undefined ? 1 : Number(headerMatch[2])
      const newStart = Number(headerMatch[3])
      const newCount = headerMatch[4] === undefined ? 1 : Number(headerMatch[4])
      current = { header: line, oldStart, oldCount, newStart, newCount, lines: [], raw: '' }
      currentRaw = [line]
      oldLine = oldStart
      newLine = newStart
      continue
    }

    if (!current) {
      if (line === '') {
        continue
      }
      if (line.startsWith('Binary files ') || line.startsWith('GIT binary patch')) {
        binary = true
      }
      headerLines.push(line)
      continue
    }

    const marker = line[0]
    if (line === '' || marker === ' ' || marker === '+' || marker === '-' || marker === '\\') {
      currentRaw.push(line)
      current.lines.push(toDiffLine(line))
      continue
    }
    flush()
    headerLines.push(line)
  }
  flush()

  function toDiffLine(line: string): DiffLine {
    const text = line.slice(1)
    switch (line[0]) {
      case '+':
        return { kind: 'add', text, oldLine: null, newLine: newLine++ }
      case '-':
        return { kind: 'del', text, oldLine: oldLine++, newLine: null }
      case '\\':
        return { kind: 'meta', text: line, oldLine: null, newLine: null }
      default:
        return { kind: 'context', text, oldLine: oldLine++, newLine: newLine++ }
    }
  }

  return {
    rawHeader: headerLines.length > 0 ? `${headerLines.join('\n')}\n` : '',
    binary,
    hunks
  }
}

export function buildHunkPatch(parsed: ParsedFileDiff, hunkHeader: string): string | null {
  if (!parsed.rawHeader) {
    return null
  }
  const hunk = parsed.hunks.find((candidate) => candidate.header === hunkHeader)
  if (!hunk) {
    return null
  }
  return parsed.rawHeader + hunk.raw
}

export function toFileDiff(filePath: string, parsed: ParsedFileDiff): FileDiff {
  return {
    filePath,
    binary: parsed.binary,
    hunks: parsed.hunks.map(({ raw: _, ...hunk }) => hunk)
  }
}
