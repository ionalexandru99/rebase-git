import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { ThemeToggle } from '../ThemeToggle'

describe('ThemeToggle', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.classList.remove('dark')
  })

  it('uses the renderer environment storage', () => {
    expect(localStorage).toBe(window.localStorage)
  })

  it('defaults to dark and offers a switch to light', () => {
    render(<ThemeToggle />)

    expect(screen.getByRole('button', { name: /Switch to light theme/i })).toBeInTheDocument()
  })

  it('toggles the document class, label, and stored theme on click', () => {
    render(<ThemeToggle />)
    const toggle = screen.getByRole('button', { name: /Switch to light theme/i })

    fireEvent.click(toggle)

    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(localStorage.getItem('theme')).toBe('light')
    expect(screen.getByRole('button', { name: /Switch to dark theme/i })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Switch to dark theme/i }))

    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(localStorage.getItem('theme')).toBe('dark')
    expect(screen.getByRole('button', { name: /Switch to light theme/i })).toBeInTheDocument()
  })

  it('honors a stored light theme on mount', () => {
    localStorage.setItem('theme', 'light')

    render(<ThemeToggle />)

    expect(screen.getByRole('button', { name: /Switch to dark theme/i })).toBeInTheDocument()
  })
})
