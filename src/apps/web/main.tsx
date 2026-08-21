import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { TechnicalShell } from "#web-ui/technical-shell";
import "@rebase/web/styles.css";

const rootElement = document.getElementById("root");

if (!(rootElement instanceof HTMLElement)) {
  throw new Error('The web application requires an element with id "root".');
}

createRoot(rootElement).render(
  <StrictMode>
    <TechnicalShell />
  </StrictMode>,
);
