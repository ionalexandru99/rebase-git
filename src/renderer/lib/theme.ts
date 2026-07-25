export type Theme = 'dark' | 'light'

const BACKGROUND: Record<Theme, string> = {
  dark: '#131313',
  light: '#ededed'
}

export function getStoredTheme(): Theme {
  try {
    return localStorage.getItem('theme') === 'light' ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

export function applyTheme(theme: Theme): void {
  const root = document.documentElement
  root.classList.toggle('dark', theme === 'dark')
  root.style.backgroundColor = BACKGROUND[theme]
  try {
    localStorage.setItem('theme', theme)
  } catch {}
}
