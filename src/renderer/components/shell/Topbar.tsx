import { type CSSProperties, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface TopbarProps {
  repoName: string
  repoPath: string | null
  branch: string
  ahead: number
  behind: number
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
  onFetch,
  onPull,
  onPush
}: TopbarProps) {
  const initial = repoName.charAt(0).toUpperCase() || 'R'
  const wrapRef = useRef<HTMLSpanElement>(null)
  const textRef = useRef<HTMLSpanElement>(null)
  const [scrollDist, setScrollDist] = useState(0)

  // biome-ignore lint/correctness/useExhaustiveDependencies: branch name change must re-trigger DOM measurement
  useEffect(() => {
    const wrap = wrapRef.current
    const text = textRef.current
    if (!wrap || !text) return

    function compute() {
      if (!wrap || !text) return
      const overflow = text.scrollWidth - wrap.clientWidth
      setScrollDist(overflow > 0 ? overflow : 0)
    }

    compute()
    const ro = new ResizeObserver(compute)
    ro.observe(wrap)
    return () => ro.disconnect()
  }, [branch])

  const isScrollable = scrollDist > 0
  const marqueeStyle: CSSProperties | undefined = isScrollable
    ? ({ '--marquee-dist': `-${scrollDist}px` } as CSSProperties)
    : undefined

  return (
    <div className="flex h-11 shrink-0 select-none items-center gap-2.5 px-3.5">
      <div className="flex min-w-0 items-center gap-2 px-2 py-1">
        <div className="grid size-5.5 shrink-0 place-items-center rounded-md bg-gradient-to-br from-[#8eb6d4] to-[#4d7ea3] text-xs font-bold text-[#131a20]">
          {initial}
        </div>
        <div className="shrink-0 font-semibold">{repoName}</div>
        {repoPath && <div className="min-w-0 truncate text-xs text-fg-muted">{repoPath}</div>}
      </div>

      <div aria-hidden className="h-4.5 w-px shrink-0 bg-border" />

      <button
        type="button"
        className="inline-flex max-w-65 shrink-0 cursor-default items-center gap-2 rounded-md border border-border bg-card px-2.5 py-1 text-xs text-foreground hover:border-line-strong hover:bg-popover"
      >
        <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-primary" />
        <span ref={wrapRef} data-marquee-wrap className="min-w-0 overflow-hidden">
          <span
            ref={textRef}
            data-marquee={isScrollable ? '' : undefined}
            className={cn(
              'inline-block whitespace-nowrap',
              isScrollable && 'motion-safe:animate-marquee'
            )}
            style={marqueeStyle}
          >
            {branch}
          </span>
        </span>
        {ahead > 0 && (
          <span className="inline-flex shrink-0 items-center gap-1 text-xs text-fg-soft">
            <span className="text-primary">↑</span>
            {ahead}
          </span>
        )}
        {behind > 0 && (
          <span className="inline-flex shrink-0 items-center gap-1 text-xs text-fg-soft">
            <span className="text-del">↓</span>
            {behind}
          </span>
        )}
        <span className="text-xs text-fg-faint">▾</span>
      </button>

      <div className="flex-1" />

      <div className="flex shrink-0 items-center gap-0.5">
        <Button variant="ghost" size="sm" onClick={onFetch}>
          Fetch
        </Button>
        <Button variant="ghost" size="sm" onClick={onPull}>
          Pull
        </Button>
        <Button
          variant={ahead > 0 ? 'default' : 'ghost'}
          size="sm"
          onClick={onPush}
          disabled={ahead === 0}
        >
          {ahead > 0 ? `Push ${ahead}` : 'Push'}
        </Button>
      </div>
    </div>
  )
}
