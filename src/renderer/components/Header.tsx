import { GitBranch } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface HeaderProps {
  currentBranch: string
  repoPath: string | null
  onOpenRepo: () => void
}

export function Header({ currentBranch, repoPath, onOpenRepo }: HeaderProps) {
  const repoName = repoPath?.split('/').filter(Boolean).at(-1) ?? null

  return (
    <header className="drag-region flex h-11 shrink-0 items-center justify-between gap-3 border-b border-border bg-card/40 pl-3.5 pr-2">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex shrink-0 items-center gap-2">
          <RebaseMark />
          <h1 className="text-[13px] font-semibold tracking-tight text-foreground">Rebase</h1>
        </div>

        {repoPath && (
          <>
            <span aria-hidden className="text-muted-foreground/40">
              /
            </span>
            <div className="flex min-w-0 items-baseline gap-2">
              {repoName && (
                <span
                  className="shrink-0 text-[12.5px] font-medium text-foreground"
                  title={repoPath}
                >
                  {repoName}
                </span>
              )}
              <span
                className="truncate font-mono text-[10.5px] text-muted-foreground/70"
                title={repoPath}
              >
                {repoPath}
              </span>
            </div>
          </>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        {repoPath && (
          <div className="no-drag flex h-6 items-center gap-1.5 rounded-[5px] border border-border bg-secondary/60 px-2 text-[11.5px] text-foreground">
            <GitBranch className="h-3 w-3 text-primary" strokeWidth={2} />
            <span className="font-mono">{currentBranch || 'no-branch'}</span>
          </div>
        )}
        <Button
          onClick={onOpenRepo}
          variant="ghost"
          size="sm"
          className="no-drag h-6 rounded-[5px] px-2 text-[11.5px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          {repoPath ? 'Switch Repo' : 'Open Repository'}
        </Button>
      </div>
    </header>
  )
}

/** Geometric branch glyph drawn from primitives — restrained, no glow. */
function RebaseMark() {
  return (
    <div className="relative flex h-5 w-5 items-center justify-center rounded-[4px] bg-primary/12 ring-1 ring-inset ring-primary/30">
      <svg
        viewBox="0 0 16 16"
        className="h-3 w-3 text-primary"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        role="img"
      >
        <title>Rebase</title>
        <circle cx="4" cy="3.5" r="1.25" />
        <circle cx="12" cy="12.5" r="1.25" />
        <path d="M4 4.75v6.5" />
        <path d="M12 3.5H8.5A3 3 0 0 0 5.5 6.5v5.5" />
      </svg>
    </div>
  )
}
