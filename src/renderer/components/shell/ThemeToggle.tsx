import { MoonIcon, SunIcon } from 'lucide-react'
import { useState } from 'react'
import { applyTheme, getStoredTheme, type Theme } from '@/lib/theme'
import { cn } from '@/lib/utils'

interface ThemeToggleProps {
  className?: string
}

export function ThemeToggle(props: ThemeToggleProps) {
  const [theme, setTheme] = useState<Theme>(getStoredTheme())

  const toggle = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark'
    applyTheme(next)
    setTheme(next)
  }

  const Icon = theme === 'dark' ? SunIcon : MoonIcon

  return (
    <button
      type="button"
      aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
      onClick={toggle}
      className={cn(
        'no-drag flex size-9 items-center justify-center rounded-[var(--r-md)] text-muted-foreground transition-colors hover:bg-card-2 hover:text-foreground',
        props.className
      )}
    >
      <Icon className="size-[18px]" />
    </button>
  )
}
