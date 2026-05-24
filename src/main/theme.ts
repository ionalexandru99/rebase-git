export type Theme = 'dark' | 'light'

export const BACKGROUND_COLORS: Record<Theme, string> = {
  dark: '#0a0a0a',
  light: '#ffffff'
}

export function resolveBackgroundColor(theme: string): string {
  return theme === 'light' ? BACKGROUND_COLORS.light : BACKGROUND_COLORS.dark
}
