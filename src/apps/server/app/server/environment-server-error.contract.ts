import { Data } from "effect";

export class EnvironmentServerStartError extends Data.TaggedError(
  "EnvironmentServerStartError",
)<{
  readonly cause: unknown;
  readonly message: string;
}> {}
