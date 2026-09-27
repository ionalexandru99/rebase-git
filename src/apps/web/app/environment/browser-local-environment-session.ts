import {
  type DesktopHostBridge,
  EnvironmentAccessFailure,
  type ExchangeEnvironmentPairing,
  environmentBrowserSessionPath,
} from "@rebase/contracts";
import { Effect, Schema } from "effect";
import {
  connectEnvironment,
  EnvironmentAccessDenied,
  type EnvironmentCredential,
  EnvironmentUnavailable,
} from "#web/app/environment/environment-connection";
import {
  createLocalEnvironmentSession,
  type LocalEnvironmentSession,
  type LocalEnvironmentSessionOptions,
} from "#web/app/environment/local-environment-session";

type DesktopEnvironmentHost = Pick<
  DesktopHostBridge,
  "environmentOrigin" | "getEnvironmentCredential"
>;

const decodeAccessFailure = Schema.decodeUnknownSync(EnvironmentAccessFailure);

export function createBrowserLocalEnvironmentSession(
  host: DesktopEnvironmentHost | undefined,
  lifetime: Pick<
    LocalEnvironmentSessionOptions,
    "runtime" | "onConnect" | "invalidation"
  >,
): LocalEnvironmentSession {
  const bootstrap = resolveLocalEnvironmentBootstrap(window.location, host);
  let pairingMaterial = bootstrap.pairingMaterial;
  return createLocalEnvironmentSession({
    ...lifetime,
    gateway: {
      authorize: () =>
        Effect.gen(function* () {
          if (host !== undefined) {
            const value = yield* Effect.tryPromise({
              try: () => host.getEnvironmentCredential(),
              catch: () => new EnvironmentUnavailable(),
            });
            return { type: "bearer", value } satisfies EnvironmentCredential;
          }
          if (pairingMaterial !== undefined) {
            yield* createBrowserSession(bootstrap.environmentOrigin, {
              label: "Rebase browser",
              pairingMaterial,
            });
            pairingMaterial = undefined;
            window.history.replaceState(null, "", "/");
          }
          return { type: "browser-session" } satisfies EnvironmentCredential;
        }),
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

function createBrowserSession(
  origin: string,
  exchange: ExchangeEnvironmentPairing,
) {
  return Effect.tryPromise({
    try: async (signal) => {
      const response = await fetch(
        new URL(environmentBrowserSessionPath, origin),
        {
          body: JSON.stringify(exchange),
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          method: "POST",
          signal,
        },
      );
      if (response.ok) {
        await response.body?.cancel();
        return undefined;
      }
      return decodeAccessFailure(await response.json());
    },
    catch: () => new EnvironmentUnavailable(),
  }).pipe(
    Effect.flatMap((failure) =>
      failure === undefined
        ? Effect.void
        : Effect.fail(new EnvironmentAccessDenied({ failure })),
    ),
  );
}

function readPairingMaterial(location: Pick<Location, "hash" | "pathname">) {
  if (location.pathname !== "/pair" || location.hash.length <= 1) {
    return undefined;
  }
  return location.hash.slice(1);
}
