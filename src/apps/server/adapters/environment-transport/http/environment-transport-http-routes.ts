import { EnvironmentHttpApi } from "@rebase/contracts";
import { Effect } from "effect";
import type { EnvironmentTransportState } from "#server/adapters/environment-transport/environment-connection.contract";
import { route } from "#server/adapters/environment-transport/http/environment-http-route-handler";

export function environmentTransportHttpRoutes(
  state: EnvironmentTransportState,
) {
  return [
    route(EnvironmentHttpApi.discovery, () => Effect.succeed(state.discovery)),
    route(EnvironmentHttpApi.snapshot, () =>
      Effect.sync(() => ({
        environmentId: state.discovery.environmentId,
        sequence: state.events.currentSequence(),
      })),
    ),
  ];
}
