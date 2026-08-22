import {
  connectCurrentEnvironment,
  exchangeEnvironmentPairing,
} from "#web/features/environment-connection/index";
import { createLocalEnvironmentSession } from "#web/features/local-environment-session/local-environment-session";
import type { LocalEnvironmentGateway } from "#web/features/local-environment-session/local-environment-session.contract";

export function createBrowserLocalEnvironmentSession(productVersion: string) {
  const origin = window.location.origin;
  const pairingMaterial = readPairingMaterial(window.location);
  const gateway: LocalEnvironmentGateway = {
    connect: (credential, lastObservedSequence, signal) =>
      connectCurrentEnvironment(origin, productVersion, {
        credential,
        ...(lastObservedSequence === undefined ? {} : { lastObservedSequence }),
        signal,
      }),
    exchangePairing: (material, signal) =>
      exchangeEnvironmentPairing(
        origin,
        { label: "Rebase browser", pairingMaterial: material },
        signal,
      ),
  };

  return createLocalEnvironmentSession({
    gateway,
    pairingMaterial,
    pairingSucceeded: clearPairingMaterial,
  });
}

function readPairingMaterial(location: Location) {
  if (location.pathname !== "/pair" || location.hash.length <= 1) {
    return undefined;
  }
  return location.hash.slice(1);
}

function clearPairingMaterial() {
  window.history.replaceState(null, "", "/");
}
