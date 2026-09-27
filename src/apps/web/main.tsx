import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import {
  createBrowserLocalEnvironmentSession,
  readDesktopHostBridge,
} from "#web/app/environment/browser-local-environment-session.ts";
import { ApplicationShell } from "#web/app/shell/application-shell.tsx";
import { NotificationsProvider } from "#web/features/notifications/notifications.tsx";
import { connectRepositoryHistory } from "#web/features/repository-history/repository-history.ts";
import { createEnvironmentInvalidation } from "#web/platform/query/environment-invalidation.ts";
import { createEnvironmentQueryClient } from "#web/platform/query/environment-query.ts";
import { createEnvironmentQueryPersistence } from "#web/platform/query/environment-query-persistence.ts";
import "#web/styles.css";

const rootElement = document.getElementById("root");

if (!(rootElement instanceof HTMLElement)) {
  throw new Error('The web application requires an element with id "root".');
}

const productVersion = import.meta.env.REBASE_PRODUCT_VERSION;
const desktopHost = readDesktopHostBridge();
const queryClient = createEnvironmentQueryClient();
const session = createBrowserLocalEnvironmentSession(desktopHost, {
  onConnect: connectRepositoryHistory,
  invalidation: createEnvironmentInvalidation(queryClient),
});
session.start();
const queryPersistence = createEnvironmentQueryPersistence();

createRoot(rootElement).render(
  <StrictMode>
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={queryPersistence}
    >
      <NotificationsProvider>
        <ApplicationShell
          desktopUpdates={desktopHost?.updates}
          productVersion={productVersion}
          repositoryFilesystem={desktopHost}
          session={session}
        />
      </NotificationsProvider>
    </PersistQueryClientProvider>
  </StrictMode>,
);
