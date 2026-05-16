interface TopbarProps {
  repoName: string
  repoPath: string | null
  branch: string
  ahead: number
  behind: number
  onSwitchRepo?: () => void
  onFetch?: () => void
  onPull?: () => void
  onPush?: () => void
}

export function Topbar({
  repoName,
  repoPath,
  branch,
  ahead,
  behind,
  onSwitchRepo,
  onFetch,
  onPull,
  onPush
}: TopbarProps) {
  const initial = repoName.charAt(0).toUpperCase() || 'R'
  return (
    <div className="tb">
      <button
        type="button"
        className="tb-repo"
        onClick={onSwitchRepo}
        title={repoPath ?? undefined}
        aria-label="Switch repository"
      >
        <div className="tb-repo-icon">{initial}</div>
        <div className="tb-repo-name">{repoName}</div>
        {repoPath && <div className="tb-repo-path font-mono">{repoPath}</div>}
      </button>
      <div className="tb-divider" />
      <button type="button" className="tb-branch">
        <span className="dot" />
        <span className="font-mono" style={{ fontSize: 12 }}>
          {branch}
        </span>
        {ahead > 0 && (
          <span className="tb-sync">
            <span className="arr">↑</span>
            {ahead}
          </span>
        )}
        {behind > 0 && (
          <span className="tb-sync">
            <span className="arr" style={{ color: 'var(--del)' }}>
              ↓
            </span>
            {behind}
          </span>
        )}
        <span style={{ color: 'var(--fg-faint)', fontSize: 10 }}>▾</span>
      </button>
      <div className="tb-spacer" />
      <div className="tb-actions">
        <button type="button" className="tb-btn" onClick={onFetch}>
          Fetch
        </button>
        <button type="button" className="tb-btn" onClick={onPull}>
          Pull
        </button>
        <button
          type="button"
          className={`tb-btn ${ahead > 0 ? 'primary' : ''}`}
          onClick={onPush}
          disabled={ahead === 0}
        >
          {ahead > 0 ? `Push ${ahead}` : 'Push'}
        </button>
      </div>
    </div>
  )
}
