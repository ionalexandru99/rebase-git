import { describe, expect, it } from 'vitest'
import { HELP_LINKS, HELP_TOPIC_LABELS, isHelpTopic } from '../help-links'

describe('help links', () => {
  it('resolves every topic to an https documentation URL', () => {
    for (const url of Object.values(HELP_LINKS)) {
      expect(new URL(url).protocol).toBe('https:')
    }
  })

  it('labels every topic', () => {
    expect(Object.keys(HELP_TOPIC_LABELS).sort()).toEqual(Object.keys(HELP_LINKS).sort())
  })

  it('accepts only known topics, so the renderer cannot pick the URL', () => {
    expect(isHelpTopic('git-credentials')).toBe(true)
    expect(isHelpTopic('https://evil.example.com')).toBe(false)
    expect(isHelpTopic('toString')).toBe(false)
    expect(isHelpTopic('__proto__')).toBe(false)
    expect(isHelpTopic(undefined)).toBe(false)
  })
})
