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
}

export const store = new Store<StoreSchema>({
  defaults: {
    recentRepos: [],
    windowState: {
      width: 1200,
      height: 800
    },
    theme: 'dark'
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
