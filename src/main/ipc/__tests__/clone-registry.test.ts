import { describe, expect, it } from 'vitest'
import { createCloneRegistry } from '../clone-registry'

const WEB_CONTENTS = 7
const OTHER_WEB_CONTENTS = 9

describe('clone registry', () => {
  it('cancels the clone the renderer asked for and leaves the others running', () => {
    const registry = createCloneRegistry()
    const first = registry.start(WEB_CONTENTS, 1)
    const second = registry.start(WEB_CONTENTS, 2)
    const elsewhere = registry.start(OTHER_WEB_CONTENTS, 1)

    registry.cancel(WEB_CONTENTS, 1)

    expect(first.signal.aborted).toBe(true)
    expect(second.signal.aborted).toBe(false)
    expect(elsewhere.signal.aborted).toBe(false)
    expect(registry.activeCount()).toBe(2)
  })

  it('drops the entry once a clone finishes, so a late cancel is a no-op', () => {
    const registry = createCloneRegistry()
    const controller = registry.start(WEB_CONTENTS, 1)

    registry.finish(WEB_CONTENTS, 1, controller)
    registry.cancel(WEB_CONTENTS, 1)

    expect(controller.signal.aborted).toBe(false)
    expect(registry.activeCount()).toBe(0)
  })

  it('aborts a document’s clones when it navigates away, leaving other windows alone', () => {
    const registry = createCloneRegistry()
    const reloaded = registry.start(WEB_CONTENTS, 1)
    const survivor = registry.start(OTHER_WEB_CONTENTS, 1)

    expect(registry.retireDocument(WEB_CONTENTS)).toBe(1)

    expect(reloaded.signal.aborted).toBe(true)
    expect(survivor.signal.aborted).toBe(false)
    expect(registry.activeCount()).toBe(1)
  })

  // The reloaded document starts numbering clones from 1 again, so without a per-document
  // generation its first clone would collide with the retired one and Cancel would miss.
  it('keeps a reused clone id from addressing the retired document’s operation', () => {
    const registry = createCloneRegistry()
    const beforeReload = registry.start(WEB_CONTENTS, 1)
    registry.retireDocument(WEB_CONTENTS)

    const afterReload = registry.start(WEB_CONTENTS, 1)
    expect(afterReload).not.toBe(beforeReload)
    expect(afterReload.signal.aborted).toBe(false)

    registry.cancel(WEB_CONTENTS, 1)
    expect(afterReload.signal.aborted).toBe(true)
    expect(registry.activeCount()).toBe(0)
  })

  // A stale entry left in the map would be unreachable from Cancel forever.
  it('retires a duplicate id inside one document instead of shadowing it', () => {
    const registry = createCloneRegistry()
    const stale = registry.start(WEB_CONTENTS, 1)
    const fresh = registry.start(WEB_CONTENTS, 1)

    expect(stale.signal.aborted).toBe(true)
    expect(fresh.signal.aborted).toBe(false)
    expect(registry.activeCount()).toBe(1)

    registry.cancel(WEB_CONTENTS, 1)
    expect(fresh.signal.aborted).toBe(true)
  })

  it('does not resurrect a retired clone when its handler finishes late', () => {
    const registry = createCloneRegistry()
    const beforeReload = registry.start(WEB_CONTENTS, 1)
    registry.retireDocument(WEB_CONTENTS)
    const afterReload = registry.start(WEB_CONTENTS, 1)

    registry.finish(WEB_CONTENTS, 1, beforeReload)

    expect(registry.activeCount()).toBe(1)
    registry.cancel(WEB_CONTENTS, 1)
    expect(afterReload.signal.aborted).toBe(true)
  })
})
