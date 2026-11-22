import { z } from "zod";
import {
  decodeHostJson,
  hostCommandOutput,
  hostGet,
  hostJsonReader,
  unavailable,
} from "#server/features/source-control/git-host.ts";

export interface AzureDevOpsClient {
  readonly version: () => Promise<string | undefined>;
  readonly account: () => Promise<string | undefined>;
  readonly accessToken: () => Promise<string>;
  readonly get: (url: string, accessToken: string) => Promise<string>;
}

const azureDevOpsResource = "499b84ac-1321-427f-aa17-267ca6975798";
const decodeVersion = decodeHostJson(z.object({ "azure-cli": z.string() }));

export function createAzureDevOpsClient(): AzureDevOpsClient {
  const az = (args: readonly string[]) =>
    hostCommandOutput("az", args, { shim: true });
  return {
    version: async () => {
      try {
        const version = decodeVersion(
          await az(["version", "--output", "json"]),
        );
        return `azure-cli ${version["azure-cli"]}`;
      } catch {
        return undefined;
      }
    },
    account: async () => {
      try {
        const output = await az([
          "account",
          "show",
          "--query",
          "user.name",
          "--output",
          "tsv",
        ]);
        return output.trim() || undefined;
      } catch {
        return undefined;
      }
    },
    accessToken: async () => {
      const token = (
        await az([
          "account",
          "get-access-token",
          "--resource",
          azureDevOpsResource,
          "--query",
          "accessToken",
          "--output",
          "tsv",
        ])
      ).trim();
      if (token === "") throw unavailable;
      return token;
    },
    get: async (url, accessToken) => {
      const { status, body } = await hostGet(url, {
        authorization: `Bearer ${accessToken}`,
      });
      if (status < 200 || status >= 300) throw unavailable;
      return body;
    },
  };
}

export function reader(client: AzureDevOpsClient, accessToken: string) {
  return hostJsonReader((url) => client.get(url, accessToken));
}
