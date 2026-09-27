import { Schema } from "effect";
import { describe, expect, it } from "vite-plus/test";
import { repositoryRejected } from "#contracts/git/git-failures.contract.ts";
import { RepositoryCatalogApi } from "#contracts/repository-catalog/repository-catalog.contract.ts";
import { RepositoryPushApi } from "#contracts/repository-push/repository-push.contract.ts";

describe("Environment route contract", () => {
  it("fails a repository command with its own failures or the standard rejection", () => {
    const decode = Schema.decodeUnknownSync(RepositoryPushApi.push.errorSchema);
    const pushRejected = {
      _tag: "PushRejected",
      reason: "NonFastForward",
      detail: "Fetch first.",
    };
    const busy = repositoryRejected("Busy", "Another write is running.");

    expect(decode(pushRejected)).toEqual(pushRejected);
    expect(decode(busy)).toEqual(busy);
    expect(() => decode({ _tag: "InvalidGrant" })).toThrow();
  });

  it("rejects every failure on a route that declares none", () => {
    const decode = Schema.decodeUnknownSync(
      RepositoryCatalogApi.list.errorSchema,
    );

    expect(() => decode(repositoryRejected("Missing", "Gone."))).toThrow();
  });
});
