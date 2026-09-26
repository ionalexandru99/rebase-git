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
import { Effect } from "effect";
import { connectCurrentEnvironmentEffect } from "#web/app/environment/connection/environment-protocol-client";
import { createLocalEnvironmentSession } from "#web/app/environment/local-environment-session";
import type {
  LocalEnvironmentGateway,
  LocalEnvironmentSession,
  LocalEnvironmentSessionOptions,
} from "#web/app/environment/local-environment-session.contract";

type DesktopEnvironmentHost = Pick<
  DesktopHostBridge,
  "environmentOrigin" | "getEnvironmentCredential"
>;

export function createBrowserLocalEnvironmentSession(
  productVersion: string,
  host: DesktopEnvironmentHost | undefined,
  lifetime: Pick<LocalEnvironmentSessionOptions, "runtime" | "onConnect">,
): LocalEnvironmentSession {
  const bootstrap = resolveLocalEnvironmentBootstrap(window.location, host);
  let credential: EnvironmentCredential | undefined;
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
  return createLocalEnvironmentSession({ ...lifetime, gateway, requests });
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
