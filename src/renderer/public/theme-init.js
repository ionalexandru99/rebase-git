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
