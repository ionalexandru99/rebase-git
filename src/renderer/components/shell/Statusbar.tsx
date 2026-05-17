interface StatusbarProps {
  branch: string
  ahead: number
  behind: number
  changes: number
  directionLabel: string
  lastFetch?: string
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
    <div className="shell-statusbar">
      <span className="pip">
        <span className="d acc" />
        <span>{branch}</span>
      </span>
      {ahead > 0 && <span className="pip">↑ {ahead} to push</span>}
      {behind > 0 && <span className="pip">↓ {behind} to pull</span>}
      <span className="pip">
        {changes} change{changes === 1 ? '' : 's'}
      </span>
      <span className="spacer" />
      <span>
        Direction: <span className="text-foreground">{directionLabel}</span>
      </span>
      <span className="text-[color:var(--fg-faint)]">·</span>
      <span>git</span>
      {lastFetch && (
        <>
          <span className="text-[color:var(--fg-faint)]">·</span>
          <span>last fetch {lastFetch}</span>
        </>
      )}
    </div>
  )
}
