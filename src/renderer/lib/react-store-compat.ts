import { useCallback, useReducer, useRef } from 'react'

type StoreSetter = (...args: unknown[]) => void

function resolveValue<T>(previous: T, value: T | ((previous: T) => T)): T {
  return typeof value === 'function' ? (value as (previous: T) => T)(previous) : value
}

function setPath(source: unknown, path: PropertyKey[], value: unknown): unknown {
  if (path.length === 0) {
    return resolveValue(source, value as never)
  }

  const [head, ...tail] = path
  const record = source as Record<PropertyKey, unknown>
  const current = record[head]
  const next = setPath(current, tail, value)
  if (Object.is(current, next)) {
    return source
  }
  const clone = Array.isArray(source) ? [...source] : { ...record }
  clone[head as never] = next as never
  return clone
}

function mergeIfChanged<T extends object>(previous: T, patch: T): T {
  let changed = false
  for (const key of Object.keys(patch) as Array<keyof T>) {
    if (!Object.is(previous[key], patch[key])) {
      changed = true
      break
    }
  }
  return changed ? { ...previous, ...patch } : previous
}

export function createStore<T extends object>(initial: T): [T, StoreSetter] {
  const stateRef = useRef<T>(initial)
  const [, forceUpdate] = useReducer((revision: number) => revision + 1, 0)

  const replaceState = (next: T) => {
    if (Object.is(stateRef.current, next)) {
      return
    }
    stateRef.current = next
    forceUpdate()
  }

  const setStore = useCallback((...args: unknown[]) => {
    if (args.length === 1) {
      const next = resolveValue(stateRef.current, args[0] as T)
      if (Object.is(stateRef.current, next)) {
        return
      }
      if (typeof next === 'object' && next !== null) {
        replaceState(mergeIfChanged(stateRef.current, next))
        return
      }
      replaceState(next)
      return
    }
    const value = args.at(-1)
    const path = args.slice(0, -1) as PropertyKey[]
    replaceState(setPath(stateRef.current, path, value) as T)
  }, [])
  return [stateRef.current, setStore as StoreSetter]
}
