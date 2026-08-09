import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../renderer/index.css'
import type { RebaseClient } from './features/server-connection'
import { createDocumentRebaseClient } from './features/server-connection'
import { RebaseServerApp } from './RebaseServerApp'

export async function startRuntimeRenderer(
  container: HTMLElement,
  client: RebaseClient = createDocumentRebaseClient(document)
): Promise<void> {
  createRoot(container).render(
    <StrictMode>
      <RebaseServerApp client={client} />
    </StrictMode>
  )
}
