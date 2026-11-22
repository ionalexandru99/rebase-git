import type { z } from "zod";
import {
  decodeHostJson,
  type HostResponse,
  hostGet,
  unavailable,
} from "#server/features/source-control/git-host.ts";

export interface BitbucketClient {
  readonly get: (
    url: string,
    authorization: string,
    timeoutMilliseconds?: number,
  ) => Promise<HostResponse>;
}

export const bitbucketApi = "https://api.bitbucket.org/2.0";

export function createBitbucketClient(): BitbucketClient {
  return {
    get: (url, authorization, timeoutMilliseconds) =>
      hostGet(url, { authorization }, timeoutMilliseconds),
  };
}

export async function readJson<Schema extends z.ZodType>(
  client: BitbucketClient,
  authorization: string,
  url: string,
  schema: Schema,
): Promise<z.output<Schema>> {
  const { status, body } = await client.get(url, authorization);
  if (status !== 200) throw unavailable;
  return decodeHostJson(schema)(body);
}
