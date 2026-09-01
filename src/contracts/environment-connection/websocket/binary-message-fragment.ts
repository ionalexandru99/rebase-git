import { EnvironmentRequestId } from "@rebase/contracts/environment-connection/negotiation/environment-protocol.contract";
import { Schema } from "effect";

const fragmentMagic = 0x5242_4631;
const requestIdBytes = 36;
const headerBytes = 52;
const maximumFragmentCount = 4_096;
const maximumLogicalMessageBytes = 64 * 1_048_576;

export interface BinaryLogicalMessage {
  readonly logicalMessageId: number;
  readonly payload: Uint8Array;
  readonly requestId: string;
}

export function fragmentBinaryMessage(
  message: BinaryLogicalMessage,
  maximumFrameBytes: number,
) {
  const payloadBytes = maximumFrameBytes - headerBytes;
  if (payloadBytes <= 0) {
    throw new Error("Binary frame limit is too small");
  }
  const fragmentCount = Math.max(
    1,
    Math.ceil(message.payload.byteLength / payloadBytes),
  );
  if (fragmentCount > maximumFragmentCount) {
    throw new Error("Logical message needs too many fragments");
  }
  return Array.from({ length: fragmentCount }, (_, fragmentIndex) => {
    const start = fragmentIndex * payloadBytes;
    return encodeFragment({
      fragmentCount,
      fragmentIndex,
      logicalMessageId: message.logicalMessageId,
      payload: message.payload.subarray(start, start + payloadBytes),
      requestId: message.requestId,
    });
  });
}

export function createBinaryMessageReassembler() {
  const pending = new Map<string, PendingMessage>();
  let pendingBytes = 0;
  return {
    accept(frame: Uint8Array): BinaryLogicalMessage | undefined {
      const fragment = decodeFragment(frame);
      const key = `${fragment.requestId}:${fragment.logicalMessageId}`;
      const current = pending.get(key) ?? {
        fragmentCount: fragment.fragmentCount,
        fragments: new Map<number, Uint8Array>(),
        requestId: fragment.requestId,
      };
      if (current.fragmentCount !== fragment.fragmentCount) {
        throw new Error("Fragment count changed");
      }
      if (current.fragments.has(fragment.fragmentIndex)) {
        throw new Error("Duplicate binary fragment");
      }
      current.fragments.set(fragment.fragmentIndex, fragment.payload);
      pendingBytes += fragment.payload.byteLength;
      if (pendingBytes > maximumLogicalMessageBytes) {
        pending.clear();
        pendingBytes = 0;
        throw new Error("Pending binary messages are too large");
      }
      if (current.fragments.size !== current.fragmentCount) {
        pending.set(key, current);
        return undefined;
      }
      const payloadLength = [...current.fragments.values()].reduce(
        (total, payload) => total + payload.byteLength,
        0,
      );
      const payload = new Uint8Array(payloadLength);
      let offset = 0;
      for (let index = 0; index < current.fragmentCount; index += 1) {
        const part = current.fragments.get(index);
        if (part === undefined) {
          throw new Error("Missing binary fragment");
        }
        payload.set(part, offset);
        offset += part.byteLength;
      }
      pending.delete(key);
      pendingBytes -= payloadLength;
      return {
        logicalMessageId: fragment.logicalMessageId,
        payload,
        requestId: fragment.requestId,
      };
    },
    clear() {
      pending.clear();
      pendingBytes = 0;
    },
    discard(requestId: string) {
      for (const [key, message] of pending) {
        if (message.requestId !== requestId) {
          continue;
        }
        pendingBytes -= messageBytes(message);
        pending.delete(key);
      }
    },
  };
}

export function readBinaryFragmentRequestId(frame: Uint8Array) {
  return decodeFragment(frame).requestId;
}

function encodeFragment(fragment: DecodedFragment) {
  const requestId = new TextEncoder().encode(fragment.requestId);
  if (requestId.byteLength !== requestIdBytes) {
    throw new Error("Binary fragments require a UUID request ID");
  }
  const output = new Uint8Array(headerBytes + fragment.payload.byteLength);
  const view = new DataView(output.buffer);
  view.setUint32(0, fragmentMagic, false);
  view.setUint32(4, fragment.logicalMessageId, false);
  view.setUint16(8, fragment.fragmentIndex, false);
  view.setUint16(10, fragment.fragmentCount, false);
  view.setUint32(12, fragment.payload.byteLength, false);
  output.set(requestId, 16);
  output.set(fragment.payload, headerBytes);
  return output;
}

function decodeFragment(frame: Uint8Array): DecodedFragment {
  if (frame.byteLength < headerBytes) {
    throw new Error("Truncated fragment");
  }
  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
  if (view.getUint32(0, false) !== fragmentMagic) {
    throw new Error("Invalid fragment magic");
  }
  const fragmentIndex = view.getUint16(8, false);
  const fragmentCount = view.getUint16(10, false);
  const payloadLength = view.getUint32(12, false);
  if (
    fragmentCount === 0 ||
    fragmentCount > maximumFragmentCount ||
    fragmentIndex >= fragmentCount ||
    payloadLength !== frame.byteLength - headerBytes
  ) {
    throw new Error("Invalid fragment header");
  }
  const requestId = new TextDecoder("ascii", { fatal: true }).decode(
    frame.subarray(16, headerBytes),
  );
  return {
    fragmentCount,
    fragmentIndex,
    logicalMessageId: view.getUint32(4, false),
    payload: frame.slice(headerBytes),
    requestId: Schema.decodeUnknownSync(EnvironmentRequestId)(requestId),
  };
}

function messageBytes(message: PendingMessage) {
  let bytes = 0;
  for (const fragment of message.fragments.values()) {
    bytes += fragment.byteLength;
  }
  return bytes;
}

interface DecodedFragment {
  readonly fragmentCount: number;
  readonly fragmentIndex: number;
  readonly logicalMessageId: number;
  readonly payload: Uint8Array;
  readonly requestId: string;
}

interface PendingMessage {
  readonly fragmentCount: number;
  readonly fragments: Map<number, Uint8Array>;
  readonly requestId: string;
}
