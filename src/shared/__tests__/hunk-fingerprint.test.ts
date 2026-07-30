import { describe, expect, it } from 'vitest'
import { fingerprintHunk } from '../hunk-fingerprint'

const PATCH = [
  'diff --git a/file.txt b/file.txt',
  'index 0000000..1111111 100644',
  '--- a/file.txt',
  '+++ b/file.txt',
  '@@ -1,3 +1,3 @@',
  ' line 1',
  '-line 2',
  '+line two',
  ' line 3',
  '@@ -10,2 +10,3 @@',
  ' line 10',
  '+line 10.5',
  ' line 11',
  ''
].join('\n')

describe('fingerprintHunk', () => {
  it('fingerprints a known hunk body to a stable value', () => {
    expect(fingerprintHunk(PATCH, '@@ -1,3 +1,3 @@')).toBe('26692e3f')
  })

  it('fingerprints the second hunk identically whether sliced from the patch or standalone', () => {
    const standalone = '@@ -10,2 +10,3 @@\n line 10\n+line 10.5\n line 11\n'
    expect(fingerprintHunk(PATCH, '@@ -10,2 +10,3 @@')).toBe(
      fingerprintHunk(standalone, '@@ -10,2 +10,3 @@')
    )
  })

  it('changes when the hunk body changes under the same header', () => {
    const edited = PATCH.replace('+line two', '+line TWO')
    expect(fingerprintHunk(edited, '@@ -1,3 +1,3 @@')).not.toBe(
      fingerprintHunk(PATCH, '@@ -1,3 +1,3 @@')
    )
  })

  it('is insensitive to a missing trailing newline at the end of the patch', () => {
    const trimmed = PATCH.slice(0, -1)
    expect(fingerprintHunk(trimmed, '@@ -10,2 +10,3 @@')).toBe(
      fingerprintHunk(PATCH, '@@ -10,2 +10,3 @@')
    )
  })

  it('returns null when the header is not in the patch', () => {
    expect(fingerprintHunk(PATCH, '@@ -99,1 +99,1 @@')).toBeNull()
  })

  it('matches a header with a trailing section heading only on the exact line', () => {
    const withContext = PATCH.replace('@@ -1,3 +1,3 @@', '@@ -1,3 +1,3 @@ function main()')
    expect(fingerprintHunk(withContext, '@@ -1,3 +1,3 @@')).toBeNull()
    expect(fingerprintHunk(withContext, '@@ -1,3 +1,3 @@ function main()')).not.toBeNull()
  })
})
