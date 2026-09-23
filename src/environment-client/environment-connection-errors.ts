import type {
  EnvironmentAuthorizationHttpFailure,
  EnvironmentHttpRoute,
  EnvironmentTransportFailure,
} from "@rebase/contracts";
import { Data } from "effect";

export class EnvironmentResponseError extends Data.TaggedError(
  "EnvironmentResponseError",
)<{
  readonly responseTag: EnvironmentHttpRoute["path"] | "WebSocket";
}> {}

export class EnvironmentHttpRejected<Failure> extends Data.TaggedError(
  "EnvironmentHttpRejected",
)<{
  readonly failure: Failure;
  readonly status: number;
}> {}

export class EnvironmentHelloRejected extends Data.TaggedError(
  "EnvironmentHelloRejected",
)<{
  readonly failure: EnvironmentTransportFailure;
}> {}

export type EnvironmentConnectionFailure =
  | EnvironmentHttpRejected<EnvironmentAuthorizationHttpFailure>
  | EnvironmentHelloRejected
  | EnvironmentResponseError;

export function environmentResponseError(
  responseTag: EnvironmentResponseError["responseTag"],
) {
  return new EnvironmentResponseError({ responseTag });
}
