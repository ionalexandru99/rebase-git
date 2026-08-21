import { describe, expect, it } from "vite-plus/test";
import { advanceEnvironmentSequence } from "#web/features/environment-connection/websocket/environment-sequence";

describe("Environment event sequence", () => {
  it("accepts consecutive events and ignores already observed events", () => {
    expect(advanceEnvironmentSequence(4, 5)).toEqual({
      _tag: "SequenceAccepted",
      sequence: 5,
    });
    expect(advanceEnvironmentSequence(5, 5)).toEqual({
      _tag: "SequenceIgnored",
      sequence: 5,
    });
  });

  it("requires a snapshot after a sequence gap", () => {
    expect(advanceEnvironmentSequence(4, 7)).toEqual({
      _tag: "ResnapshotRequired",
      currentSequence: 4,
      receivedSequence: 7,
      reason: "SequenceGap",
    });
  });
});
