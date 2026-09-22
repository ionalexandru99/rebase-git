import {
  createJsonMessageReassembler,
  type JsonMessageFragment,
} from "@rebase/contracts";
import { environmentResponseError } from "@rebase/environment-client";
import { Effect } from "effect";

export function rpcJsonReassembler(requestId: string) {
  const reassembler = createJsonMessageReassembler();
  return (frame: JsonMessageFragment) =>
    Effect.try({
      try: () => {
        if (frame.requestId !== requestId)
          throw new Error("Request identity mismatch");
        return reassembler.accept(frame)?.payload;
      },
      catch: () => environmentResponseError("WebSocket"),
    });
}
