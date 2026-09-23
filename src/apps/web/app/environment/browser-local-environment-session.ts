import {
  type DesktopHostBridge,
  EnvironmentAuthorizationHttpApi,
} from "@rebase/contracts";
import type { EnvironmentCredential } from "@rebase/environment-client";
import {
  createEnvironmentBrowserSessionEffect,
  createEnvironmentRequestClient,
  environmentResponseError,
  readEnvironmentBrowserSessionEffect,
} from "@rebase/environment-client";
import { Effect, Layer, ManagedRuntime } from "effect";
import { connectCurrentEnvironmentEffect } from "#web/app/environment/connection/index";
import { createLocalEnvironmentSession } from "#web/app/environment/local-environment-session";
import type {
  ConnectedFeature,
  LocalEnvironmentGateway,
} from "#web/app/environment/local-environment-session.contract";
import { environmentFilesystemClient } from "#web/features/environment-filesystem/environment-filesystem-client";
import type { EnvironmentFilesystemClient } from "#web/features/environment-filesystem/environment-filesystem-client.contract";
import { createEnvironmentFilesystemController } from "#web/features/environment-filesystem/environment-filesystem-controller";
import type { EnvironmentFilesystemGateway } from "#web/features/environment-filesystem/environment-filesystem-controller.contract";
import { repositoryCatalogClient } from "#web/features/repository-catalog/repository-catalog-client";
import type { RepositoryCatalogClient } from "#web/features/repository-catalog/repository-catalog-client.contract";
import { createRepositoryCatalogController } from "#web/features/repository-catalog/repository-catalog-controller";
import type { RepositoryCatalogGateway } from "#web/features/repository-catalog/repository-catalog-controller.contract";
import { createRepositoryHistoryGateway } from "#web/features/repository-history/transport/repository-history-gateway";
import { repositoryRefsClient } from "#web/features/repository-refs/repository-refs-client";
import { createRepositoryRefsController } from "#web/features/repository-refs/repository-refs-controller";
import type { RepositoryRefsController } from "#web/features/repository-refs/repository-refs-controller.contract";
import { createRepositoryRefsGateway } from "#web/features/repository-refs/transport/repository-refs-gateway";

type DesktopEnvironmentHost = Pick<
  DesktopHostBridge,
  "environmentOrigin" | "getEnvironmentCredential"
>;

export function createBrowserLocalEnvironmentSession(
  productVersion: string,
  host: DesktopEnvironmentHost | undefined,
) {
  const bootstrap = resolveLocalEnvironmentBootstrap(window.location, host);
  let credential: EnvironmentCredential | undefined;
  const runtime = ManagedRuntime.make(Layer.empty);
  const requests = createEnvironmentRequestClient(
    bootstrap.environmentOrigin,
    () => credential,
  );
  const gateway: LocalEnvironmentGateway = {
    authorize: () =>
      createLocalEnvironmentAuthorization(
        bootstrap.environmentOrigin,
        bootstrap.pairingMaterial,
        host,
      )().pipe(
        Effect.tap((authorized) =>
          Effect.sync(() => {
            credential = authorized;
          }),
        ),
      ),
    connect: (credential, lastObservedSequence) =>
      connectCurrentEnvironmentEffect(
        bootstrap.environmentOrigin,
        productVersion,
        {
          credential,
          ...(lastObservedSequence === undefined
            ? {}
            : { lastObservedSequence }),
        },
      ),
  };
  const repositoryCatalog = createRepositoryCatalogController(
    createRepositoryCatalogGateway(repositoryCatalogClient(requests)),
    runtime,
  );
  const repositoryHistory = createRepositoryHistoryGateway();
  const repositoryRefs = createRepositoryRefsGateway(
    repositoryRefsClient(requests),
  );
  const repositoryRefsController = createRepositoryRefsController(
    repositoryRefs.gateway,
  );

  return createLocalEnvironmentSession({
    controllers: {
      filesystem: createEnvironmentFilesystemController(
        createEnvironmentFilesystemGateway(
          environmentFilesystemClient(requests),
        ),
      ),
      repositoryCatalog: repositoryCatalog.controller,
      repositoryHistory: repositoryHistory.gateway,
      repositoryRefs: repositoryRefsController,
    },
    features: [
      { connect: repositoryHistory.connect },
      connectedRepositoryRefs(repositoryRefs, repositoryRefsController),
      connectedRepositoryCatalog(repositoryCatalog),
    ],
    gateway,
    requests,
    runtime,
  });
}

function connectedRepositoryRefs(
  refs: ReturnType<typeof createRepositoryRefsGateway>,
  controller: RepositoryRefsController,
): ConnectedFeature {
  return {
    connect: (connection) =>
      refs
        .connect(connection)
        .pipe(Effect.andThen(Effect.sync(controller.invalidate))),
    invalidate: controller.invalidate,
  };
}

function connectedRepositoryCatalog(
  catalog: ReturnType<typeof createRepositoryCatalogController>,
): ConnectedFeature {
  return {
    connect: () =>
      catalog
        .connect()
        .pipe(
          Effect.andThen(
            Effect.promise(() =>
              catalog.controller.refresh().catch(() => undefined),
            ),
          ),
        ),
  };
}

function createRepositoryCatalogGateway(
  catalog: RepositoryCatalogClient,
): RepositoryCatalogGateway {
  return {
    list: () => catalog.list().pipe(Effect.map((it) => it.repositories)),
    recordOpened: (repositoryId) => catalog.recordOpened({ repositoryId }),
    remember: (path) => catalog.remember({ path }),
    remove: (repositoryId) => catalog.remove({ repositoryId }),
  };
}

function createEnvironmentFilesystemGateway(
  filesystem: EnvironmentFilesystemClient,
): EnvironmentFilesystemGateway {
  return {
    listDirectory: (path) =>
      filesystem.listDirectory(path === undefined ? {} : { path }),
  };
}

export function resolveLocalEnvironmentBootstrap(
  location: Pick<Location, "hash" | "origin" | "pathname">,
  host: Pick<DesktopHostBridge, "environmentOrigin"> | undefined,
) {
  return {
    environmentOrigin: host?.environmentOrigin ?? location.origin,
    pairingMaterial:
      host === undefined ? readPairingMaterial(location) : undefined,
  };
}

function createLocalEnvironmentAuthorization(
  origin: string,
  pairingMaterial: string | undefined,
  host: DesktopEnvironmentHost | undefined,
): LocalEnvironmentGateway["authorize"] {
  return () =>
    Effect.gen(function* () {
      if (host !== undefined) {
        const value = yield* Effect.tryPromise({
          try: () => host.getEnvironmentCredential(),
          catch: () =>
            environmentResponseError(
              EnvironmentAuthorizationHttpApi.exchangePairing.path,
            ),
        });
        return { type: "bearer" as const, value };
      }
      if (pairingMaterial !== undefined) {
        yield* createEnvironmentBrowserSessionEffect(origin, {
          label: "Rebase browser",
          pairingMaterial,
        });
        pairingMaterial = undefined;
        clearPairingMaterial();
      }
      yield* readEnvironmentBrowserSessionEffect(origin);
      return { type: "browser-session" as const };
    });
}

function readPairingMaterial(location: Pick<Location, "hash" | "pathname">) {
  if (location.pathname !== "/pair" || location.hash.length <= 1) {
    return undefined;
  }
  return location.hash.slice(1);
}

function clearPairingMaterial() {
  window.history.replaceState(null, "", "/");
}
