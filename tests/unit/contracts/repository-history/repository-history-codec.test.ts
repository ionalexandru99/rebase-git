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

  it("discards partial messages and rejects invalid request IDs", () => {
    const [first] = fragmentBinaryMessage(
      { logicalMessageId: 4, payload: new Uint8Array(160), requestId },
      96,
    );
    const reassembler = createBinaryMessageReassembler();
    expect(first).toBeDefined();
    reassembler.accept(first ?? new Uint8Array());
    reassembler.discard(requestId);
    expect(() => reassembler.accept(first ?? new Uint8Array())).not.toThrow();

    const malformed = (first ?? new Uint8Array()).slice();
    malformed.set(new TextEncoder().encode("x".repeat(36)), 16);
    expect(() => reassembler.accept(malformed)).toThrow();
  });

  it("rejects pages beyond the encoded collection limits", () => {
    const page = historyPage("sha1");
    const commit = page.commits[0];
    const refTarget = page.refTargets[0];
    if (commit === undefined || refTarget === undefined) {
      throw new Error("The fixture is incomplete");
    }
    expect(() =>
      encodeRepositoryHistoryPage({
        ...page,
        commits: Array.from({ length: 1_001 }, () => commit),
      }),
    ).toThrow("Too many commits");
    expect(() =>
      encodeRepositoryHistoryPage({
        ...page,
        refTargets: Array.from({ length: 257 }, () => refTarget),
      }),
    ).toThrow("Too many ref targets");
    expect(() =>
      encodeRepositoryHistoryPage({
        ...page,
        commits: [
          {
            ...commit,
            parents: Array.from({ length: 4_097 }, () => commit.oid),
          },
        ],
      }),
    ).toThrow("Too many parents");
  });

  it("rejects logical messages beyond the reassembly limit", () => {
    expect(() =>
      fragmentBinaryMessage(
        {
          logicalMessageId: 1,
          payload: new Uint8Array(64 * 1_048_576 + 1),
          requestId,
        },
        1_048_576,
      ),
    ).toThrow("Logical message is too large");
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
