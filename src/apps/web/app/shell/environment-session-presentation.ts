import type { LocalEnvironmentSessionState } from "#web/app/environment/local-environment-session.ts";
import type { EnvironmentStatus } from "#web/platform/query/environment-context.tsx";

export function environmentSessionPresentation(
  state: LocalEnvironmentSessionState,
): EnvironmentStatus {
  switch (state._tag) {
    case "PairingRequired":
      return {
        availability: "connecting",
        connectionState: state._tag,
        detail: "Open the pairing URL printed by the local Rebase process.",
        status: "Pairing required",
      };
    case "Authorizing":
      return {
        availability: "connecting",
        connectionState: state._tag,
        status: "Authorizing",
      };
    case "Connecting":
      return {
        availability: "connecting",
        connectionState: state._tag,
        status: "Connecting",
      };
    case "Connected":
      return {
        availability: "available",
        connectionState: state._tag,
        status: "Available",
      };
    case "Reconnecting":
      return {
        availability: "connecting",
        connectionState: state._tag,
        status: "Reconnecting",
      };
    case "AuthorizationFailed":
      return {
        availability: "unavailable",
        connectionState: state._tag,
        detail: authorizationFailureDetail(state),
        status: "Authorization failed",
      };
    case "ProtocolMismatch":
      return {
        availability: "unavailable",
        connectionState: state._tag,
        detail: state.message,
        status: "Protocol mismatch",
      };
  }
}

function authorizationFailureDetail(
  state: Extract<
    LocalEnvironmentSessionState,
    { readonly _tag: "AuthorizationFailed" }
  >,
) {
  const originFailure =
    state.failure.failure._tag === "InvalidHost" ||
    state.failure.failure._tag === "InvalidOrigin";
  return originFailure
    ? "Open the exact pairing URL printed by the local Rebase process."
    : "Restart Rebase and open the new pairing URL it prints.";
}
