import type { TabRecord } from './hooks/useTabs'
import { NewTab, type WorkspaceCatalog } from './NewTab'
import { RepoTab } from './RepoTab'

interface TabViewProps {
  tab: TabRecord
  tabActive: boolean
  catalog: WorkspaceCatalog
  onOpenRepo: (sourceTabId: string, path: string) => void
  onRepoOpened: (tabId: string, path: string) => void
}

export function TabView(props: TabViewProps) {
  if (props.tab.kind === 'repo' || props.tab.kind === 'opening-repo') {
    return (
      <RepoTab
        tabId={props.tab.id}
        tabActive={props.tabActive}
        repoPath={props.tab.repoPath}
        catalog={props.catalog}
        onOpenRepo={(path) => props.onOpenRepo(props.tab.id, path)}
        onRepoOpened={(path) => props.onRepoOpened(props.tab.id, path)}
      />
    )
  }

  return (
    <NewTab catalog={props.catalog} onOpenRepo={(path) => props.onOpenRepo(props.tab.id, path)} />
  )
}
