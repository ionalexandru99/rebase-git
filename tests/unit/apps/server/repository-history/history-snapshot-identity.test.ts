import {
  historySnapshotIdentity,
  historyTraversalIdentity,
} from "@rebase/server/features/repository-history/git/history-snapshot-identity";
import { describe, expect, it } from "vitest";

describe("history snapshot identity", () => {
  const roots = ["a".repeat(40)];
  const refs = [{ type: "branch" as const, name: "main", oid: roots[0] ?? "" }];

  it("keeps traversal compatibility independent from ref names", () => {
    const initial = historySnapshotIdentity("sha1", refs, roots, []);
    const renamed = historySnapshotIdentity(
      "sha1",
      [{ ...refs[0], type: "branch", name: "renamed", oid: roots[0] ?? "" }],
      roots,
      [],
    );
    expect(initial).toMatch(/^[0-9a-f]{64}$/);
    expect(initial).not.toBe(renamed);
    expect(initial.slice(0, 32)).toBe(renamed.slice(0, 32));
  });

  it("invalidates changed roots, object format, or shallow boundaries", () => {
    const initial = historyTraversalIdentity("sha1", roots, []);
    expect(historyTraversalIdentity("sha1", ["b".repeat(40)], [])).not.toBe(
      initial,
    );
    expect(historyTraversalIdentity("sha256", roots, [])).not.toBe(initial);
    expect(historyTraversalIdentity("sha1", roots, roots)).not.toBe(initial);
  });
});
