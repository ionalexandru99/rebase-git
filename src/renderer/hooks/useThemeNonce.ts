import { type Accessor, createSignal, onCleanup, onMount } from 'solid-js'

export function useThemeNonce(): Accessor<number> {
  const [nonce, setNonce] = createSignal(0)

  onMount(() => {
    if (typeof MutationObserver === 'undefined') {
      return
    }
    const observer = new MutationObserver(() => setNonce((value) => value + 1))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    onCleanup(() => observer.disconnect())
  })

  return nonce
}
