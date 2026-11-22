import type { DesktopHostBridge } from "#contracts/desktop-host/desktop-host.contract.ts";
import {
  DesktopUpdateSnapshot,
  type DesktopUpdates,
} from "#contracts/desktop-updates/desktop-updates.contract.ts";
import {
  EnvironmentAccessFailure,
  type ExchangeEnvironmentPairing,
  environmentBrowserSessionPath,
} from "#contracts/environment-authorization/environment-authorization.contract.ts";
import {
  createLocalEnvironmentSession,
  type LocalEnvironmentSession,
  type LocalEnvironmentSessionOptions,
} from "#web/app/environment/local-environment-session.ts";
import {
  connectEnvironment,
  type EnvironmentAccess,
  type EnvironmentConnectionFailure,
  type EnvironmentCredential,
} from "#web/platform/environment/environment-connection.ts";

type DesktopEnvironmentHost = Pick<
  DesktopHostBridge,
  "environmentOrigin" | "getEnvironmentCredential"
>;

const unavailable: EnvironmentConnectionFailure = {
  _tag: "EnvironmentUnavailable",
};

export function createBrowserLocalEnvironmentSession(
  host: DesktopEnvironmentHost | undefined,
  lifetime: Pick<LocalEnvironmentSessionOptions, "invalidation"> & {
    readonly onConnect?: (access: EnvironmentAccess) => void;
  },
): LocalEnvironmentSession {
  const bootstrap = resolveLocalEnvironmentBootstrap(window.location, host);
  let pairingMaterial = bootstrap.pairingMaterial;
  return createLocalEnvironmentSession({
    invalidation: lifetime.invalidation,
    onConnect: (credential) =>
      lifetime.onConnect?.({ origin: bootstrap.environmentOrigin, credential }),
    gateway: {
      authorize: async (): Promise<EnvironmentCredential> => {
        if (host !== undefined) {
          const value = await host
            .getEnvironmentCredential()
            .catch(() => Promise.reject(unavailable));
          return { type: "bearer", value };
        }
        if (pairingMaterial !== undefined) {
          await createBrowserSession(bootstrap.environmentOrigin, {
            label: "Rebase browser",
            pairingMaterial,
          });
          pairingMaterial = undefined;
          window.history.replaceState(null, "", "/");
        }
        return { type: "browser-session" };
      },
      connect: (credential) =>
        connectEnvironment(
          bootstrap.environmentOrigin,
          credential,
          lifetime.invalidation,
        ),
    },
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

async function createBrowserSession(
  origin: string,
  exchange: ExchangeEnvironmentPairing,
) {
  const response = await fetch(new URL(environmentBrowserSessionPath, origin), {
    body: JSON.stringify(exchange),
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    method: "POST",
  }).catch(() => Promise.reject(unavailable));
  if (response.ok) {
    await response.body?.cancel();
    return;
  }
  const failure = EnvironmentAccessFailure.safeParse(
    await response.json().catch(() => undefined),
  );
  throw failure.success
    ? { _tag: "EnvironmentAccessDenied", failure: failure.data }
    : unavailable;
}

function readPairingMaterial(location: Pick<Location, "hash" | "pathname">) {
  if (location.pathname !== "/pair" || location.hash.length <= 1) {
    return undefined;
  }
  return location.hash.slice(1);
}

declare global {
  interface Window {
    readonly rebaseHost?: DesktopHostBridge;
  }
}

const decodeSnapshot = (snapshot: unknown) =>
  DesktopUpdateSnapshot.parse(snapshot);

export function readDesktopHostBridge(): DesktopHostBridge | undefined {
  const host = window.rebaseHost;
  if (host === undefined) return undefined;
  return {
    ...host,
    updates:
      host.updates === undefined
        ? undefined
        : decodedDesktopUpdates(host.updates),
  };
}

function decodedDesktopUpdates(updates: DesktopUpdates): DesktopUpdates {
  return {
    ...updates,
    getSnapshot: () => updates.getSnapshot().then(decodeSnapshot),
    subscribe: (listener) =>
      updates.subscribe((snapshot) => listener(decodeSnapshot(snapshot))),
  };
}
