import type { EnvironmentTransportFailure } from "@rebase/contracts";
import { Data } from "effect";

export class EnvironmentResponseError extends Data.TaggedError(
  "EnvironmentResponseError",
)<{
  readonly responseTag: "Discovery" | "Snapshot" | "WebSocket";
}> {}

export class EnvironmentHelloRejected extends Data.TaggedError(
  "EnvironmentHelloRejected",
)<{
  readonly failure: EnvironmentTransportFailure;
}> {}

export function environmentResponseError(
  responseTag: EnvironmentResponseError["responseTag"],
) {
  return new EnvironmentResponseError({ responseTag });
}
