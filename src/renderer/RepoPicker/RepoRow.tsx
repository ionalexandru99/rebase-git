import { RepoListItem } from '@/components/RepoListItem'

interface RepoRowProps {
  path: string
  onSelect: (path: string) => void
}

export function RepoRow({ path, onSelect }: RepoRowProps) {
  return <RepoListItem path={path} onSelect={onSelect} variant="comfortable" />
}
