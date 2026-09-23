import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserLocalEnvironmentSession } from "#web/app/environment/browser-local-environment-session";
import { readDesktopHostBridge } from "#web/app/environment/desktop-host-bridge";
import { NotificationsProvider } from "#web/features/notifications/index";
import { ApplicationShell } from "#web-ui/app/shell/application-shell";
import "@rebase/web/styles.css";

const rootElement = document.getElementById("root");

if (!(rootElement instanceof HTMLElement)) {
  throw new Error('The web application requires an element with id "root".');
}

const productVersion = import.meta.env.REBASE_PRODUCT_VERSION;
const desktopHost = readDesktopHostBridge();
const session = createBrowserLocalEnvironmentSession(
  productVersion,
  desktopHost,
);
session.start();

createRoot(rootElement).render(
  <StrictMode>
    <NotificationsProvider>
      <ApplicationShell
        desktopUpdates={desktopHost?.updates}
        productVersion={productVersion}
        repositoryFilesystem={desktopHost}
        session={session}
      />
    </NotificationsProvider>
  </StrictMode>,
);
