import { describe, expect, it } from 'vitest'
import { reflowCommitBody } from '../commit-body'

describe('reflowCommitBody', () => {
  it('joins hard-wrapped continuation lines into one flowing line', () => {
    const body = [
      '- API: add requireCsrfHeader middleware on the admin router (was 6 inline',
      '  copies), databaseConnection middleware exposing c.var.db (was per-handler',
      '  connect/close in ~26 handlers)'
    ].join('\n')

    expect(reflowCommitBody(body)).toBe(
      '- API: add requireCsrfHeader middleware on the admin router (was 6 inline copies), databaseConnection middleware exposing c.var.db (was per-handler connect/close in ~26 handlers)'
    )
  })

  it('keeps separate bullets on separate lines', () => {
    const body = [
      '- Dead code: remove unrouted admin prototype pages plus mock PII data kept',
      '  around from earlier drafts',
      '- Contracts: new shared.ts primitives consumed by admin/catalog schema files'
    ].join('\n')

    expect(reflowCommitBody(body)).toBe(
      [
        '- Dead code: remove unrouted admin prototype pages plus mock PII data kept around from earlier drafts',
        '- Contracts: new shared.ts primitives consumed by admin/catalog schema files'
      ].join('\n')
    )
  })

  it('leaves short lines untouched', () => {
    const body = ['- first change', '- second change', '- third change'].join('\n')

    expect(reflowCommitBody(body)).toBe(body)
  })

  it('preserves blank-line paragraph breaks', () => {
    const body = [
      'A paragraph that was wrapped by the author at the conventional column so',
      'it continues on a second line.',
      '',
      'A second paragraph.'
    ].join('\n')

    expect(reflowCommitBody(body)).toBe(
      [
        'A paragraph that was wrapped by the author at the conventional column so it continues on a second line.',
        '',
        'A second paragraph.'
      ].join('\n')
    )
  })

  it('leaves indented code blocks verbatim', () => {
    const body = [
      'Reproduce with the following snippet which must not be reflowed at all no',
      'matter how long the surrounding prose lines happen to be:',
      '',
      '    const result = await open(repoPath)',
      '    expect(result.ok).toBe(true)'
    ].join('\n')

    expect(reflowCommitBody(body)).toBe(
      [
        'Reproduce with the following snippet which must not be reflowed at all no matter how long the surrounding prose lines happen to be:',
        '',
        '    const result = await open(repoPath)',
        '    expect(result.ok).toBe(true)'
      ].join('\n')
    )
  })
})
