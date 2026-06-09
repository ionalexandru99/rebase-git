export type Theme = 'dark' | 'light'

export const BACKGROUND_COLORS: Record<Theme, string> = {
  dark: '#131313',
  light: '#ededed'
}

export function resolveBackgroundColor(theme: string): string {
  return theme === 'light' ? BACKGROUND_COLORS.light : BACKGROUND_COLORS.dark
}
