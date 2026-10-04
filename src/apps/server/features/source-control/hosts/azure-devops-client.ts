import { Effect, Schema } from "effect";
import type { PullRequestsUnavailable } from "#contracts/pull-requests/pull-requests.contract.ts";
import {
  hostCommandOutput,
  hostGet,
  unavailable,
} from "#server/features/source-control/git-host.ts";

export interface AzureDevOpsClient {
  readonly version: Effect.Effect<string | undefined>;
  readonly account: Effect.Effect<string | undefined>;
  readonly accessToken: Effect.Effect<string, PullRequestsUnavailable>;
  readonly get: (
    url: string,
    accessToken: string,
  ) => Effect.Effect<string, PullRequestsUnavailable>;
}

const azureDevOpsResource = "499b84ac-1321-427f-aa17-267ca6975798";

export function createAzureDevOpsClient(): AzureDevOpsClient {
  const az = (args: readonly string[]) =>
    hostCommandOutput("az", args, { shim: true });
  return {
    version: az(["version", "--output", "json"]).pipe(
      Effect.flatMap(
        Schema.decodeUnknownEffect(
          Schema.fromJsonString(Schema.Struct({ "azure-cli": Schema.String })),
        ),
      ),
      Effect.map((version) => `azure-cli ${version["azure-cli"]}`),
      Effect.orElseSucceed(() => undefined),
    ),
    account: az([
      "account",
      "show",
      "--query",
      "user.name",
      "--output",
      "tsv",
    ]).pipe(
      Effect.map((output) => output.trim() || undefined),
      Effect.orElseSucceed(() => undefined),
    ),
    accessToken: az([
      "account",
      "get-access-token",
      "--resource",
      azureDevOpsResource,
      "--query",
      "accessToken",
      "--output",
      "tsv",
    ]).pipe(
      Effect.map((output) => output.trim()),
      Effect.filterOrFail(
        (token) => token !== "",
        () => unavailable,
      ),
    ),
    get: (url, accessToken) =>
      hostGet(url, { authorization: `Bearer ${accessToken}` }).pipe(
        Effect.flatMap(({ status, body }) =>
          status >= 200 && status < 300
            ? Effect.succeed(body)
            : Effect.fail(unavailable),
        ),
      ),
  };
}

export function reader(client: AzureDevOpsClient, accessToken: string) {
  return <A>(
    url: string,
    decode: (output: string) => Effect.Effect<A, unknown>,
  ) =>
    client.get(url, accessToken).pipe(
      Effect.flatMap(decode),
      Effect.mapError(() => unavailable),
    );
}
