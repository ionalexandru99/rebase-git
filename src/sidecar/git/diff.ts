import { fingerprintHunk } from '@shared/hunk-fingerprint'
import type { HunkLineSelection } from '@shared/rpc'
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

export function buildHunksPatch(
  parsed: ParsedFileDiff,
  hunkHeaders: readonly string[]
): string | null {
  if (!parsed.rawHeader) {
    return null
  }
  const wanted = new Set(hunkHeaders)
  const hunks = parsed.hunks.filter((hunk) => wanted.has(hunk.header))
  if (hunks.length !== wanted.size) {
    return null
  }
  return parsed.rawHeader + hunks.map((hunk) => hunk.raw).join('')
}

type Direction = 'stage' | 'unstage'

interface EmittedLine {
  symbol: ' ' | '-' | '+'
  text: string
  noNewlineInSource: string | null
  markerAfter: string | null
}

interface ReducedHunk {
  lines: EmittedLine[]
  oldCount: number
  newCount: number
}

function lastOnSide(emitted: readonly EmittedLine[], excluded: '-' | '+'): EmittedLine | undefined {
  for (let index = emitted.length - 1; index >= 0; index--) {
    if (emitted[index].symbol !== excluded) {
      return emitted[index]
    }
  }
  return undefined
}

function placeNoNewlineMarkers(emitted: EmittedLine[]): void {
  const lastOld = lastOnSide(emitted, '+')
  const lastNew = lastOnSide(emitted, '-')
  if (lastOld?.noNewlineInSource) {
    if (lastOld.symbol === '-' || lastOld === lastNew) {
      lastOld.markerAfter = lastOld.noNewlineInSource
    } else {
      const splitIndex = emitted.indexOf(lastOld)
      lastOld.symbol = '-'
      lastOld.markerAfter = lastOld.noNewlineInSource
      emitted.splice(splitIndex + 1, 0, {
        symbol: '+',
        text: lastOld.text,
        noNewlineInSource: null,
        markerAfter: null
      })
    }
  }
  if (lastNew?.noNewlineInSource && lastNew !== lastOld) {
    if (lastNew.symbol === '+') {
      lastNew.markerAfter = lastNew.noNewlineInSource
    } else {
      lastNew.symbol = '-'
      emitted.push({
        symbol: '+',
        text: lastNew.text,
        noNewlineInSource: null,
        markerAfter: lastNew.noNewlineInSource
      })
    }
  }
}

function reduceHunk(
  hunk: ParsedHunk,
  selected: ReadonlySet<number>,
  direction: Direction
): ReducedHunk | null {
  const emitted: EmittedLine[] = []
  let hasSelectedChange = false
  hunk.lines.forEach((line, index) => {
    if (line.kind === 'meta') {
      return
    }
    const noNewlineInSource =
      hunk.lines[index + 1]?.kind === 'meta' ? hunk.lines[index + 1].text : null
    if (line.kind === 'context') {
      emitted.push({ symbol: ' ', text: line.text, noNewlineInSource, markerAfter: null })
      return
    }
    const preservedKind = direction === 'stage' ? 'del' : 'add'
    const symbol = line.kind === 'del' ? '-' : '+'
    if (selected.has(index)) {
      hasSelectedChange = true
      emitted.push({ symbol, text: line.text, noNewlineInSource, markerAfter: null })
    } else if (line.kind === preservedKind) {
      emitted.push({ symbol: ' ', text: line.text, noNewlineInSource, markerAfter: null })
    }
  })
  if (!hasSelectedChange) {
    return null
  }
  placeNoNewlineMarkers(emitted)
  const oldCount = emitted.filter((line) => line.symbol !== '+').length
  const newCount = emitted.filter((line) => line.symbol !== '-').length
  return { lines: emitted, oldCount, newCount }
}

const HEADER_TRAILER_RE = /^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/

function renderReducedHunk(
  hunk: ParsedHunk,
  reduced: ReducedHunk,
  direction: Direction,
  drift: number,
  baseDelta: number
): string {
  const preservedStart = direction === 'stage' ? hunk.oldStart : hunk.newStart
  const derivedCount = direction === 'stage' ? reduced.newCount : reduced.oldCount
  const derivedStart = Math.max(preservedStart + baseDelta + drift, derivedCount > 0 ? 1 : 0)
  const oldStart = direction === 'stage' ? preservedStart : derivedStart
  const newStart = direction === 'stage' ? derivedStart : preservedStart
  const trailer = hunk.header.replace(HEADER_TRAILER_RE, '')
  const header = `@@ -${oldStart},${reduced.oldCount} +${newStart},${reduced.newCount} @@${trailer}`
  const body = reduced.lines.flatMap((line) => {
    const rendered = [`${line.symbol}${line.text}`]
    if (line.markerAfter !== null) {
      rendered.push(line.markerAfter)
    }
    return rendered
  })
  return `${[header, ...body].join('\n')}\n`
}

