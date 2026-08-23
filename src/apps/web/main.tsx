import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserLocalEnvironmentSession } from "#web/features/local-environment-session/browser-local-environment-session";
import { ApplicationShell } from "#web-ui/features/application-shell/application-shell";
import "@rebase/web/styles.css";

const rootElement = document.getElementById("root");

if (!(rootElement instanceof HTMLElement)) {
  throw new Error('The web application requires an element with id "root".');
}

const productVersion = import.meta.env.REBASE_PRODUCT_VERSION;
const session = createBrowserLocalEnvironmentSession(productVersion);
session.start();

createRoot(rootElement).render(
  <StrictMode>
    <ApplicationShell
      desktopUpdates={window.rebaseHost?.updates}
      productVersion={productVersion}
      session={session}
    />
  </StrictMode>,
);
