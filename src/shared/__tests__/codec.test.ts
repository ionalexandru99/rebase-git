import { Schema } from 'effect'
import { describe, expect, it } from 'vitest'
import { parseOrThrow } from '../codec'

const PersonSchema = Schema.Struct({
  name: Schema.String,
  age: Schema.Number
})

describe('parseOrThrow', () => {
  it('returns the parsed value when the payload matches the schema', () => {
    const result = parseOrThrow(PersonSchema, { name: 'Ada', age: 36 })
    expect(result).toEqual({ name: 'Ada', age: 36 })
  })

  it('validates outbound values the same as inbound', () => {
    const person = { name: 'Ada', age: 36 }
    expect(parseOrThrow(PersonSchema, person)).toEqual(person)
  })

  it('throws when a required field is missing', () => {
    expect(() => parseOrThrow(PersonSchema, { name: 'Ada' })).toThrow(/age/)
  })

  it('throws when a field has the wrong type', () => {
    expect(() => parseOrThrow(PersonSchema, { name: 'Ada', age: 'old' })).toThrow(/number/)
  })

  it('throws on a non-object payload', () => {
    expect(() => parseOrThrow(PersonSchema, 'not-an-object')).toThrow(/object/)
  })
})
