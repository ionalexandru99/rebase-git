import { filterPersistedRefTreeToggles } from '@shared/ref-tree-toggles'
import Store from 'electron-store'
import { planLegacyWorkspaceMigration } from './migration'
import type { StoreSchema } from './schema'
import { storeDefaults, storeSchema } from './schema'

export const store = new Store<StoreSchema>({
  defaults: storeDefaults,
  schema: storeSchema,
  clearInvalidConfig: true
})

function migrateLegacyWorkingDirectory(): void {
  const migration = planLegacyWorkspaceMigration(
    store.get('workspaces'),
    store.get('workingDirectory'),
    store.get('activeWorkspace')
  )
  if (migration.workspaces) {
    store.set('workspaces', migration.workspaces)
  }
  if (migration.activeWorkspace) {
    store.set('activeWorkspace', migration.activeWorkspace)
  }
}

migrateLegacyWorkingDirectory()

export function replaceStoreWithDefaults(overrides: Partial<StoreSchema> = {}): StoreSchema {
  const replacement = structuredClone({ ...storeDefaults, ...overrides })
  store.store = replacement
  return structuredClone(replacement)
}

export function getTheme(): 'dark' | 'light' {
  return store.get('theme')
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
  return store.get('workspaces')
}

export function addWorkspace(path: string): string[] {
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
  return store.get('activeWorkspace')
}

export function setActiveWorkspace(path: string | null): void {
  store.set('activeWorkspace', path)
  store.set('workingDirectory', path)
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
  return filterPersistedRefTreeToggles(store.get('sidebarRefTreeToggles'))
}

export function setRefTreeToggles(toggles: string[]): void {
  store.set('sidebarRefTreeToggles', filterPersistedRefTreeToggles(toggles))
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
