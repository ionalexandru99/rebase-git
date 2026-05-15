import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

interface HeaderProps {
  currentBranch: string
  repoPath: string | null
  onOpenRepo: () => void
}

export function Header({ currentBranch, repoPath, onOpenRepo }: HeaderProps) {
  return (
    <header className="flex items-center justify-between px-5 py-3.5 bg-secondary border-b border-border">
      <div className="flex items-center gap-4">
        <h1 className="text-lg font-semibold text-white">Git GUI</h1>
        {repoPath && (
          <>
            <span className="text-sm text-muted-foreground">{repoPath}</span>
            <Badge
              variant="secondary"
              className="text-[var(--color-git-branch)] bg-[var(--color-git-branch)]/10 border-[var(--color-git-branch)]/20"
            >
              {currentBranch}
            </Badge>
          </>
        )}
      </div>
      <Button onClick={onOpenRepo}>{repoPath ? 'Switch Repo' : 'Open Repository'}</Button>
    </header>
  )
}
