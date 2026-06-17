import type * as React from 'react'
import {
  type ComponentType,
  createContext,
  Fragment,
  type HTMLAttributes,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState
} from 'react'

export type Accessor<T> = () => T
export type Component<P = Record<string, never>> = ComponentType<P>

export namespace JSX {
  export type Element = React.ReactNode
  export type HTMLAttributes<T> = React.HTMLAttributes<T>
  export type InputHTMLAttributes<T> = React.InputHTMLAttributes<T>
  export type TextareaHTMLAttributes<T> = React.TextareaHTMLAttributes<T>
  export type CSSProperties = React.CSSProperties & Record<`--${string}`, string | number>
  export type ButtonHTMLAttributes<T> = React.ButtonHTMLAttributes<T>
  export type EventHandler<T extends React.SyntheticEvent = React.SyntheticEvent> = (
    event: T
  ) => void
}

type Setter<T> = (value: T | ((previous: T) => T)) => void

const cleanupStack: Array<(cleanup: () => void) => void> = []

function resolveSetterValue<T>(previous: T, value: T | ((previous: T) => T)): T {
  return typeof value === 'function' ? (value as (previous: T) => T)(previous) : value
}

export function createSignal<T>(initial: T): [Accessor<T>, Setter<T>]
export function createSignal<T = undefined>(): [Accessor<T | undefined>, Setter<T | undefined>]
export function createSignal<T>(initial?: T): [Accessor<T | undefined>, Setter<T | undefined>] {
  // Test harnesses create standalone signals outside any React render (e.g. a `tabActive` toggle
  // passed into a store under test). When no hook dispatcher is active `useState` throws, so fall
  // back to a plain closure-backed signal for those call sites.
  try {
    const [value, setValueState] = useState(initial)
    const valueRef = useRef(value)
    valueRef.current = value
    const read = useCallback(() => valueRef.current, [])
    const write = useCallback(
      (next: T | undefined | ((previous: T | undefined) => T | undefined)) => {
        const resolved = resolveSetterValue(valueRef.current, next)
        if (Object.is(valueRef.current, resolved)) {
          return
        }
        valueRef.current = resolved
        setValueState(resolved)
      },
      []
    )
    return [read, write]
  } catch {
    let value = initial
    return [
      () => value,
      (next) => {
        value = resolveSetterValue(value, next)
      }
    ]
  }
}

export function createMemo<T>(compute: () => T): Accessor<T> {
  const value = compute()
  return useCallback(() => value, [value])
}

export function createEffect(effect: () => void | (() => void)): void {
  useEffect(() => {
    const cleanups: Array<() => void> = []
    cleanupStack.push((cleanup) => cleanups.push(cleanup))
    const returned = effect()
    cleanupStack.pop()
    return () => {
      if (typeof returned === 'function') {
        returned()
      }
      for (const cleanup of cleanups) {
        cleanup()
      }
    }
  })
}

export function onMount(effect: () => void | (() => void)): void {
  useEffect(() => {
    const cleanups: Array<() => void> = []
    cleanupStack.push((cleanup) => cleanups.push(cleanup))
    const returned = effect()
    cleanupStack.pop()
    return () => {
      if (typeof returned === 'function') {
        returned()
      }
      for (const cleanup of cleanups) {
        cleanup()
      }
    }
  }, [])
}

export function onCleanup(cleanup: () => void): void {
  cleanupStack.at(-1)?.(cleanup)
}

export function untrack<T>(read: () => T): T {
  return read()
}

export function splitProps<T extends object, K extends keyof T>(
  props: T,
  keys: readonly K[]
): [Pick<T, K>, Omit<T, K>] {
  const local = {} as Pick<T, K>
  const rest = { ...props } as T
  for (const key of keys) {
    local[key] = props[key]
    delete rest[key]
  }
  return [local, rest as Omit<T, K>]
}

export function Show<T>(props: {
  when: T | false | null | undefined
  fallback?: ReactNode
  children: ReactNode | ((value: () => NonNullable<T>) => ReactNode)
}) {
  if (!props.when) {
    return <>{props.fallback ?? null}</>
  }
  return (
    <>
      {typeof props.children === 'function'
        ? props.children(() => props.when as NonNullable<T>)
        : props.children}
    </>
  )
}

export function For<T>(props: {
  each: readonly T[] | undefined | null
  fallback?: ReactNode
  children: (item: T, index: () => number) => ReactNode
}) {
  const items = props.each ?? []
  if (items.length === 0) {
    return <>{props.fallback ?? null}</>
  }
  return (
    <>
      {items.map((item, index) => {
        const key =
          item && typeof item === 'object' && 'id' in item ? (item.id as React.Key) : index
        return <Fragment key={key}>{props.children(item, () => index)}</Fragment>
      })}
    </>
  )
}

export function Dynamic<P extends object>(props: { component: ComponentType<P> } & P) {
  const { component: Component, ...rest } = props
  return <Component {...(rest as P)} />
}

export function Match(props: { when: boolean; children?: ReactNode }) {
  return <>{props.when ? props.children : null}</>
}

export function Switch(props: { children?: ReactNode }) {
  return <>{props.children}</>
}

export type ParentProps = { children?: ReactNode }
export type ComponentProps<T extends React.ElementType> = React.ComponentPropsWithoutRef<T>
export type DivProps = HTMLAttributes<HTMLDivElement>
export { createContext, useContext }
