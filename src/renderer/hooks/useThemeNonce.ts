import { useEffect, useState } from 'react'

export function useThemeNonce(): number {
  const [nonce, setNonce] = useState(0)
  useEffect(() => {
    if (typeof MutationObserver === 'undefined') return
    const observer = new MutationObserver(() => setNonce((value) => value + 1))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])
  return nonce
}
