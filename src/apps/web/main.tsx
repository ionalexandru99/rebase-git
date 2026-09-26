import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { Layer, ManagedRuntime } from "effect";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserLocalEnvironmentSession } from "#web/app/environment/browser-local-environment-session";
import { readDesktopHostBridge } from "#web/app/environment/desktop-host-bridge";
import { ApplicationShell } from "#web/app/shell/application-shell";
import { NotificationsProvider } from "#web/features/notifications/notifications";
import { createRepositoryHistoryGateway } from "#web/features/repository-history/transport/repository-history-gateway";
import { ApplicationRuntime } from "#web/platform/effect/application-runtime-context";
import { createEnvironmentQueryClient } from "#web/platform/query/environment-query-client";
import { createEnvironmentQueryPersistence } from "#web/platform/query/environment-query-persistence";
import "@rebase/web/styles.css";

const rootElement = document.getElementById("root");

if (!(rootElement instanceof HTMLElement)) {
  throw new Error('The web application requires an element with id "root".');
}

const productVersion = import.meta.env.REBASE_PRODUCT_VERSION;
const desktopHost = readDesktopHostBridge();
const runtime = ManagedRuntime.make(Layer.empty);
const repositoryHistory = createRepositoryHistoryGateway();
const session = createBrowserLocalEnvironmentSession(
  productVersion,
  desktopHost,
  { runtime, onConnect: repositoryHistory.connect },
);
session.start();
const queryClient = createEnvironmentQueryClient();
const queryPersistence = createEnvironmentQueryPersistence();

createRoot(rootElement).render(
  <StrictMode>
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={queryPersistence}
    >
      <ApplicationRuntime value={runtime}>
        <NotificationsProvider>
          <ApplicationShell
            desktopUpdates={desktopHost?.updates}
            productVersion={productVersion}
            repositoryFilesystem={desktopHost}
            repositoryHistory={repositoryHistory.gateway}
            session={session}
          />
        </NotificationsProvider>
      </ApplicationRuntime>
    </PersistQueryClientProvider>
  </StrictMode>,
);