function swapPathPrefix(
  pathLine: string,
  marker: '--- ' | '+++ ',
  targetPrefix: 'a/' | 'b/'
): string {
  const sourcePath = pathLine.slice(4)
  const swapped = sourcePath.startsWith('"')
    ? `"${targetPrefix}${sourcePath.slice(3)}`
    : `${targetPrefix}${sourcePath.slice(2)}`
  return `${marker}${swapped}`
}

function demoteCreateDeleteHeader(
  rawHeader: string,
  direction: Direction,
  derivedSideNonEmpty: boolean
): string {
  if (!derivedSideNonEmpty) {
    return rawHeader
  }
  const modePrefix = direction === 'stage' ? 'deleted file mode ' : 'new file mode '
  const lines = rawHeader.split('\n')
  if (lines.at(-1) === '') {
    lines.pop()
  }
  const modeLine = lines.find((line) => line.startsWith(modePrefix))
  if (!modeLine) {
    return rawHeader
  }
  const mode = modeLine.slice(modePrefix.length)
  const rewritten = lines.flatMap((line) => {
    if (line === modeLine) {
      return []
    }
    if (line.startsWith('index ')) {
      return [`${line} ${mode}`]
    }
    if (direction === 'stage' && line === '+++ /dev/null') {
      const oldPathLine = lines.find((candidate) => candidate.startsWith('--- '))
      return oldPathLine ? [swapPathPrefix(oldPathLine, '+++ ', 'b/')] : [line]
    }
    if (direction === 'unstage' && line === '--- /dev/null') {
      const newPathLine = lines.find((candidate) => candidate.startsWith('+++ '))
      return newPathLine ? [swapPathPrefix(newPathLine, '--- ', 'a/')] : [line]
    }
    return [line]
  })
  return `${rewritten.join('\n')}\n`
}

export function buildSelectedLinesPatch(
  parsed: ParsedFileDiff,
  selections: readonly HunkLineSelection[],
  direction: Direction
): string | null {
  const firstHunk = parsed.hunks[0]
  if (!parsed.rawHeader || !firstHunk || selections.length === 0) {
    return null
  }
  const selectionByHeader = new Map(
    selections.map((selection) => [selection.hunkHeader, selection])
  )
  if (selectionByHeader.size !== selections.length) {
    return null
  }
  const baseDelta =
    direction === 'stage'
      ? firstHunk.newStart - firstHunk.oldStart
      : firstHunk.oldStart - firstHunk.newStart
  let drift = 0
  let matched = 0
  let derivedSideNonEmpty = false
  const renderedHunks: string[] = []
  for (const hunk of parsed.hunks) {
    const selection = selectionByHeader.get(hunk.header)
    if (!selection) {
      continue
    }
    matched++
    if (fingerprintHunk(hunk.raw, hunk.header) !== selection.fingerprint) {
      return null
    }
    if (selection.lineIndexes.some((index) => index < 0 || index >= hunk.lines.length)) {
      return null
    }
    const reduced = reduceHunk(hunk, new Set(selection.lineIndexes), direction)
    if (!reduced) {
      continue
    }
    const derivedCount = direction === 'stage' ? reduced.newCount : reduced.oldCount
    if (derivedCount > 0) {
      derivedSideNonEmpty = true
    }
    renderedHunks.push(renderReducedHunk(hunk, reduced, direction, drift, baseDelta))
    drift +=
      direction === 'stage'
        ? reduced.newCount - reduced.oldCount
        : reduced.oldCount - reduced.newCount
  }
  if (matched !== selectionByHeader.size || renderedHunks.length === 0) {
    return null
  }
  const fileHeader = demoteCreateDeleteHeader(parsed.rawHeader, direction, derivedSideNonEmpty)
  return fileHeader + renderedHunks.join('')
}

export function toFileDiff(filePath: string, parsed: ParsedFileDiff): FileDiff {
  return {
    filePath,
    binary: parsed.binary,
    hunks: parsed.hunks.map(({ raw: _, ...hunk }) => hunk)
  }
}
