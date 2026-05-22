import { Schema } from 'effect'
import { describe, expect, it } from 'vitest'
import { decodeOrThrow, encodeOrThrow } from './codec'

const Person = Schema.Struct({
  name: Schema.String,
  age: Schema.Number
})

describe('decodeOrThrow', () => {
  it('returns the decoded value when the payload matches the schema', () => {
    const result = decodeOrThrow(Person, { name: 'Ada', age: 36 })
    expect(result).toEqual({ name: 'Ada', age: 36 })
  })

  it('throws when a required field is missing', () => {
    expect(() => decodeOrThrow(Person, { name: 'Ada' })).toThrow(/schema decode/)
  })

  it('throws when a field has the wrong type', () => {
    expect(() => decodeOrThrow(Person, { name: 'Ada', age: 'old' })).toThrow(/schema decode/)
  })

  it('throws on a non-object payload', () => {
    expect(() => decodeOrThrow(Person, 'not-an-object')).toThrow(/schema decode/)
  })
})

describe('encodeOrThrow', () => {
  it('round-trips a valid value', () => {
    const decoded = decodeOrThrow(Person, { name: 'Ada', age: 36 })
    expect(encodeOrThrow(Person, decoded)).toEqual({ name: 'Ada', age: 36 })
  })
})
