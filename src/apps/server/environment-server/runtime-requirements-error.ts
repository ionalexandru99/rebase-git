import { Data } from "effect";

export class RuntimeRequirementsError extends Data.TaggedError(
  "RuntimeRequirementsError",
)<{
  readonly cause: unknown;
  readonly message: string;
}> {}
