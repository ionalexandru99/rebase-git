import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../renderer/index.css'
import {
  createDocumentRebaseClient,
  type RebaseClient,
  RebaseServerApp
} from './features/server-connection'

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
