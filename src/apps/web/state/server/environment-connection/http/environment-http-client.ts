import {
  currentClientReceiveLimits,
  EnvironmentDiscovery,
  EnvironmentHttpApi,
  type EnvironmentSnapshot,
  EnvironmentSnapshot as EnvironmentSnapshotSchema,
} from "@rebase/contracts";
import {
  type EnvironmentResponseError,
  environmentResponseError,
} from "@rebase/web/state/server/environment-connection/environment-connection-errors";
import { Schema } from "effect";

export async function fetchEnvironmentDiscovery(
  origin: string,
  signal?: AbortSignal,
) {
  const response = await fetch(
    new URL(EnvironmentHttpApi.discovery.path, normalizeOrigin(origin)),
    { method: EnvironmentHttpApi.discovery.method, signal: signal ?? null },
  );
  if (!response.ok) {
    throw environmentResponseError("Discovery");
  }

  return decodeResponse(
    response,
    EnvironmentDiscovery,
    currentClientReceiveLimits.maxHttpResponseBytes,
    "Discovery",
  );
}

export async function fetchEnvironmentSnapshot(
  origin: string,
  discovery: EnvironmentDiscovery,
  signal?: AbortSignal,
): Promise<EnvironmentSnapshot> {
  return fetchEnvironmentSnapshotWithinLimit(
    origin,
    discovery,
    Math.min(
      discovery.limits.maxHttpResponseBytes,
      currentClientReceiveLimits.maxHttpResponseBytes,
    ),
    signal,
  );
}

export async function fetchEnvironmentSnapshotWithinLimit(
  origin: string,
  discovery: EnvironmentDiscovery,
  maxResponseBytes: number,
  signal?: AbortSignal,
) {
  const response = await fetch(
    new URL(EnvironmentHttpApi.snapshot.path, normalizeOrigin(origin)),
    { method: EnvironmentHttpApi.snapshot.method, signal: signal ?? null },
  );
  if (!response.ok) {
    throw environmentResponseError("Snapshot");
  }

  const snapshot = await decodeResponse(
    response,
    EnvironmentSnapshotSchema,
    maxResponseBytes,
    "Snapshot",
  );
  if (snapshot.environmentId !== discovery.environmentId) {
    throw environmentResponseError("Snapshot");
  }
  return snapshot;
}

async function decodeResponse<
  S extends Schema.ConstraintDecoder<unknown, never>,
>(
  response: Response,
  schema: S,
  byteLimit: number,
  responseTag: EnvironmentResponseError["responseTag"],
): Promise<S["Type"]> {
  try {
    const encoded = await readBoundedResponse(response, byteLimit);
    return Schema.decodeUnknownSync(schema)(JSON.parse(encoded));
  } catch {
    throw environmentResponseError(responseTag);
  }
}

async function readBoundedResponse(response: Response, byteLimit: number) {
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (declaredLength > byteLimit || response.body === null) {
    throw new Error("Response exceeds the protocol limit.");
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) {
      break;
    }
    byteLength += next.value.byteLength;
    if (byteLength > byteLimit) {
      await reader.cancel();
      throw new Error("Response exceeds the protocol limit.");
    }
    chunks.push(next.value);
  }

  const body = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}

function normalizeOrigin(origin: string) {
  return origin.endsWith("/") ? origin : `${origin}/`;
}
