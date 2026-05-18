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
  workspaces: string[]
  activeWorkspace: string | null
  workingDirectory: string | null
  onboardingComplete: boolean
  sidebarWidth: number
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
