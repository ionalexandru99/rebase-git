import {
  LayoutCommitWireSchema,
  LayoutRequestSchema,
  LayoutResultMessageSchema,
  LayoutWorkerRequestSchema,
  toLayoutCommitWire
} from '@shared/graph-layout-protocol'
import { describe, expect, it } from 'vitest'

describe('graph-layout-protocol', () => {
  it('round-trips layout request payloads', () => {
    const payload = {
      type: 'layout' as const,
      generation: 3,
      commits: [{ hash: 'abc', parents: ['def'] }],
      maxCommits: 10_000,
      windowEnd: 500
    }
    expect(LayoutRequestSchema.parse(payload)).toEqual(payload)
    expect(LayoutWorkerRequestSchema.parse(payload)).toEqual(payload)
  })

  it('round-trips extend request payloads', () => {
    const payload = {
      type: 'extend' as const,
      generation: 4,
      targetIndex: 1500,
      maxCommits: 10_000,
      commits: [{ hash: 'abc', parents: [] }],
      prev: {
        rows: [{ commitLane: 0, incoming: [], outgoing: [] }],
        maxLanes: 1,
        lanesAfter: [],
        laidOutThroughIndex: 1
      }
    }
    expect(LayoutWorkerRequestSchema.parse(payload)).toEqual(payload)
  })

  it('round-trips layout result messages', () => {
    const payload = {
      type: 'layout-result' as const,
      generation: 2,
      rows: [{ commitLane: 0, incoming: [null], outgoing: ['parent'] }],
      maxLanes: 1,
      lanesAfter: ['parent'],
      fromIndex: 0,
      toIndex: 1
    }
    expect(LayoutResultMessageSchema.parse(payload)).toEqual(payload)
  })

  it('maps commits to wire format', () => {
    const wire = toLayoutCommitWire([{ hash: 'abc', parents: ['def'] }])
    expect(LayoutCommitWireSchema.array().parse(wire)).toEqual(wire)
  })
})
