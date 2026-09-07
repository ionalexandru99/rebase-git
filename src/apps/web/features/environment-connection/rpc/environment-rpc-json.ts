import {
  createJsonMessageReassembler,
  type JsonMessageFragment,
} from "@rebase/contracts";
import { Effect } from "effect";
import { environmentResponseError } from "#web/features/environment-connection/environment-connection-errors";

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
