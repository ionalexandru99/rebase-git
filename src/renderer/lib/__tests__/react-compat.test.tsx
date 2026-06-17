import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { createSignal, For, Show } from '@/lib/react-compat'

describe('createSignal', () => {
  it('does not re-render when the setter receives the current value', () => {
    const renders = vi.fn()
    function Counter() {
      const [count, setCount] = createSignal(0)
      renders()
      return (
        <button type="button" onClick={() => setCount(count())}>
          {count()}
        </button>
      )
    }
    render(<Counter />)
    const before = renders.mock.calls.length
    fireEvent.click(screen.getByRole('button'))
    expect(renders.mock.calls.length).toBe(before)
  })

  it('re-renders and applies a functional update when the value changes', () => {
    function Counter() {
      const [count, setCount] = createSignal(0)
      return (
        <button type="button" onClick={() => setCount((previous) => (previous ?? 0) + 1)}>
          {count()}
        </button>
      )
    }
    render(<Counter />)
    const button = screen.getByRole('button')
    expect(button).toHaveTextContent('0')
    fireEvent.click(button)
    expect(button).toHaveTextContent('1')
  })
})

describe('For', () => {
  it('renders a child per item, deriving keys from id', () => {
    const items = [
      { id: 'a', label: 'Alpha' },
      { id: 'b', label: 'Beta' }
    ]
    render(
      <ul>
        <For each={items}>{(item) => <li>{item.label}</li>}</For>
      </ul>
    )
    expect(screen.getByText('Alpha')).toBeInTheDocument()
    expect(screen.getByText('Beta')).toBeInTheDocument()
  })

  it('renders the fallback for an empty list', () => {
    render(
      <For each={[]} fallback={<span>empty</span>}>
        {(item: { label: string }) => <span>{item.label}</span>}
      </For>
    )
    expect(screen.getByText('empty')).toBeInTheDocument()
  })

  it('renders the fallback for a missing list', () => {
    render(
      <For each={null} fallback={<span>empty</span>}>
        {(item: { label: string }) => <span>{item.label}</span>}
      </For>
    )
    expect(screen.getByText('empty')).toBeInTheDocument()
  })
})

describe('Show', () => {
  it('renders children when truthy and fallback when falsy', () => {
    const { rerender } = render(
      <Show when={'x'} fallback={<span>nope</span>}>
        <span>yep</span>
      </Show>
    )
    expect(screen.getByText('yep')).toBeInTheDocument()
    rerender(
      <Show when={null} fallback={<span>nope</span>}>
        <span>yep</span>
      </Show>
    )
    expect(screen.getByText('nope')).toBeInTheDocument()
  })

  it('passes the narrowed value to a render-prop child', () => {
    render(
      <Show when={{ name: 'Rebase' }} fallback={null}>
        {(value) => <span>{value().name}</span>}
      </Show>
    )
    expect(screen.getByText('Rebase')).toBeInTheDocument()
  })
})
