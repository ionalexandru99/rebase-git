import { ServerStateProvider } from "@rebase/web/state/server/server-state-provider";
import { TechnicalShell } from "@rebase/web/technical-shell";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@rebase/web/styles.css";

const rootElement = document.getElementById("root");

if (!(rootElement instanceof HTMLElement)) {
  throw new Error('The web application requires an element with id "root".');
}

createRoot(rootElement).render(
  <StrictMode>
    <ServerStateProvider>
      <TechnicalShell />
    </ServerStateProvider>
  </StrictMode>,
);
