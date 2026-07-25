import type { Schema } from 'electron-store'

export interface StoreSchema {
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

export const storeDefaults: StoreSchema = {
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

export const storeSchema: Schema<StoreSchema> = {
  recentRepos: { type: 'array', items: { type: 'string' } },
  theme: { type: 'string', enum: ['dark', 'light'] },
  workspaces: { type: 'array', items: { type: 'string' } },
  activeWorkspace: { type: ['string', 'null'] },
  workingDirectory: { type: ['string', 'null'] },
  onboardingComplete: { type: 'boolean' },
  sidebarOpen: { type: 'boolean' },
  sidebarWidth: { type: 'number' },
  sidebarRefTreeToggles: { type: 'array', items: { type: 'string' } },
  persistedTabRepoPaths: { type: 'array', items: { type: ['string', 'null'] } },
  persistedActiveTabIndex: { type: 'number' }
}
