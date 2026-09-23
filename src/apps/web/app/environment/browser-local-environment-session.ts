import { EnvironmentAuthorizationHttpApi } from "@rebase/contracts";
import type { EnvironmentCredential } from "@rebase/environment-client";
import {
  createEnvironmentBrowserSessionEffect,
  createEnvironmentRequestClient,
  environmentResponseError,
  readEnvironmentBrowserSessionEffect,
} from "@rebase/environment-client";
import { Effect } from "effect";
import { connectCurrentEnvironmentEffect } from "#web/app/environment/connection/index";
import type {
  DesktopEnvironmentHost,
  DesktopHostBridge,
} from "#web/app/environment/environment-bootstrap.contract";
import { createLocalEnvironmentSession } from "#web/app/environment/local-environment-session";
import type { LocalEnvironmentGateway } from "#web/app/environment/local-environment-session.contract";
import { environmentFilesystemClient } from "#web/features/environment-filesystem/environment-filesystem-client";
import type { EnvironmentFilesystemGateway } from "#web/features/environment-filesystem/environment-filesystem-controller.contract";
import { repositoryCatalogClient } from "#web/features/repository-catalog/repository-catalog-client";
import type { RepositoryCatalogGateway } from "#web/features/repository-catalog/repository-catalog-controller.contract";
import { repositoryRefsClient } from "#web/features/repository-refs/repository-refs-client";
import { RepositoryRefsResponseError } from "#web/features/repository-refs/repository-refs-client.contract";
import type { RepositoryRefsGateway } from "#web/features/repository-refs/repository-refs-controller.contract";
import type { RepositoryRefsTransport } from "#web/features/repository-refs/transport/repository-refs-transport.contract";

export function createBrowserLocalEnvironmentSession(
  productVersion: string,
  host: DesktopEnvironmentHost | undefined,
) {
  const bootstrap = resolveLocalEnvironmentBootstrap(window.location, host);
  let repositoryRefs: RepositoryRefsTransport | undefined;
  let credential: EnvironmentCredential | undefined;
  const requests = createEnvironmentRequestClient(
    bootstrap.environmentOrigin,
    () => credential,
  );
  const catalog = repositoryCatalogClient(requests);
  const refs = repositoryRefsClient(requests);
  const filesystem = environmentFilesystemClient(requests);
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
      ).pipe(
        Effect.tap((connection) =>
          Effect.sync(() => {
            repositoryRefs = connection.repositoryRefs;
          }),
        ),
      ),
  };
  const repositoryCatalogGateway: RepositoryCatalogGateway = {
    list: () => catalog.list().pipe(Effect.map((it) => it.repositories)),
    recordOpened: (_credential, repositoryId) =>
      catalog.recordOpened({ repositoryId }),
    remember: (_credential, path) => catalog.remember({ path }),
    remove: (_credential, repositoryId) => catalog.remove({ repositoryId }),
  };
  const repositoryRefsGateway: RepositoryRefsGateway = {
    checkout: (_credential, command) => refs.checkout(command),
    read: (_credential, repositoryId) =>
      Effect.suspend(
        () =>
          repositoryRefs?.read(repositoryId) ??
          Effect.fail(new RepositoryRefsResponseError()),
      ),
  };
  const filesystemGateway: EnvironmentFilesystemGateway = {
    listDirectory: (_credential, path) =>
      filesystem.listDirectory(path === undefined ? {} : { path }),
  };

  return createLocalEnvironmentSession({
    requests,
    filesystemGateway,
    gateway,
    repositoryCatalogGateway,
    repositoryRefsGateway,
  });
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
