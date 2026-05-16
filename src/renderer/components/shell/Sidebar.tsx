interface SidebarBranch {
  name: string
  current: boolean
  ahead?: number
  behind?: number
}

interface SidebarProps {
  branches: SidebarBranch[]
  workingChanges: number
  activeBranch: string
  onSelectBranch: (name: string) => void
}

interface ItemProps {
  glyph?: string
  name: string
  meta?: string | number
  active?: boolean
  current?: boolean
  ahead?: number
  behind?: number
  onClick?: () => void
}

function SidebarItem({ glyph, name, meta, active, current, ahead, behind, onClick }: ItemProps) {
  return (
    <button
      type="button"
      className={`sb-item ${active ? 'active' : ''} ${current ? 'current' : ''}`}
      onClick={onClick}
    >
      {glyph !== undefined && <span className="glyph">{glyph}</span>}
      <span className="name font-mono" style={{ fontSize: 12 }}>
        {name}
      </span>
      {(ahead || behind) && (
        <span className="ahead-behind font-mono">
          {ahead ? <span className="ab-up">↑{ahead}</span> : null}
          {behind ? <span className="ab-dn">↓{behind}</span> : null}
        </span>
      )}
      {meta !== undefined && meta !== '' && <span className="meta font-mono">{meta}</span>}
    </button>
  )
}

export function Sidebar({ branches, workingChanges, activeBranch, onSelectBranch }: SidebarProps) {
  return (
    <div className="shell-sidebar">
      <div className="sb-group">
        <div className="sb-head">
          <span>Workspace</span>
        </div>
        <SidebarItem glyph="◆" name="History" active />
        <SidebarItem glyph="◇" name="Working copy" meta={workingChanges || ''} />
      </div>

      <div className="sb-group">
        <div className="sb-head">
          <span>Branches</span>
          <button type="button" aria-label="New branch">
            +
          </button>
        </div>
        {branches.map((b) => (
          <SidebarItem
            key={b.name}
            glyph={b.current ? '●' : '○'}
            name={b.name}
            current={b.current}
            ahead={b.ahead}
            behind={b.behind}
            active={b.name === activeBranch}
            onClick={() => onSelectBranch(b.name)}
          />
        ))}
      </div>
    </div>
  )
}
