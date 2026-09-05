import {
  type JsonLogicalMessage,
  type JsonMessageFragment,
  maximumJsonFragmentCount,
  maximumJsonMessageBytes,
} from "@rebase/contracts/environment-connection/websocket/json-message-fragment.contract";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

export function fragmentJsonMessage(
  message: JsonLogicalMessage,
  maximumFrameBytes: number,
): JsonMessageFragment[] {
  if (message.payload.byteLength > maximumJsonMessageBytes) {
    throw new Error("Logical message is too large");
  }
  const header = {
    _tag: "JsonMessageFragment" as const,
    fragmentCount: maximumJsonFragmentCount,
    fragmentIndex: maximumJsonFragmentCount - 1,
    logicalMessageId: message.logicalMessageId,
    payload: "",
    requestId: message.requestId,
  };
  const payloadBudget =
    maximumFrameBytes - encoder.encode(JSON.stringify(header)).byteLength;
  if (payloadBudget < 6) throw new Error("JSON frame limit is too small");
  const payload = decoder.decode(message.payload);
  const parts: string[] = [];
  let start = 0;
  let offset = 0;
  let size = 0;
  for (const character of payload) {
    const bytes = escapedCharacterBytes(character);
    if (size + bytes > payloadBudget) {
      parts.push(payload.slice(start, offset));
      start = offset;
      size = 0;
      if (parts.length >= maximumJsonFragmentCount)
        throw new Error("Logical message needs too many fragments");
    }
    size += bytes;
    offset += character.length;
  }
  parts.push(payload.slice(start));
  return parts.map((part, fragmentIndex) => ({
    ...header,
    fragmentCount: parts.length,
    fragmentIndex,
    payload: part,
  }));
}

export function createJsonMessageReassembler() {
  const pending = new Map<string, PendingMessage>();
  let pendingBytes = 0;
  return {
    accept(fragment: JsonMessageFragment): JsonLogicalMessage | undefined {
      const key = `${fragment.requestId}:${fragment.logicalMessageId}`;
      const current = pending.get(key) ?? {
        bytes: 0,
        fragmentCount: fragment.fragmentCount,
        fragments: new Map<number, string>(),
        requestId: fragment.requestId,
      };
      if (current.fragmentCount !== fragment.fragmentCount)
        throw new Error("Fragment count changed");
      if (current.fragments.has(fragment.fragmentIndex))
        throw new Error("Duplicate JSON fragment");
      const bytes = encoder.encode(fragment.payload).byteLength;
      current.fragments.set(fragment.fragmentIndex, fragment.payload);
      current.bytes += bytes;
      pendingBytes += bytes;
      if (pendingBytes > maximumJsonMessageBytes) {
        pending.clear();
        pendingBytes = 0;
        throw new Error("Pending JSON messages are too large");
      }
      if (current.fragments.size !== current.fragmentCount) {
        pending.set(key, current);
        return undefined;
      }
      const parts = Array.from(
        { length: current.fragmentCount },
        (_, index) => {
          const part = current.fragments.get(index);
          if (part === undefined) throw new Error("Missing JSON fragment");
          return part;
        },
      );
      pending.delete(key);
      pendingBytes -= current.bytes;
      return {
        logicalMessageId: fragment.logicalMessageId,
        payload: encoder.encode(parts.join("")),
        requestId: fragment.requestId,
      };
    },
    clear() {
      pending.clear();
      pendingBytes = 0;
    },
    discard(requestId: string) {
      for (const [key, message] of pending) {
        if (message.requestId !== requestId) continue;
        pendingBytes -= message.bytes;
        pending.delete(key);
      }
    },
  };
}

function escapedCharacterBytes(character: string) {
  const code = character.codePointAt(0) ?? 0;
  if (code < 0x20) return 6;
  if (character === '"' || character === "\\") return 2;
  return code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
}

interface PendingMessage {
  bytes: number;
  readonly fragmentCount: number;
  readonly fragments: Map<number, string>;
  readonly requestId: string;
}
