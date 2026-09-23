import type {
  EnvironmentFilesystemHttpApi,
  EnvironmentFilesystemHttpFailure,
} from "@rebase/contracts";
import type { EnvironmentHttpRoutesClient } from "@rebase/environment-client";
import { Data } from "effect";

export class EnvironmentFilesystemResponseError extends Data.TaggedError(
  "EnvironmentFilesystemResponseError",
) {}

export class EnvironmentFilesystemRejected extends Data.TaggedError(
  "EnvironmentFilesystemRejected",
)<{
  readonly failure: EnvironmentFilesystemHttpFailure;
  readonly status: number;
}> {}

export type EnvironmentFilesystemClientError =
  | EnvironmentFilesystemRejected
  | EnvironmentFilesystemResponseError;

export type EnvironmentFilesystemClient = EnvironmentHttpRoutesClient<
  typeof EnvironmentFilesystemHttpApi,
  EnvironmentFilesystemClientError
>;
