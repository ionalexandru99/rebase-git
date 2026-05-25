import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { parseOrThrow } from '../codec'

const PersonSchema = z.object({
  name: z.string(),
  age: z.number()
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
    expect(() => parseOrThrow(PersonSchema, { name: 'Ada' })).toThrow(/schema validation/)
  })

  it('throws when a field has the wrong type', () => {
    expect(() => parseOrThrow(PersonSchema, { name: 'Ada', age: 'old' })).toThrow(
      /schema validation/
    )
  })

  it('throws on a non-object payload', () => {
    expect(() => parseOrThrow(PersonSchema, 'not-an-object')).toThrow(/schema validation/)
  })
})
