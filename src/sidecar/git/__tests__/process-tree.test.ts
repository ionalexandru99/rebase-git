import { describe, expect, it } from 'vitest'
import { descendantPidsFromProcessTable } from '../process-tree'

describe('descendantPidsFromProcessTable', () => {
  it('collects children across every generation', () => {
    const output = ['1 0', '10 1', '20 10', '21 10', '30 1', '40 20'].join('\n')

    expect(new Set(descendantPidsFromProcessTable(output, 1))).toEqual(
      new Set([10, 20, 21, 30, 40])
    )
  })

  it('does not include the parent or unrelated process trees', () => {
    const output = ['10 1', '20 10', '30 2', '40 30'].join('\n')

    expect(descendantPidsFromProcessTable(output, 10)).toEqual([20])
  })

  it('accepts the padded whitespace emitted by ps', () => {
    const output = ['  42      1', '\t84\t42', '  126   84  '].join('\n')

    expect(descendantPidsFromProcessTable(output, 42)).toEqual([84, 126])
  })

  it('ignores malformed and non-integer process rows', () => {
    const output = ['invalid row', '12.5 1', '20 missing', '30 1'].join('\n')

    expect(descendantPidsFromProcessTable(output, 1)).toEqual([30])
  })

  it('returns no descendants when the parent is absent', () => {
    expect(descendantPidsFromProcessTable('', 999)).toEqual([])
  })
})
