import { createSignal } from '@/lib/react-compat'
import { applyTheme, getStoredTheme, type Theme } from '@/lib/theme'
import { cn } from '@/lib/utils'

const SWATCHES: { theme: Theme; label: string; background: string }[] = [
  { theme: 'dark', label: 'Dark theme', background: 'oklch(0.245 0 0)' },
  { theme: 'light', label: 'Light theme', background: 'oklch(0.91 0.006 260)' }
]

export function Titlebar() {
  const [theme, setTheme] = createSignal<Theme>(getStoredTheme())

  const select = (next: Theme) => {
    applyTheme(next)
    setTheme(next)
  }

  return (
    <header className="drag-region flex h-[34px] shrink-0 items-center gap-2 bg-chrome pl-[78px] pr-2.5">
      <div className="drag-region flex-1" />
      <div className="no-drag flex items-center gap-1">
        {SWATCHES.map((swatch) => (
          <button
            key={swatch.theme}
            type="button"
            aria-label={swatch.label}
            aria-pressed={theme() === swatch.theme}
            onClick={() => select(swatch.theme)}
            style={{ background: swatch.background }}
            className={cn(
              'size-[18px] rounded-[var(--r-sm)] border border-border',
              theme() === swatch.theme && 'shadow-[inset_0_0_0_2px_var(--primary)]'
            )}
          />
        ))}
      </div>
    </header>
  )
}
