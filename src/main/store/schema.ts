import type { PersistedTabRepository } from '@shared/schemas/ipc'
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
  persistedTabRepoPaths: PersistedTabRepository[]
  persistedActiveTabIndex: number
  reopenRepositoriesOnLaunch: boolean
  pullDivergedStrategy: 'rebase' | 'merge' | null
  updateDownloadInBackground: boolean
  updateInstallOnQuit: boolean
  updateChannel: 'stable' | 'nightly' | null
  listPaneWidths: Record<string, number>
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
  reopenRepositoriesOnLaunch: true,
  pullDivergedStrategy: null,
  updateDownloadInBackground: true,
  updateInstallOnQuit: true,
  updateChannel: null,
  listPaneWidths: {}
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
  persistedTabRepoPaths: {
    type: 'array',
    items: {
      anyOf: [
        { type: 'string' },
        { type: 'null' },
        {
          type: 'object',
          properties: {
            environmentId: { type: 'string', minLength: 1 },
            path: { type: 'string', minLength: 1 }
          },
          required: ['environmentId', 'path'],
          additionalProperties: false
        }
      ]
    }
  },
  persistedActiveTabIndex: { type: 'number' },
  reopenRepositoriesOnLaunch: { type: 'boolean' },
  pullDivergedStrategy: { type: ['string', 'null'], enum: ['rebase', 'merge', null] },
  updateDownloadInBackground: { type: 'boolean' },
  updateInstallOnQuit: { type: 'boolean' },
  updateChannel: { type: ['string', 'null'], enum: ['stable', 'nightly', null] },
  listPaneWidths: { type: 'object', additionalProperties: { type: 'number' } }
}
