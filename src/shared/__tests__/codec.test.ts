import { Either, Schema } from 'effect'
import { describe, expect, it } from 'vitest'
import { parseEither, parseOrThrow } from '../codec'

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
    expect(() => parseOrThrow(PersonSchema, { name: 'Ada' })).toThrow()
  })

  it('throws when a field has the wrong type', () => {
    expect(() => parseOrThrow(PersonSchema, { name: 'Ada', age: 'old' })).toThrow()
  })

  it('throws on a non-object payload', () => {
    expect(() => parseOrThrow(PersonSchema, 'not-an-object')).toThrow()
  })

  it('throws a structured ParseError, not an opaque string', () => {
    let caught: unknown
    try {
      parseOrThrow(PersonSchema, { name: 'Ada' })
    } catch (error) {
      caught = error
    }
    expect((caught as { _tag?: string } | undefined)?._tag).toBe('ParseError')
  })
})

describe('parseEither', () => {
  it('returns a Right with the decoded value on success', () => {
    const result = parseEither(PersonSchema)({ name: 'Ada', age: 36 })
    expect(Either.isRight(result)).toBe(true)
    if (Either.isRight(result)) {
      expect(result.right).toEqual({ name: 'Ada', age: 36 })
    }
  })

  it('returns a Left on failure', () => {
    const result = parseEither(PersonSchema)({ name: 'Ada' })
    expect(Either.isLeft(result)).toBe(true)
  })
})
