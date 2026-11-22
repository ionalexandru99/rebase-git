import type { IncomingMessage, ServerResponse } from "node:http";
import {
  type EnvironmentAccessFailure,
  EnvironmentBrowserSession,
  EnvironmentLocalPairing,
  EnvironmentPairingExchanged,
  ExchangeEnvironmentPairing,
  environmentBrowserSessionPath,
  environmentLocalPairingPath,
  environmentPairingExchangePath,
  environmentShutdownPath,
} from "#contracts/environment-authorization/environment-authorization.contract.ts";
import { respondWithBrowserAsset } from "#server/adapters/browser-assets.ts";
import {
  accessFailureStatus,
  expectedRequestOrigin,
  validateControlRequest,
  validateRequestHost,
  validateRequestOrigin,
  writeBrowserSessionCookie,
} from "#server/adapters/environment-transport/environment-request-authorization.ts";
import {
  type EnvironmentAuthorization,
  isEnvironmentAuthorizationError,
} from "#server/features/environment-authorization/environment-authorization.ts";

interface EnvironmentRequestRejected {
  readonly _tag: "EnvironmentRequestRejected";
  readonly failure: EnvironmentAccessFailure;
}

const maximumRequestBytes = 65_536;
const strictExchange = ExchangeEnvironmentPairing.strict();

export interface EnvironmentControl {
  readonly token: string;
  readonly shutdown?: () => void;
}

interface EnvironmentHttpOptions {
  readonly authorization: EnvironmentAuthorization;
  readonly browserAssetsRoot?: string;
  readonly control: EnvironmentControl;
  readonly reportDefect?: (where: string, error: unknown) => void;
}

export function createEnvironmentHttpHandler(options: EnvironmentHttpOptions) {
  return (request: IncomingMessage, response: ServerResponse) => {
    respondToEnvironmentRequest(request, response, options).catch(
      (error: unknown) => {
        const failure = accessFailure(error);
        if (failure !== undefined) {
          writeAccessFailure(response, failure);
          return;
        }
        options.reportDefect?.("HTTP", error);
        if (!response.headersSent) response.writeHead(500).end();
      },
    );
  };
}

async function respondToEnvironmentRequest(
  request: IncomingMessage,
  response: ServerResponse,
  { authorization, browserAssetsRoot, control }: EnvironmentHttpOptions,
) {
  validateRequestHost(request);
  if (
    browserAssetsRoot !== undefined &&
    (await respondWithBrowserAsset(request, response, browserAssetsRoot))
  )
    return;
  if (
    request.url === environmentLocalPairingPath ||
    request.url === environmentShutdownPath
  ) {
    respondToControlRequest(request, response, authorization, control);
    return;
  }
  const browserSession = request.url === environmentBrowserSessionPath;
  if (!browserSession && request.url !== environmentPairingExchangePath) {
    response.writeHead(404).end();
    return;
  }
  if (request.method !== "POST") {
    response.writeHead(405, { allow: "POST" }).end();
    return;
  }
  validateRequestOrigin(request, browserSession);
  const exchange = parsePairingExchange(await readRequestBody(request));
  const paired = await authorization.exchangePairing(exchange);
  if (!browserSession) {
    writeJson(response, 200, EnvironmentPairingExchanged.parse(paired));
    return;
  }
  writeBrowserSessionCookie(request, response, paired.credential);
  writeJson(
    response,
    200,
    EnvironmentBrowserSession.parse({
      authorization: paired.authorization,
    }),
  );
}

function respondToControlRequest(
  request: IncomingMessage,
  response: ServerResponse,
  authorization: EnvironmentAuthorization,
  control: EnvironmentControl,
) {
  if (request.method !== "POST") {
    response.writeHead(405, { allow: "POST" }).end();
    return;
  }
  validateControlRequest(request, control.token);
  if (request.url === environmentShutdownPath) {
    if (control.shutdown === undefined) {
      response.writeHead(404).end();
      return;
    }
    response.once("finish", control.shutdown);
    response.writeHead(202).end();
    return;
  }
  const pairing = authorization.createPairing({
    replacesGrantsWithSameLabel: false,
  });
  writeJson(
    response,
    200,
    EnvironmentLocalPairing.parse({
      pairingUrl: `${expectedRequestOrigin(request)}/pair#${pairing.material}`,
    }),
  );
}

function readRequestBody(request: IncomingMessage) {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let receivedBytes = 0;
    const tooLarge = () => {
      detach();
      reject(
        rejected({ _tag: "PayloadTooLarge", limitBytes: maximumRequestBytes }),
      );
      request.resume();
    };
    const receive = (chunk: Buffer) => {
      receivedBytes += chunk.byteLength;
      if (receivedBytes > maximumRequestBytes) tooLarge();
      else chunks.push(chunk);
    };
    const end = () => {
      detach();
      resolve(Buffer.concat(chunks));
    };
    const failed = () => {
      detach();
      reject(rejected({ _tag: "InvalidMessage" }));
    };
    const detach = () => {
      request.off("data", receive);
      request.off("end", end);
      request.off("error", failed);
    };
    if (Number(request.headers["content-length"] ?? 0) > maximumRequestBytes) {
      tooLarge();
      return;
    }
    request.on("data", receive);
    request.on("end", end);
    request.on("error", failed);
  });
}

function parsePairingExchange(body: Buffer) {
  try {
    return strictExchange.parse(JSON.parse(body.toString("utf8")));
  } catch {
    throw rejected({ _tag: "InvalidMessage" });
  }
}

function writeJson(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(value));
}

function writeAccessFailure(
  response: ServerResponse,
  failure: EnvironmentAccessFailure,
) {
  if (response.writableEnded) return;
  writeJson(response, accessFailureStatus(failure), failure);
}

function accessFailure(error: unknown) {
  if (isEnvironmentAuthorizationError(error)) return error.failure;
  return isRequestRejected(error) ? error.failure : undefined;
}

function isRequestRejected(
  error: unknown,
): error is EnvironmentRequestRejected {
  return (
    typeof error === "object" &&
    error !== null &&
    "_tag" in error &&
    error._tag === "EnvironmentRequestRejected"
  );
}

function rejected(
  failure: EnvironmentAccessFailure,
): EnvironmentRequestRejected {
  return { _tag: "EnvironmentRequestRejected", failure };
}
