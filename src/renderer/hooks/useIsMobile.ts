import { type Accessor, createSignal, onCleanup, onMount } from '@/lib/react-compat'

const MOBILE_BREAKPOINT = 768

export function useIsMobile(): Accessor<boolean> {
  const [isMobile, setIsMobile] = createSignal(false)

  onMount(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const onChange = () => setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    mql.addEventListener('change', onChange)
    onChange()
    onCleanup(() => mql.removeEventListener('change', onChange))
  })

  return isMobile
}
