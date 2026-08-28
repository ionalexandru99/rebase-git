import { describe, expect, it } from "vite-plus/test";
import { describeEmptyBranchesSidebar } from "#web/features/branches-sidebar/branches-sidebar-messages";

describe("branches sidebar messages", () => {
  it.each([
    ["all", "", "No branches or tags."],
    ["local", "", "No local branches."],
    ["remote", "", "No remote branches."],
    ["tags", "", "No tags."],
    ["all", "missing", "No branches match."],
    ["local", "missing", "No local branches match."],
    ["remote", "missing", "No remote branches match."],
    ["tags", "missing", "No tags match."],
  ] as const)(
    "describes the %s scope for query %j",
    (scope, query, expected) => {
      expect(describeEmptyBranchesSidebar(scope, query)).toBe(expected);
    },
  );
});
