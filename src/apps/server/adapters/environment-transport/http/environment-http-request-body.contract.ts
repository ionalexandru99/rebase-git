import type { EnvironmentHttpFailure } from "@rebase/contracts";
import { Data } from "effect";

export class EnvironmentHttpBodyError extends Data.TaggedError(
  "EnvironmentHttpBodyError",
)<{
  readonly failure: EnvironmentHttpFailure;
}> {}
