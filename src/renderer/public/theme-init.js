// Keep colors in sync with src/main/theme.ts — runs before the bundle to avoid a flash.
// Loaded as an external 'self' script so the packaged CSP (script-src 'self') allows it.
const storedTheme = (() => {
  try {
    return localStorage.getItem('theme') === 'light' ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
})()
const root = document.documentElement
root.classList.toggle('dark', storedTheme === 'dark')
root.style.backgroundColor = storedTheme === 'light' ? '#ededed' : '#131313'
