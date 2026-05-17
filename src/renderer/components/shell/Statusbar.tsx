interface StatusbarProps {
  branch: string
  ahead: number
  behind: number
  changes: number
  directionLabel: string
  lastFetch?: string
}

function Pip({ children, accent = false }: { children: React.ReactNode; accent?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {accent && <span aria-hidden className="size-1.5 rounded-full bg-primary" />}
      {children}
    </span>
  )
}

export function Statusbar({
  branch,
  ahead,
  behind,
  changes,
  directionLabel,
  lastFetch
}: StatusbarProps) {
  return (
    <div className="flex h-6.5 shrink-0 items-center gap-3.5 border-t border-border bg-background px-3.5 text-xs text-fg-muted">
      <Pip accent>
        <span>{branch}</span>
      </Pip>
      {ahead > 0 && <Pip>↑ {ahead} to push</Pip>}
      {behind > 0 && <Pip>↓ {behind} to pull</Pip>}
      <Pip>
        {changes} change{changes === 1 ? '' : 's'}
      </Pip>
      <span className="flex-1" />
      <span>
        Direction: <span className="text-foreground">{directionLabel}</span>
      </span>
      <span className="text-fg-faint">·</span>
      <span>git</span>
      {lastFetch && (
        <>
          <span className="text-fg-faint">·</span>
          <span>last fetch {lastFetch}</span>
        </>
      )}
    </div>
  )
}
