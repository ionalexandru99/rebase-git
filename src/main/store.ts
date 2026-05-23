import Store from 'electron-store'

interface StoreSchema {
  recentRepos: string[]
  theme: 'dark' | 'light'
  workspaces: string[]
  activeWorkspace: string | null
  workingDirectory: string | null
  onboardingComplete: boolean
  sidebarOpen: boolean
  sidebarWidth: number
  sidebarRefTreeToggles: string[]
  persistedTabRepoPaths: (string | null)[]
  persistedActiveTabIndex: number
}

const SIDEBAR_WIDTH_DEFAULT = 244

export const store = new Store<StoreSchema>({
  defaults: {
    recentRepos: [],
    theme: 'dark',
    workspaces: [],
    activeWorkspace: null,
    workingDirectory: null,
    onboardingComplete: false,
    sidebarOpen: true,
    sidebarWidth: SIDEBAR_WIDTH_DEFAULT,
    sidebarRefTreeToggles: [],
    persistedTabRepoPaths: [null],
    persistedActiveTabIndex: 0
  }
})

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
  store.set('workingDirectory', path)
}

export function getWorkingDirectory(): string | null {
  return getActiveWorkspace()
}

export function setWorkingDirectory(path: string): void {
  addWorkspace(path)
}

export function isOnboardingComplete(): boolean {
  return store.get('onboardingComplete')
}

export function setOnboardingComplete(complete: boolean): void {
  store.set('onboardingComplete', complete)
}

export interface SidebarPrefs {
  open: boolean
  width: number
}

export function getSidebarPrefs(): SidebarPrefs {
  return {
    open: store.get('sidebarOpen'),
    width: store.get('sidebarWidth')
  }
}

export function setSidebarPrefs(prefs: SidebarPrefs): void {
  store.set('sidebarOpen', prefs.open)
  store.set('sidebarWidth', prefs.width)
}

export function getRefTreeToggles(): string[] {
  return store.get('sidebarRefTreeToggles')
}

export function setRefTreeToggles(toggles: string[]): void {
  store.set('sidebarRefTreeToggles', toggles)
}

export interface PersistedTabState {
  tabs: (string | null)[]
  activeIndex: number
}

export function getPersistedTabs(): PersistedTabState {
  const tabs = store.get('persistedTabRepoPaths')
  const activeIndex = store.get('persistedActiveTabIndex')
  if (tabs.length === 0) {
    return { tabs: [null], activeIndex: 0 }
  }
  const clampedIndex = Math.max(0, Math.min(activeIndex, tabs.length - 1))
  return { tabs, activeIndex: clampedIndex }
}

export function setPersistedTabs(state: PersistedTabState): void {
  const tabs = state.tabs.length === 0 ? [null] : state.tabs
  const clampedIndex = Math.max(0, Math.min(state.activeIndex, tabs.length - 1))
  store.set('persistedTabRepoPaths', tabs)
  store.set('persistedActiveTabIndex', clampedIndex)
}
