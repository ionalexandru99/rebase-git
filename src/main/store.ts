import Store from 'electron-store'

interface StoreSchema {
  recentRepos: string[]
  windowState: {
    width: number
    height: number
    x?: number
    y?: number
    maximized?: boolean
  }
  theme: 'dark' | 'light'
  /** All saved workspace parent folders (each contains one or more git repos). */
  workspaces: string[]
  /** Which workspace is currently in focus in the empty-state picker. */
  activeWorkspace: string | null
  /**
   * Legacy single-workspace field. Migrated into `workspaces` on first read.
   * Kept around so a downgrade doesn't lose data.
   */
  workingDirectory: string | null
  onboardingComplete: boolean
  /** Sidebar width in px. User-resizable via the gutter in Shell. */
  sidebarWidth: number
  /** History timeline column widths in rem. User-resizable via header handles. */
  historyColWidths: { author: number; date: number; sha: number }
}

export const store = new Store<StoreSchema>({
  defaults: {
    recentRepos: [],
    windowState: {
      width: 1200,
      height: 800
    },
    theme: 'dark',
    workspaces: [],
    activeWorkspace: null,
    workingDirectory: null,
    onboardingComplete: false,
    sidebarWidth: 244,
    historyColWidths: { author: 14, date: 6, sha: 4.5 }
  }
})

/**
 * Promote the legacy single `workingDirectory` into the `workspaces` array
 * the first time anyone asks about workspaces. Idempotent.
 */
function migrateLegacyWorkingDirectory(): void {
  const workspaces = store.get('workspaces')
  if (workspaces.length > 0) return
  const legacy = store.get('workingDirectory')
  if (!legacy) return
  store.set('workspaces', [legacy])
  if (!store.get('activeWorkspace')) {
    store.set('activeWorkspace', legacy)
  }
}

export function addRecentRepo(path: string): void {
  const recent = store.get('recentRepos')
  const filtered = recent.filter((r) => r !== path)
  filtered.unshift(path)
  store.set('recentRepos', filtered.slice(0, 10))
}

export function getRecentRepos(): string[] {
  return store.get('recentRepos')
}

export function getWorkspaces(): string[] {
  migrateLegacyWorkingDirectory()
  return store.get('workspaces')
}

export function addWorkspace(path: string): string[] {
  migrateLegacyWorkingDirectory()
  const workspaces = store.get('workspaces')
  if (workspaces.includes(path)) {
    store.set('activeWorkspace', path)
    store.set('workingDirectory', path)
    return workspaces
  }
  const next = [...workspaces, path]
  store.set('workspaces', next)
  store.set('activeWorkspace', path)
  store.set('workingDirectory', path)
  return next
}

export function removeWorkspace(path: string): string[] {
  migrateLegacyWorkingDirectory()
  const workspaces = store.get('workspaces').filter((w) => w !== path)
  store.set('workspaces', workspaces)
  if (store.get('activeWorkspace') === path) {
    const nextActive = workspaces[0] ?? null
    store.set('activeWorkspace', nextActive)
    store.set('workingDirectory', nextActive)
  }
  return workspaces
}

export function getActiveWorkspace(): string | null {
  migrateLegacyWorkingDirectory()
  return store.get('activeWorkspace')
}

export function setActiveWorkspace(path: string | null): void {
  migrateLegacyWorkingDirectory()
  store.set('activeWorkspace', path)
  // Mirror into the legacy field so older code paths still work.
  store.set('workingDirectory', path)
}

/**
 * Legacy single-workspace alias. Returns the active workspace.
 * Prefer `getActiveWorkspace()` in new code.
 */
export function getWorkingDirectory(): string | null {
  return getActiveWorkspace()
}

/**
 * Legacy alias: setting the working directory now also registers it as a
 * workspace and marks it active.
 */
export function setWorkingDirectory(path: string): void {
  addWorkspace(path)
}

export function isOnboardingComplete(): boolean {
  return store.get('onboardingComplete')
}

export function setOnboardingComplete(complete: boolean): void {
  store.set('onboardingComplete', complete)
}
