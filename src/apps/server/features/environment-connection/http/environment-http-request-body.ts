import type { IncomingMessage } from "node:http";
import {
  currentTransportLimits,
  type EnvironmentHttpFailure,
} from "@rebase/contracts";
import { Effect } from "effect";

export function readEnvironmentHttpRequestBody(request: IncomingMessage) {
  return Effect.callback<void, HttpBodyFailure>((resume) => {
    let receivedBytes = 0;
    let hasBody = Number(request.headers["content-length"] ?? 0) > 0;
    let settled = false;

    const finish = (effect: Effect.Effect<void, HttpBodyFailure>) => {
      if (settled) {
        return;
      }
      settled = true;
      detach();
      resume(effect);
    };
    const rejectOversizedPayload = () => {
      finish(
        Effect.fail({
          failure: {
            _tag: "PayloadTooLarge",
            limitBytes: currentTransportLimits.maxHttpRequestBytes,
          },
          status: 413,
        }),
      );
      request.resume();
    };
    const receive = (chunk: Buffer) => {
      hasBody = true;
      receivedBytes += chunk.byteLength;
      if (receivedBytes > currentTransportLimits.maxHttpRequestBytes) {
        rejectOversizedPayload();
      }
    };
    const end = () => {
      finish(
        hasBody
          ? Effect.fail({
              failure: { _tag: "InvalidMessage" },
              status: 400,
            })
          : Effect.void,
      );
    };
    const rejectInvalidMessage = () => {
      finish(
        Effect.fail({
          failure: { _tag: "InvalidMessage" },
          status: 400,
        }),
      );
    };
    const detach = () => {
      request.off("data", receive);
      request.off("end", end);
      request.off("aborted", rejectInvalidMessage);
      request.off("error", rejectInvalidMessage);
    };

    if (
      Number(request.headers["content-length"] ?? 0) >
      currentTransportLimits.maxHttpRequestBytes
    ) {
      rejectOversizedPayload();
      return;
    }

    request.on("data", receive);
    request.on("end", end);
    request.on("aborted", rejectInvalidMessage);
    request.on("error", rejectInvalidMessage);

    return Effect.sync(detach);
  });
}

interface HttpBodyFailure {
  readonly failure: typeof EnvironmentHttpFailure.Type;
  readonly status: 400 | 413;
}
