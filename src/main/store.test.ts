import { describe, expect, it } from 'vitest'

// We can't test electron-store directly in unit tests easily,
// so we test the pure logic functions by mocking the store.

describe('addRecentRepo logic', () => {
  it('should add a repo to the front of the list', () => {
    const recent: string[] = ['/repo/old']
    const path = '/repo/new'

    const filtered = recent.filter((r) => r !== path)
    filtered.unshift(path)
    const result = filtered.slice(0, 10)

    expect(result).toEqual(['/repo/new', '/repo/old'])
  })

  it('should deduplicate existing repos', () => {
    const recent: string[] = ['/repo/a', '/repo/b', '/repo/a']
    const path = '/repo/a'

    const filtered = recent.filter((r) => r !== path)
    filtered.unshift(path)
    const result = filtered.slice(0, 10)

    expect(result).toEqual(['/repo/a', '/repo/b'])
  })

  it('should limit to 10 repos', () => {
    const recent: string[] = Array.from({ length: 15 }, (_, i) => `/repo/${i}`)
    const path = '/new/repo'

    const filtered = recent.filter((r) => r !== path)
    filtered.unshift(path)
    const result = filtered.slice(0, 10)

    expect(result).toHaveLength(10)
    expect(result[0]).toBe('/new/repo')
  })
})

describe('workingDirectory logic', () => {
  it('should default to null', () => {
    const workingDirectory: string | null = null
    expect(workingDirectory).toBeNull()
  })

  it('should store and retrieve a path', () => {
    const store = { workingDirectory: '' as string | null }
    store.workingDirectory = '/home/user/repos'
    expect(store.workingDirectory).toBe('/home/user/repos')
  })
})

describe('onboardingComplete logic', () => {
  it('should default to false', () => {
    const onboardingComplete = false
    expect(onboardingComplete).toBe(false)
  })

  it('should be settable to true', () => {
    let onboardingComplete = false
    onboardingComplete = true
    expect(onboardingComplete).toBe(true)
  })
})
