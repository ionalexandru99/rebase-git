import { RepoListItem } from '../components/RepoListItem'

interface RepoRowProps {
  path: string
  onSelect: (path: string) => void
}

export function RepoRow(props: RepoRowProps) {
  return <RepoListItem path={props.path} onSelect={props.onSelect} variant="comfortable" />
}
