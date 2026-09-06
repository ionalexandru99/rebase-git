import { Effect } from "effect";
import { environmentResponseError } from "#web/features/environment-connection/environment-connection-errors";
import {
  createEnvironmentBrowserSessionEffect,
  readEnvironmentBrowserSessionEffect,
} from "#web/features/environment-connection/http/environment-http-client";
import { connectCurrentEnvironmentEffect } from "#web/features/environment-connection/index";
import { listEnvironmentDirectoryEffect } from "#web/features/environment-filesystem/environment-filesystem-client";
import type { EnvironmentFilesystemGateway } from "#web/features/environment-filesystem/environment-filesystem-controller.contract";
import type { DesktopHostBridge } from "#web/features/local-environment-session/environment-bootstrap.contract";
import { createLocalEnvironmentSession } from "#web/features/local-environment-session/local-environment-session";
import type { LocalEnvironmentGateway } from "#web/features/local-environment-session/local-environment-session.contract";
import {
  listEnvironmentRepositoriesEffect,
  recordEnvironmentRepositoryOpenedEffect,
  rememberEnvironmentRepositoryEffect,
  removeEnvironmentRepositoryEffect,
} from "#web/features/repository-catalog/repository-catalog-client";
import type { RepositoryCatalogGateway } from "#web/features/repository-catalog/repository-catalog-controller.contract";
import { checkoutRepositoryRefEffect } from "#web/features/repository-refs/repository-refs-client";
import { RepositoryRefsResponseError } from "#web/features/repository-refs/repository-refs-client.contract";
import type { RepositoryRefsGateway } from "#web/features/repository-refs/repository-refs-controller.contract";
import type { RepositoryRefsTransport } from "#web/features/repository-refs/transport/repository-refs-transport.contract";

export function createBrowserLocalEnvironmentSession(productVersion: string) {
  const host = window.rebaseHost;
  const bootstrap = resolveLocalEnvironmentBootstrap(window.location, host);
  let repositoryRefs: RepositoryRefsTransport | undefined;
  const gateway: LocalEnvironmentGateway = {
    authorize: createLocalEnvironmentAuthorization(
      bootstrap.environmentOrigin,
      bootstrap.pairingMaterial,
      host,
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
    list: (credential) =>
      listEnvironmentRepositoriesEffect(
        bootstrap.environmentOrigin,
        credential,
      ),
    recordOpened: (credential, repositoryId) =>
      recordEnvironmentRepositoryOpenedEffect(
        bootstrap.environmentOrigin,
        credential,
        repositoryId,
      ),
    remember: (credential, path) =>
      rememberEnvironmentRepositoryEffect(
        bootstrap.environmentOrigin,
        credential,
        path,
      ),
    remove: (credential, repositoryId) =>
      removeEnvironmentRepositoryEffect(
        bootstrap.environmentOrigin,
        credential,
        repositoryId,
      ),
  };
  const repositoryRefsGateway: RepositoryRefsGateway = {
    checkout: (credential, command) =>
      checkoutRepositoryRefEffect(
        bootstrap.environmentOrigin,
        credential,
        command,
      ),
    read: (_credential, repositoryId) =>
      Effect.suspend(
        () =>
          repositoryRefs?.read(repositoryId) ??
          Effect.fail(new RepositoryRefsResponseError()),
      ),
  };
  const filesystemGateway: EnvironmentFilesystemGateway = {
    listDirectory: (credential, path) =>
      listEnvironmentDirectoryEffect(
        bootstrap.environmentOrigin,
        credential,
        path,
      ),
  };

  return createLocalEnvironmentSession({
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
  host: DesktopHostBridge | undefined,
): LocalEnvironmentGateway["authorize"] {
  return () =>
    Effect.gen(function* () {
      if (host !== undefined) {
        const value = yield* Effect.tryPromise({
          try: () => host.getEnvironmentCredential(),
          catch: () => environmentResponseError("Authorization"),
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
