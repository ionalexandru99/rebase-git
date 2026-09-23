import { EnvironmentHttpApi } from "@rebase/contracts";
import { Effect } from "effect";
import type { EnvironmentTransportState } from "#server/adapters/environment-transport/environment-connection.contract";
import { httpRoute } from "#server/adapters/environment-transport/http/environment-http-route-handler";

export function environmentTransportHttpRoutes(
  state: EnvironmentTransportState,
) {
  return [
    httpRoute(EnvironmentHttpApi.discovery, () =>
      Effect.succeed(state.discovery),
    ),
    httpRoute(EnvironmentHttpApi.snapshot, () =>
      Effect.sync(() => ({
        environmentId: state.discovery.environmentId,
        sequence: state.events.currentSequence(),
      })),
    ),
  ];
}
