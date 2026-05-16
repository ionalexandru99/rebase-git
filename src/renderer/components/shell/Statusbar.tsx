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
        <span className="font-mono">{branch}</span>
      </span>
      {ahead > 0 && <span className="pip">↑ {ahead} to push</span>}
      {behind > 0 && <span className="pip">↓ {behind} to pull</span>}
      <span className="pip">
        {changes} change{changes === 1 ? '' : 's'}
      </span>
      <span className="spacer" />
      <span>
        Direction: <span style={{ color: 'var(--fg)' }}>{directionLabel}</span>
      </span>
      <span style={{ color: 'var(--fg-faint)' }}>·</span>
      <span className="font-mono">git</span>
      {lastFetch && (
        <>
          <span style={{ color: 'var(--fg-faint)' }}>·</span>
          <span>last fetch {lastFetch}</span>
        </>
      )}
    </div>
  )
}
