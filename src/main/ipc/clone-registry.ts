// Clone ids are minted by the renderer and restart at 1 with every fresh document, so the id alone
// cannot identify an operation across a reload. The registry keys by document instead: a reload
// retires the previous document's clones, which is both what stops an abandoned clone from writing
// on unattended and what keeps a reused id from ever addressing the wrong operation.

interface RegisteredClone {
  controller: AbortController
  webContentsId: number
  documentGeneration: number
}

export interface CloneRegistry {
  start(webContentsId: number, cloneId: number): AbortController
  finish(webContentsId: number, cloneId: number, controller: AbortController): void
  cancel(webContentsId: number, cloneId: number): void
  retireDocument(webContentsId: number): number
  activeCount(): number
}

export function createCloneRegistry(): CloneRegistry {
  const clones = new Map<string, RegisteredClone>()
  const generations = new Map<number, number>()

  const key = (webContentsId: number, cloneId: number, generation: number): string =>
    `${webContentsId}:${generation}:${cloneId}`

  const generationOf = (webContentsId: number): number => generations.get(webContentsId) ?? 0

  const abortEntry = (entryKey: string, entry: RegisteredClone): void => {
    clones.delete(entryKey)
    entry.controller.abort()
  }

  return {
    start: (webContentsId, cloneId) => {
      const generation = generationOf(webContentsId)
      const entryKey = key(webContentsId, cloneId, generation)
      // One document cannot legitimately run two clones under the same id; if it happens the older
      // one is stale, and leaving it in the map would make it unreachable from Cancel.
      const existing = clones.get(entryKey)
      if (existing) {
        abortEntry(entryKey, existing)
      }
      const controller = new AbortController()
      clones.set(entryKey, { controller, webContentsId, documentGeneration: generation })
      return controller
    },

    finish: (webContentsId, cloneId, controller) => {
      const entryKey = key(webContentsId, cloneId, generationOf(webContentsId))
      if (clones.get(entryKey)?.controller === controller) {
        clones.delete(entryKey)
      }
    },

    cancel: (webContentsId, cloneId) => {
      const entryKey = key(webContentsId, cloneId, generationOf(webContentsId))
      const entry = clones.get(entryKey)
      if (entry) {
        abortEntry(entryKey, entry)
      }
    },

    retireDocument: (webContentsId) => {
      generations.set(webContentsId, generationOf(webContentsId) + 1)
      let aborted = 0
      for (const [entryKey, entry] of clones) {
        if (entry.webContentsId === webContentsId) {
          abortEntry(entryKey, entry)
          aborted += 1
        }
      }
      return aborted
    },

    activeCount: () => clones.size
  }
}
