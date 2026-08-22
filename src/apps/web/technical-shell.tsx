import { type JSX, useSyncExternalStore } from "react";
import type {
  LocalEnvironmentSession,
  LocalEnvironmentSessionState,
} from "#web/features/local-environment-session/local-environment-session.contract";

export function TechnicalShell({
  session,
}: {
  readonly session: LocalEnvironmentSession;
}): JSX.Element {
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const status = environmentStatus(state);

  return (
    <main className="min-h-svh bg-background p-6 text-foreground">
      <h1 className="text-xl font-semibold">Rebase</h1>
      <section className="mt-4" data-connection-state={state._tag}>
        <h2 className="text-sm font-medium">{status.title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{status.detail}</p>
      </section>
    </main>
  );
}

function environmentStatus(state: LocalEnvironmentSessionState) {
  switch (state._tag) {
    case "PairingRequired":
      return {
        detail: "Open the pairing URL printed by the local Rebase process.",
        title: "Pairing required",
      };
    case "Authorizing":
      return {
        detail: "Exchanging the one-time pairing code.",
        title: "Authorizing this browser",
      };
    case "Connecting":
      return {
        detail: "Opening the local client session.",
        title: "Connecting to the local Environment",
      };
    case "Connected":
      return {
        detail: `Environment ${state.environmentId}`,
        title: "Connected to the local Environment",
      };
    case "Reconnecting":
      return {
        detail: "Keep this page open while the local Rebase process restarts.",
        title: "Reconnecting to the local Environment",
      };
    case "AuthorizationFailed":
      return authorizationFailureStatus(state);
    case "ProtocolMismatch":
      return { detail: state.message, title: "Protocol mismatch" };
  }
}

function authorizationFailureStatus(
  state: Extract<
    LocalEnvironmentSessionState,
    { readonly _tag: "AuthorizationFailed" }
  >,
) {
  const originFailure =
    state.failure.failure._tag === "InvalidHost" ||
    state.failure.failure._tag === "InvalidOrigin";
  return originFailure
    ? {
        detail:
          "Open the exact pairing URL printed by the local Rebase process.",
        title: "This browser origin was refused",
      }
    : {
        detail: "Restart Rebase and open the new pairing URL it prints.",
        title: "Authorization failed",
      };
}
