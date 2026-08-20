import type { IncomingMessage, ServerResponse } from "node:http";
import {
  currentTransportLimits,
  EnvironmentDiscovery,
  EnvironmentHttpApi,
  EnvironmentHttpFailure,
  EnvironmentSnapshot,
} from "@rebase/contracts";
import type { EnvironmentTransportState } from "@rebase/server/features/environment-connection/environment-transport.contract";
import { Schema } from "effect";

export function createEnvironmentHttpHandler(
  state: EnvironmentTransportState,
  ready: () => boolean,
) {
  return (request: IncomingMessage, response: ServerResponse) => {
    void respondToEnvironmentRequest(request, response, state, ready());
  };
}

async function respondToEnvironmentRequest(
  request: IncomingMessage,
  response: ServerResponse,
  state: EnvironmentTransportState,
  ready: boolean,
) {
  const bodyFailure = await readBodyFailure(request);
  if (bodyFailure !== undefined) {
    writeJson(
      response,
      bodyFailure.status,
      EnvironmentHttpFailure,
      bodyFailure.failure,
    );
    return;
  }

  if (request.method !== "GET") {
    response.writeHead(405, { allow: "GET" }).end();
    return;
  }

  if (request.url === "/health") {
    writeJsonValue(response, ready ? 200 : 503, {
      status: ready ? "ready" : "starting",
    });
    return;
  }

  if (request.url === EnvironmentHttpApi.discovery.path) {
    writeJson(
      response,
      EnvironmentHttpApi.discovery.successStatus,
      EnvironmentDiscovery,
      state.discovery,
    );
    return;
  }

  if (request.url === EnvironmentHttpApi.snapshot.path) {
    writeJson(
      response,
      EnvironmentHttpApi.snapshot.successStatus,
      EnvironmentSnapshot,
      {
        environmentId: state.discovery.environmentId,
        sequence: state.events.currentSequence(),
      },
    );
    return;
  }

  response.writeHead(404).end();
}

function readBodyFailure(request: IncomingMessage) {
  return new Promise<HttpBodyFailure | undefined>((resolveFailure) => {
    let receivedBytes = 0;
    let hasBody = Number(request.headers["content-length"] ?? 0) > 0;
    let settled = false;

    const finish = (failure: HttpBodyFailure | undefined) => {
      if (settled) {
        return;
      }
      settled = true;
      resolveFailure(failure);
    };

    const rejectOversizedPayload = () => {
      finish({
        failure: {
          _tag: "PayloadTooLarge",
          limitBytes: currentTransportLimits.maxHttpRequestBytes,
        },
        status: 413,
      });
      request.resume();
    };

    if (
      Number(request.headers["content-length"] ?? 0) >
      currentTransportLimits.maxHttpRequestBytes
    ) {
      rejectOversizedPayload();
      return;
    }

    request.on("data", (chunk: Buffer) => {
      hasBody = true;
      receivedBytes += chunk.byteLength;
      if (receivedBytes > currentTransportLimits.maxHttpRequestBytes) {
        rejectOversizedPayload();
      }
    });
    request.on("end", () => {
      finish(
        hasBody
          ? { failure: { _tag: "InvalidMessage" }, status: 400 }
          : undefined,
      );
    });
    request.on("aborted", () => {
      finish({ failure: { _tag: "InvalidMessage" }, status: 400 });
    });
    request.on("error", () => {
      finish({ failure: { _tag: "InvalidMessage" }, status: 400 });
    });
  });
}

interface HttpBodyFailure {
  readonly failure: typeof EnvironmentHttpFailure.Type;
  readonly status: 400 | 413;
}

function writeJson<S extends Schema.ConstraintEncoder<unknown, never>>(
  response: ServerResponse,
  status: number,
  schema: S,
  value: S["Type"],
) {
  writeJsonValue(response, status, Schema.encodeSync(schema)(value));
}

function writeJsonValue(
  response: ServerResponse,
  status: number,
  value: unknown,
) {
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(value));
}
