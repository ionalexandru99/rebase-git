import { describe, expect, it } from 'vitest'
import { missingIdentityFields } from '../missing-identity'

const resolved = (effective: { name?: string; email?: string }) => ({
  local: {},
  global: {},
  effective
})

describe('missingIdentityFields', () => {
  it('reports nothing while the identity is still unknown', () => {
    expect(missingIdentityFields(null)).toEqual([])
  })

  it('reports nothing when both values are set', () => {
    expect(missingIdentityFields(resolved({ name: 'Ada', email: 'ada@example.com' }))).toEqual([])
  })

  it('reports only the value git is missing', () => {
    expect(missingIdentityFields(resolved({ name: 'Ada' }))).toEqual(['email'])
    expect(missingIdentityFields(resolved({ email: 'ada@example.com' }))).toEqual(['name'])
  })

  it('treats a blank value as missing', () => {
    expect(missingIdentityFields(resolved({ name: '  ', email: '' }))).toEqual(['name', 'email'])
  })
})
