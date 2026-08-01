import { describe, expect, it } from 'vitest'
import { storeDefaults, storeSchema } from '../schema'

const defaultKeys = Object.keys(storeDefaults) as (keyof typeof storeDefaults)[]
const schemaKeys = Object.keys(storeSchema) as (keyof typeof storeSchema)[]

function declaredTypes(entry: (typeof storeSchema)[keyof typeof storeSchema]): string[] {
  const type = (entry as { type?: string | string[] }).type
  if (type === undefined) {
    return []
  }
  return Array.isArray(type) ? type : [type]
}

function jsonSchemaTypeOf(value: unknown): string {
  if (value === null) {
    return 'null'
  }
  if (Array.isArray(value)) {
    return 'array'
  }
  if (typeof value === 'number') {
    return 'number'
  }
  if (typeof value === 'boolean') {
    return 'boolean'
  }
  return typeof value
}

describe('store schema / defaults parity', () => {
  it('every default key has a schema entry', () => {
    for (const key of defaultKeys) {
      expect(storeSchema, `missing schema entry for "${String(key)}"`).toHaveProperty(String(key))
    }
  })

  it('every schema key has a default', () => {
    for (const key of schemaKeys) {
      expect(storeDefaults, `missing default for "${String(key)}"`).toHaveProperty(String(key))
    }
  })

  it('key sets match exactly', () => {
    expect([...schemaKeys].sort()).toEqual([...defaultKeys].sort())
  })

  it('each default value is consistent with its schema type', () => {
    for (const key of defaultKeys) {
      const entry = storeSchema[key]
      const allowedTypes = declaredTypes(entry)
      const valueType = jsonSchemaTypeOf(storeDefaults[key])
      expect(
        allowedTypes,
        `default for "${String(key)}" is ${valueType} but schema allows ${allowedTypes.join('|')}`
      ).toContain(valueType)
    }
  })

  it('nullable fields allow null and their null defaults are valid', () => {
    for (const key of ['activeWorkspace', 'workingDirectory'] as const) {
      expect(declaredTypes(storeSchema[key])).toContain('null')
      expect(storeDefaults[key]).toBeNull()
    }
  })

  it('persistedTabRepoPaths items allow null to match its [null] default', () => {
    const entry = storeSchema.persistedTabRepoPaths as {
      type?: string
      items?: { type?: string | string[] }
    }
    expect(entry.type).toBe('array')
    const itemTypes = entry.items?.type
    const itemTypeList = Array.isArray(itemTypes) ? itemTypes : itemTypes ? [itemTypes] : []
    expect(itemTypeList).toContain('null')
    expect(storeDefaults.persistedTabRepoPaths).toEqual([null])
  })

  it('listPaneWidths is an object keyed by repo path and defaults to empty', () => {
    expect(declaredTypes(storeSchema.listPaneWidths)).toContain('object')
    expect(storeDefaults.listPaneWidths).toEqual({})
  })

  it('marks nothing as required so clearInvalidConfig cannot wipe valid configs', () => {
    for (const key of schemaKeys) {
      expect(storeSchema[key]).not.toHaveProperty('required')
    }
  })
})
