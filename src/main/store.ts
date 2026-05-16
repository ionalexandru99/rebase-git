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
  workingDirectory: string | null
  onboardingComplete: boolean
}

export const store = new Store<StoreSchema>({
  defaults: {
    recentRepos: [],
    windowState: {
      width: 1200,
      height: 800
    },
    theme: 'dark',
    workingDirectory: null,
    onboardingComplete: false
  }
})

export function addRecentRepo(path: string): void {
  const recent = store.get('recentRepos')
  const filtered = recent.filter((r) => r !== path)
  filtered.unshift(path)
  store.set('recentRepos', filtered.slice(0, 10))
}

export function getRecentRepos(): string[] {
  return store.get('recentRepos')
}

export function getWorkingDirectory(): string | null {
  return store.get('workingDirectory')
}

export function setWorkingDirectory(path: string): void {
  store.set('workingDirectory', path)
}

export function isOnboardingComplete(): boolean {
  return store.get('onboardingComplete')
}

export function setOnboardingComplete(complete: boolean): void {
  store.set('onboardingComplete', complete)
}
