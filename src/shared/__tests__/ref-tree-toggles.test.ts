import {
  filterPersistedRefTreeToggles,
  isRemoteOrTagSectionToggle,
  REF_TREE_REMOTE_SECTION_KEY,
  REF_TREE_TAG_SECTION_KEY
} from '@shared/ref-tree-toggles'
import { describe, expect, it } from 'vitest'

describe('ref-tree toggle persistence', () => {
  it('treats remote and tag section keys as non-persisted', () => {
    expect(isRemoteOrTagSectionToggle(REF_TREE_REMOTE_SECTION_KEY)).toBe(true)
    expect(isRemoteOrTagSectionToggle(REF_TREE_TAG_SECTION_KEY)).toBe(true)
    expect(isRemoteOrTagSectionToggle('section:local')).toBe(false)
  })

  it('strips remote and tag section toggles when persisting', () => {
    expect(
      filterPersistedRefTreeToggles([
        'section:local',
        REF_TREE_REMOTE_SECTION_KEY,
        REF_TREE_TAG_SECTION_KEY,
        'folder:remote:origin'
      ])
    ).toEqual(['section:local', 'folder:remote:origin'])
  })
})
