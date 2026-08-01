const HARD_WRAP_MIN_LENGTH = 56
const BULLET_PATTERN = /^\s*(?:[-*+•]|\d+[.)])\s/
const PREFORMATTED_PATTERN = /^(?: {4}|\t)/

function startsNewBlock(line: string): boolean {
  return line.trim() === '' || BULLET_PATTERN.test(line) || PREFORMATTED_PATTERN.test(line)
}

export function reflowCommitBody(body: string): string {
  const lines = body.split('\n')
  const flowed: string[] = []
  for (const line of lines) {
    const previous = flowed[flowed.length - 1]
    const joinable =
      previous !== undefined &&
      previous.length >= HARD_WRAP_MIN_LENGTH &&
      !PREFORMATTED_PATTERN.test(previous) &&
      !startsNewBlock(line)
    if (joinable) {
      flowed[flowed.length - 1] = `${previous.trimEnd()} ${line.trim()}`
    } else {
      flowed.push(line)
    }
  }
  return flowed.join('\n')
}
