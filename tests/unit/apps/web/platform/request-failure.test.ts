import { describe, expect, it } from "vite-plus/test";
import type { RepositoryRejected } from "#contracts/git/git-failures.contract.ts";
import type { RefMissing } from "#contracts/repository-refs/repository-refs.contract.ts";
import type { TagRejected } from "#contracts/repository-refs/repository-tags.contract.ts";
import {
  describeFailure,
  gitMessage,
  type RequestFailure,
} from "#web/platform/query/request-failure.ts";

type TagFailure = RequestFailure<TagRejected | RefMissing | RepositoryRejected>;

const tagMessages = {
  TagRejected: () => "v1 already exists.",
};

describe("describeFailure", () => {
  it.each<[TagFailure, string]>([
    [{ _tag: "Unanswered" }, "The server stopped responding."],
    [{ _tag: "Cancelled" }, "The request was cancelled."],
  ])("words %j the same for every feature", (failure, message) => {
    expect(describeFailure(failure, tagMessages)).toContain(message);
  });

  it("lets a feature word only its own rejections", () => {
    expect(
      describeFailure<TagRejected | RefMissing | RepositoryRejected>(
        {
          _tag: "Rejected",
          failure: { _tag: "TagRejected", reason: "Exists" },
        },
        tagMessages,
      ),
    ).toBe("v1 already exists.");
    expect(
      describeFailure<TagRejected | RefMissing | RepositoryRejected>(
        { _tag: "Rejected", failure: { _tag: "RefMissing", name: "v1" } },
        tagMessages,
      ),
    ).toBe("v1 no longer exists.");
  });

  it("falls back to the Git detail of a repository rejection", () => {
    const rejected = (detail: string): TagFailure => ({
      _tag: "Rejected",
      failure: { _tag: "RepositoryRejected", reason: "GitFailed", detail },
    });
    expect(describeFailure(rejected("fatal: bad ref"))).toBe("Bad ref.");
    expect(describeFailure(rejected(""))).toBe(
      "Git could not complete the operation.",
    );
  });

  it("summarizes Git output and keeps the rest without hints underneath", () => {
    expect(
      gitMessage(
        "To github.com:team/app.git\nremote: GH006: Protected branch update failed.\nhint: Use a pull request.\nerror: failed to push some refs to 'origin'",
      ),
    ).toBe(
      "Failed to push some refs to 'origin'.\n\nTo github.com:team/app.git\nremote: GH006: Protected branch update failed.\nerror: failed to push some refs to 'origin'",
    );
    expect(
      gitMessage("remote: Protected branch.", "The remote rejected the push."),
    ).toBe("The remote rejected the push.\n\nremote: Protected branch.");
    expect(gitMessage("\n\nhint: only hints\n")).toBe(
      "Git could not complete the operation.",
    );
  });
});
