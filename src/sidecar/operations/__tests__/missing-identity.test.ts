import { describe, expect, it } from 'vitest'
import { isMissingIdentityMessage } from '../identity'

const identityPrompt = [
  'Author identity unknown',
  '',
  '*** Please tell me who you are.',
  '',
  'Run',
  '',
  '  git config --global user.email "you@example.com"',
  '  git config --global user.name "Your Name"',
  '',
  "to set your account's default identity.",
  'Omit --global to set the identity only in this repository.',
  ''
].join('\n')

describe('isMissingIdentityMessage', () => {
  it('recognises the failure git prints when it cannot guess an email address', () => {
    expect(
      isMissingIdentityMessage(
        `${identityPrompt}fatal: unable to auto-detect email address (got 'someone@host.(none)')`
      )
    ).toBe(true)
  })

  it('recognises the failure git prints when auto-detection is disabled', () => {
    expect(
      isMissingIdentityMessage(
        `${identityPrompt}fatal: no email was given and auto-detection is disabled`
      )
    ).toBe(true)
  })

  it('recognises an empty configured name', () => {
    expect(
      isMissingIdentityMessage('fatal: empty ident name (for <someone@example.com>) not allowed')
    ).toBe(true)
  })

  it('leaves unrelated commit failures alone', () => {
    expect(isMissingIdentityMessage('fatal: Unable to create index.lock: File exists.')).toBe(false)
    expect(isMissingIdentityMessage('nothing to commit, working tree clean')).toBe(false)
  })
})
