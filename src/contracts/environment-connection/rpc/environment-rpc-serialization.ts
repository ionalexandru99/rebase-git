import { RpcSerialization } from "effect/unstable/rpc";

const encoder = new TextEncoder();

export function environmentRpcSerialization(
  receiveLimit: () => number,
  sendLimit: () => number,
): RpcSerialization.RpcSerialization["Service"] {
  return {
    ...RpcSerialization.json,
    makeUnsafe() {
      const parser = RpcSerialization.json.makeUnsafe();
      return {
        decode(data) {
          if (typeof data !== "string")
            throw new Error("Expected a JSON text message");
          checkSize(data, receiveLimit());
          return parser.decode(data);
        },
        encode(message) {
          const encoded = parser.encode(message);
          if (encoded !== undefined) checkSize(encoded, sendLimit());
          return encoded;
        },
      };
    },
  };
}

function checkSize(message: string | Uint8Array, limit: number) {
  if (
    (typeof message === "string"
      ? encoder.encode(message).byteLength
      : message.byteLength) > limit
  )
    throw new RpcSerialization.MaxBufferSizeExceeded({ maxBufferSize: limit });
}
