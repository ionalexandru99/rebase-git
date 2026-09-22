import { Data } from "effect";

export class EnvironmentHttpResponseError extends Data.TaggedError(
  "EnvironmentHttpResponseError",
) {}

export class EnvironmentHttpRejected<Failure> extends Data.TaggedError(
  "EnvironmentHttpRejected",
)<{
  readonly failure: Failure;
  readonly status: number;
}> {}
