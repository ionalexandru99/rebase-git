import type {
  EnvironmentAccessFailure,
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
}> {}

export class EnvironmentAccessDenied extends Data.TaggedError(
  "EnvironmentAccessDenied",
)<{
  readonly failure: EnvironmentAccessFailure;
  readonly status: number;
}> {}

export class EnvironmentHelloRejected extends Data.TaggedError(
  "EnvironmentHelloRejected",
)<{
  readonly failure: EnvironmentTransportFailure;
}> {}

export type EnvironmentConnectionFailure =
  | EnvironmentAccessDenied
  | EnvironmentHelloRejected
  | EnvironmentResponseError;

export function environmentResponseError(
  responseTag: EnvironmentResponseError["responseTag"],
) {
  return new EnvironmentResponseError({ responseTag });
}
