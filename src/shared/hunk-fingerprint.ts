const HUNK_HEADER_START = /^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/

export function fingerprintHunk(patch: string, hunkHeader: string): string | null {
  const lines = patch.split('\n')
  if (lines.at(-1) === '') {
    lines.pop()
  }
  const headerIndex = lines.indexOf(hunkHeader)
  if (headerIndex === -1 || !HUNK_HEADER_START.test(hunkHeader)) {
    return null
  }
  const body = [hunkHeader]
  for (let index = headerIndex + 1; index < lines.length; index++) {
    const line = lines[index]
    const marker = line[0]
    if (line !== '' && marker !== ' ' && marker !== '+' && marker !== '-' && marker !== '\\') {
      break
    }
    body.push(line)
  }
  let hash = 0x811c9dc5
  for (const byte of new TextEncoder().encode(`${body.join('\n')}\n`)) {
    hash ^= byte
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}
