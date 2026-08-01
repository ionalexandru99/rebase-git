import { describe, expect, it } from 'vitest'
import {
  listModeForWidth,
  modeIsSingleLine,
  modeShowsAuthorName,
  rowHeightForMode,
  WORKING_COPY_ROW_HEIGHT
} from '../list-modes'

describe('listModeForWidth', () => {
  it('picks xwide from 680 upwards', () => {
    expect(listModeForWidth(680)).toBe('xwide')
    expect(listModeForWidth(681)).toBe('xwide')
    expect(listModeForWidth(1920)).toBe('xwide')
  })

  it('drops to wide from 520 up to just below 680', () => {
    expect(listModeForWidth(679)).toBe('wide')
    expect(listModeForWidth(600)).toBe('wide')
    expect(listModeForWidth(520)).toBe('wide')
  })

  it('drops to narrow from 120 up to just below 520', () => {
    expect(listModeForWidth(519)).toBe('narrow')
    expect(listModeForWidth(300)).toBe('narrow')
    expect(listModeForWidth(120)).toBe('narrow')
  })

  it('collapses to index below 120', () => {
    expect(listModeForWidth(119)).toBe('index')
    expect(listModeForWidth(40)).toBe('index')
    expect(listModeForWidth(1)).toBe('index')
  })

  it('falls back to narrow for widths that were never measured', () => {
    expect(listModeForWidth(Number.NaN)).toBe('narrow')
    expect(listModeForWidth(Number.POSITIVE_INFINITY)).toBe('narrow')
    expect(listModeForWidth(Number.NEGATIVE_INFINITY)).toBe('narrow')
    expect(listModeForWidth(0)).toBe('narrow')
    expect(listModeForWidth(-320)).toBe('narrow')
  })
})

describe('rowHeightForMode', () => {
  it('keeps single-line modes at 30 and gives the two-line narrow row 44', () => {
    expect(rowHeightForMode('xwide')).toBe(30)
    expect(rowHeightForMode('wide')).toBe(30)
    expect(rowHeightForMode('index')).toBe(30)
    expect(rowHeightForMode('narrow')).toBe(44)
  })
})

describe('WORKING_COPY_ROW_HEIGHT', () => {
  it('pins the working-copy row at 44 in every mode', () => {
    expect(WORKING_COPY_ROW_HEIGHT).toBe(44)
  })
})

describe('modeShowsAuthorName', () => {
  it('spells out the author name only in xwide', () => {
    expect(modeShowsAuthorName('xwide')).toBe(true)
    expect(modeShowsAuthorName('wide')).toBe(false)
    expect(modeShowsAuthorName('narrow')).toBe(false)
    expect(modeShowsAuthorName('index')).toBe(false)
  })
})

describe('modeIsSingleLine', () => {
  it('lays every mode but narrow out on a single line', () => {
    expect(modeIsSingleLine('xwide')).toBe(true)
    expect(modeIsSingleLine('wide')).toBe(true)
    expect(modeIsSingleLine('index')).toBe(true)
    expect(modeIsSingleLine('narrow')).toBe(false)
  })
})
