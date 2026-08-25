import {
  connectCurrentEnvironmentEffect,
  exchangeEnvironmentPairingEffect,
} from "#web/features/environment-connection/index";
import { listEnvironmentDirectoryEffect } from "#web/features/environment-filesystem/environment-filesystem-client";
import type { EnvironmentFilesystemGateway } from "#web/features/environment-filesystem/environment-filesystem-controller.contract";
import type { EnvironmentBootstrap } from "#web/features/local-environment-session/environment-bootstrap.contract";
import { createLocalEnvironmentSession } from "#web/features/local-environment-session/local-environment-session";
import type { LocalEnvironmentGateway } from "#web/features/local-environment-session/local-environment-session.contract";
import {
  listEnvironmentRepositoriesEffect,
  recordEnvironmentRepositoryOpenedEffect,
  rememberEnvironmentRepositoryEffect,
  removeEnvironmentRepositoryEffect,
} from "#web/features/repository-catalog/repository-catalog-client";
import type { RepositoryCatalogGateway } from "#web/features/repository-catalog/repository-catalog-controller.contract";

export function createBrowserLocalEnvironmentSession(productVersion: string) {
  const bootstrap = resolveLocalEnvironmentBootstrap(
    window.location,
    window.rebaseHost,
  );
  const gateway: LocalEnvironmentGateway = {
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
    exchangePairing: (material) =>
      exchangeEnvironmentPairingEffect(bootstrap.environmentOrigin, {
        label: "Rebase browser",
        pairingMaterial: material,
      }),
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
    pairingMaterial: bootstrap.pairingMaterial,
    repositoryCatalogGateway,
    ...(window.rebaseHost === undefined
      ? { pairingSucceeded: clearPairingMaterial }
      : {}),
  });
}

export function resolveLocalEnvironmentBootstrap(
  location: Pick<Location, "hash" | "origin" | "pathname">,
  host: EnvironmentBootstrap | undefined,
) {
  if (host !== undefined) return host;

  return {
    environmentOrigin: location.origin,
    pairingMaterial: readPairingMaterial(location),
  };
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
