import {
  createBinaryMessageReassembler,
  decodeRepositoryHistoryPage,
  encodeRepositoryHistoryPage,
  fragmentBinaryMessage,
  type RepositoryHistoryPage,
} from "@rebase/contracts";
import { describe, expect, it } from "vite-plus/test";

const requestId = "00000000-0000-4000-8000-000000000011";
const repositoryId = "00000000-0000-4000-8000-000000000001";

describe("repository history binary codec", () => {
  it.each(["sha1", "sha256"] as const)(
    "round trips %s commit metadata without text framing",
    (objectFormat) => {
      const page = historyPage(objectFormat);

      expect(
        decodeRepositoryHistoryPage(encodeRepositoryHistoryPage(page)),
      ).toEqual(page);
    },
  );

  it("fragments and reassembles a logical history message out of order", () => {
    const payload = encodeRepositoryHistoryPage(historyPage("sha1"));
    const frames = fragmentBinaryMessage(
      { logicalMessageId: 7, payload, requestId },
      96,
    );
    const reassembler = createBinaryMessageReassembler();

    expect(frames.length).toBeGreaterThan(2);
    const completed = frames
      .toReversed()
      .map((frame) => reassembler.accept(frame))
      .find((result) => result !== undefined);

    expect(completed).toEqual({ logicalMessageId: 7, payload, requestId });
  });

  it("rejects duplicate fragments and malformed payloads", () => {
    const [first] = fragmentBinaryMessage(
      {
        logicalMessageId: 4,
        payload: new Uint8Array(160),
        requestId,
      },
      96,
    );
    const reassembler = createBinaryMessageReassembler();

    expect(first).toBeDefined();
    reassembler.accept(first ?? new Uint8Array());
    expect(() => reassembler.accept(first ?? new Uint8Array())).toThrow();
    expect(() =>
      decodeRepositoryHistoryPage(new Uint8Array([1, 2, 3])),
    ).toThrow();
  });
});

function historyPage(objectFormat: "sha1" | "sha256"): RepositoryHistoryPage {
  const oidLength = objectFormat === "sha1" ? 40 : 64;
  return {
    commits: [
      {
        author: {
          email: "alex@example.test",
          name: "Alex I.",
          timestampSeconds: 1_777_777_777,
          timezoneOffsetMinutes: 120,
        },
        committer: {
          email: "mira@example.test",
          name: "Mira I.",
          timestampSeconds: 1_777_777_778,
          timezoneOffsetMinutes: -330,
        },
        oid: "a".repeat(oidLength),
        parents: ["b".repeat(oidLength), "c".repeat(oidLength)],
        subject: "Keep topology bounded \u0000 without confusing framing",
      },
    ],
    objectFormat,
    refTargets: [
      {
        name: "main",
        oid: "a".repeat(oidLength),
        type: "branch",
      },
    ],
    repositoryId,
    requestId,
  };
}
