import type {
  RefMissing,
  RepositoryRejected,
  TagRejected,
} from "@rebase/contracts";
import { describe, expect, it } from "vite-plus/test";
import {
  describeFailure,
  type RequestFailure,
} from "#web/platform/query/request-failure";

type TagFailure = RequestFailure<TagRejected | RefMissing | RepositoryRejected>;

const tagMessages = {
  TagRejected: () => "v1 already exists.",
};

describe("describeFailure", () => {
  it.each<[TagFailure, string]>([
    [{ _tag: "Unanswered" }, "The Environment did not answer."],
    [
      {
        _tag: "AccessDenied",
        failure: { _tag: "CapabilityDenied", capability: "repository.write" },
      },
      "This device has no access to this repository.",
    ],
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
    expect(describeFailure(rejected("fatal: bad ref"))).toBe("fatal: bad ref");
    expect(describeFailure(rejected(""))).toBe(
      "Git could not complete the operation.",
    );
  });
});
