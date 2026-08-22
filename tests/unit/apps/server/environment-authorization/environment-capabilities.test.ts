import type { EnvironmentAuthorizationRole } from "@rebase/contracts";
import { capabilitiesForRole } from "@rebase/server/features/environment-authorization/environment-capabilities";
import { describe, expect, it } from "vite-plus/test";

describe("Environment authorization roles", () => {
  it.each([
    ["viewer", ["environment.read", "repository.read"]],
    [
      "contributor",
      ["environment.read", "repository.read", "repository.write"],
    ],
    [
      "maintainer",
      [
        "environment.read",
        "repository.read",
        "repository.write",
        "history.rewrite",
        "worktree.manage",
      ],
    ],
    [
      "owner",
      [
        "environment.read",
        "repository.read",
        "repository.write",
        "history.rewrite",
        "worktree.manage",
        "authorization.manage",
        "environment.manage",
      ],
    ],
    ["custom", ["repository.read"]],
  ] as const)("maps the %s role", (role, expected) => {
    expect(
      capabilitiesForRole(
        role satisfies EnvironmentAuthorizationRole,
        role === "custom" ? ["repository.read"] : [],
      ),
    ).toEqual(expected);
  });

  it("deduplicates custom capabilities", () => {
    expect(
      capabilitiesForRole("custom", [
        "repository.read",
        "repository.read",
        "repository.write",
      ]),
    ).toEqual(["repository.read", "repository.write"]);
  });

  it("allows a custom role without capabilities", () => {
    expect(capabilitiesForRole("custom", [])).toEqual([]);
  });
});
