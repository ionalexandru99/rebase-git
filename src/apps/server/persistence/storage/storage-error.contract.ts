import { Data } from "effect";

export class EnvironmentStorageError extends Data.TaggedError(
  "EnvironmentStorageError",
)<{
  readonly cause: unknown;
  readonly message: string;
}> {}
