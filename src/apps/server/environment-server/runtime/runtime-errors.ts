import { Data } from "effect";

export class RuntimeMarkerError extends Data.TaggedError("RuntimeMarkerError")<{
  readonly cause: unknown;
  readonly message: string;
}> {}

export class RuntimeRequirementsError extends Data.TaggedError(
  "RuntimeRequirementsError",
)<{
  readonly cause: unknown;
  readonly message: string;
}> {}
