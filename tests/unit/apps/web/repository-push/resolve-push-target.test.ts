import type { RepositoryRefs } from "@rebase/contracts";
import { describe, expect, it } from "vite-plus/test";
import { resolvePushTarget } from "#web/features/repository-push/resolve-push-target";

const remoteTip = "b".repeat(40);

describe("push target", () => {
  it("splits the upstream at the longest matching remote and reads its reviewed tip", () => {
    expect(resolvePushTarget(refs(), "topic")).toEqual({
      branch: "topic",
      remotes: ["team", "team/fork"],
      upstream: {
        destination: { remote: "team/fork", branch: "feature/topic" },
        ahead: 2,
        behind: 1,
        gone: false,
        remoteOid: remoteTip,
      },
    });
  });

  it("publishes a branch without an upstream and hides push without remotes", () => {
    expect(resolvePushTarget(refs(), "main")).toEqual({
      branch: "main",
      remotes: ["team", "team/fork"],
    });
    expect(
      resolvePushTarget({ ...refs(), remoteProviders: [] }, "topic"),
    ).toBeUndefined();
  });
});

function refs(): RepositoryRefs {
  return {
    repositoryId: "00000000-0000-4000-8000-000000000001",
    remoteProviders: [
      { remote: "team", provider: "git" },
      { remote: "team/fork", provider: "github" },
    ],
    branches: [
      { name: "main" },
      {
        name: "topic",
        upstream: {
          name: "team/fork/feature/topic",
          ahead: 2,
          behind: 1,
          gone: false,
        },
      },
    ],
    remoteBranches: [
      { remote: "team", name: "fork/feature/topic", target: remoteTip },
      { remote: "team", name: "feature/topic", target: "c".repeat(40) },
    ],
    tags: [],
    truncated: { branches: false, remoteBranches: false, tags: false },
    worktrees: [],
  };
}
