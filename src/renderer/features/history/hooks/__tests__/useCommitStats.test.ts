import { describe, expect, it } from 'vitest'
import { COMMIT_STATS_BLOCK_SIZE, commitStatsBlocks } from '../useCommitStats'

const shas = Array.from({ length: COMMIT_STATS_BLOCK_SIZE * 3 }, (_unused, index) => `sha-${index}`)

describe('commitStatsBlocks', () => {
  it('batches the visible range into index-aligned blocks', () => {
    const blocks = commitStatsBlocks(shas, 0, 3)

    expect(blocks).toHaveLength(1)
    expect(blocks[0].shas).toHaveLength(COMMIT_STATS_BLOCK_SIZE)
    expect(blocks[0].shas[0]).toBe('sha-0')
  })

  it('covers every block the range straddles', () => {
    const blocks = commitStatsBlocks(shas, COMMIT_STATS_BLOCK_SIZE - 1, COMMIT_STATS_BLOCK_SIZE + 1)

    expect(blocks).toHaveLength(2)
    expect(blocks[1].shas[0]).toBe(`sha-${COMMIT_STATS_BLOCK_SIZE}`)
  })

  it('keys a block by its first sha so scrolling back is a cache hit', () => {
    const first = commitStatsBlocks(shas, 0, 1)
    const again = commitStatsBlocks(shas, 2, 3)

    expect(again[0].key).toBe(first[0].key)
  })

  it('clamps the tail block to the commits that exist', () => {
    const blocks = commitStatsBlocks(shas.slice(0, COMMIT_STATS_BLOCK_SIZE + 2), 0, 200)

    expect(blocks).toHaveLength(2)
    expect(blocks[1].shas).toHaveLength(2)
  })

  it('asks for nothing when there is nothing on screen', () => {
    expect(commitStatsBlocks([], 0, 10)).toEqual([])
    expect(commitStatsBlocks(shas, 5, 5)).toEqual([])
  })
})
