export type HistoryListMode = 'xwide' | 'wide' | 'narrow' | 'index'

const SINGLE_LINE_ROW_HEIGHT = 30
const TWO_LINE_ROW_HEIGHT = 44

export const WORKING_COPY_ROW_HEIGHT = TWO_LINE_ROW_HEIGHT

export function listModeForWidth(width: number): HistoryListMode {
  if (!Number.isFinite(width) || width <= 0) {
    return 'narrow'
  }
  if (width >= 680) {
    return 'xwide'
  }
  if (width >= 520) {
    return 'wide'
  }
  if (width >= 120) {
    return 'narrow'
  }
  return 'index'
}

export function rowHeightForMode(mode: HistoryListMode): 30 | 44 {
  if (mode === 'narrow') {
    return TWO_LINE_ROW_HEIGHT
  }
  return SINGLE_LINE_ROW_HEIGHT
}

export function modeShowsAuthorName(mode: HistoryListMode): boolean {
  return mode === 'xwide'
}

export function modeIsSingleLine(mode: HistoryListMode): boolean {
  return mode !== 'narrow'
}
