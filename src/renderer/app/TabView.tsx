import { SettingsPanel } from '../features/settings/SettingsPanel'
import type { TabRecord } from '../hooks/useTabs'
import { NewTab, type WorkspaceCatalog } from './NewTab'
import { RepoTab } from './RepoTab'

interface TabViewProps {
  tab: TabRecord
  tabActive: boolean
  settingsOpen: boolean
  settingsInitialSectionId: string | null
  onCloseSettings: () => void
  catalog: WorkspaceCatalog
  onOpenRepo: (sourceTabId: string, path: string) => void
  onRepoOpened: (tabId: string, path: string) => boolean
  onRepoOpenFailed: (tabId: string, path: string) => void
}

export function TabView(props: TabViewProps) {
  if (props.tabActive && props.settingsOpen) {
    const repoPath = props.tab.kind === 'new' ? null : props.tab.repoPath
    const repoRef = props.tab.kind === 'new' ? null : props.tab.repoRef
    return (
      <SettingsPanel
        repoRef={repoRef}
        repoPath={repoPath}
        initialSectionId={props.settingsInitialSectionId}
        onClose={props.onCloseSettings}
      />
    )
  }

  if (
    props.tab.kind === 'repo' ||
    props.tab.kind === 'opening-repo' ||
    props.tab.kind === 'failed-repo'
  ) {
    return (
      <RepoTab
        tabId={props.tab.id}
        tabActive={props.tabActive}
        repoRef={props.tab.repoRef}
        repoPath={props.tab.repoPath}
        openRevision={props.tab.kind === 'repo' ? props.tab.openRevision : undefined}
        catalog={props.catalog}
        onOpenRepo={(path) => props.onOpenRepo(props.tab.id, path)}
        onRepoOpened={(path) => props.onRepoOpened(props.tab.id, path)}
        onRepoOpenFailed={(path) => props.onRepoOpenFailed(props.tab.id, path)}
      />
    )
  }

  return (
    <NewTab catalog={props.catalog} onOpenRepo={(path) => props.onOpenRepo(props.tab.id, path)} />
  )
}
