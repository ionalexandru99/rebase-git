import type { Schema } from 'electron-store'

export interface StoreSchema {
  recentRepos: string[]
  workspaces: string[]
  activeWorkspace: string | null
  workingDirectory: string | null
  onboardingComplete: boolean
  sidebarOpen: boolean
  sidebarWidth: number
  sidebarRefTreeToggles: string[]
  persistedTabRepoPaths: (string | null)[]
  persistedActiveTabIndex: number
  pullDivergedStrategy: 'rebase' | 'merge' | null
}

const SIDEBAR_WIDTH_DEFAULT = 244

export const storeDefaults: StoreSchema = {
  recentRepos: [],
  workspaces: [],
  activeWorkspace: null,
  workingDirectory: null,
  onboardingComplete: false,
  sidebarOpen: true,
  sidebarWidth: SIDEBAR_WIDTH_DEFAULT,
  sidebarRefTreeToggles: [],
  persistedTabRepoPaths: [null],
  persistedActiveTabIndex: 0,
  pullDivergedStrategy: null
}

export const storeSchema: Schema<StoreSchema> = {
  recentRepos: { type: 'array', items: { type: 'string' } },
  workspaces: { type: 'array', items: { type: 'string' } },
  activeWorkspace: { type: ['string', 'null'] },
  workingDirectory: { type: ['string', 'null'] },
  onboardingComplete: { type: 'boolean' },
  sidebarOpen: { type: 'boolean' },
  sidebarWidth: { type: 'number' },
  sidebarRefTreeToggles: { type: 'array', items: { type: 'string' } },
  persistedTabRepoPaths: { type: 'array', items: { type: ['string', 'null'] } },
  persistedActiveTabIndex: { type: 'number' },
  pullDivergedStrategy: { type: ['string', 'null'], enum: ['rebase', 'merge', null] }
}
