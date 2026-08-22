import {
  connectCurrentEnvironmentEffect,
  exchangeEnvironmentPairingEffect,
} from "#web/features/environment-connection/index";
import type { EnvironmentBootstrap } from "#web/features/local-environment-session/environment-bootstrap.contract";
import { createLocalEnvironmentSession } from "#web/features/local-environment-session/local-environment-session";
import type { LocalEnvironmentGateway } from "#web/features/local-environment-session/local-environment-session.contract";

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

  return createLocalEnvironmentSession({
    gateway,
    pairingMaterial: bootstrap.pairingMaterial,
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
