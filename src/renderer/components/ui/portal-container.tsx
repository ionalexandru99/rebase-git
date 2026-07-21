import { createContext, type ReactNode, useContext } from 'react'

const PortalContainerContext = createContext<Element | null>(null)

export function PortalContainerProvider(props: { container: Element | null; children: ReactNode }) {
  return (
    <PortalContainerContext.Provider value={props.container}>
      {props.children}
    </PortalContainerContext.Provider>
  )
}

export function usePortalContainer(): Element {
  return useContext(PortalContainerContext) ?? document.body
}
