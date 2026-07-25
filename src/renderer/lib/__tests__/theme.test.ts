import { beforeEach, describe, expect, it } from 'vitest'
import { applyTheme } from '../theme'

describe('applyTheme', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.classList.remove('dark')
    document.documentElement.style.backgroundColor = ''
  })

  it('applies the light theme background', () => {
    applyTheme('light')

    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(document.documentElement.style.backgroundColor).toBe('#ededed')
    expect(localStorage.getItem('theme')).toBe('light')
  })
})
