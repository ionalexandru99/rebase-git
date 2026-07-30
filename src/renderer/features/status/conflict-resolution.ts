import type { ConflictSide } from '@/lib/rpc-client'

export type { ConflictSide }

export interface ConflictLabels {
  oursLabel: string
  theirsLabel: string
}

export interface ConflictChoice {
  label: string
  side: ConflictSide
}

export interface ConflictRowActions {
  choices: ConflictChoice[]
  note: string | null
}

const FALLBACK_LABELS: ConflictLabels = {
  oursLabel: 'the current version',
  theirsLabel: 'the incoming version'
}

const SIDE_HOLDING_THE_FILE: Record<string, ConflictSide> = {
  DU: 'theirs',
  UD: 'ours',
  AU: 'ours',
  UA: 'theirs'
}

const BOTH_SIDES_CODES = new Set(['UU', 'AA'])

const opposite = (side: ConflictSide): ConflictSide => (side === 'ours' ? 'theirs' : 'ours')

export function conflictRowActions(
  code: string | undefined,
  labels: ConflictLabels | null
): ConflictRowActions {
  if (code && BOTH_SIDES_CODES.has(code)) {
    const named = labels ?? FALLBACK_LABELS
    return {
      choices: [
        { label: `Keep ${named.oursLabel}`, side: 'ours' },
        { label: `Keep ${named.theirsLabel}`, side: 'theirs' }
      ],
      note: null
    }
  }

  const keepSide = code ? SIDE_HOLDING_THE_FILE[code] : undefined
  if (keepSide) {
    return {
      choices: [
        { label: 'Keep the file', side: keepSide },
        { label: 'Delete the file', side: opposite(keepSide) }
      ],
      note: null
    }
  }

  if (code === 'DD') {
    return { choices: [], note: 'Both sides deleted this file. Stage it to mark it resolved.' }
  }
  return { choices: [], note: 'Stage this file to mark it resolved.' }
}
