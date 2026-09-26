import {
  EnvironmentHttpApi,
  RepositoryPushHttpApi,
  repositoryRejected,
} from "@rebase/contracts";
import { Schema } from "effect";
import { describe, expect, it } from "vite-plus/test";

const updated = {
  destination: { remote: "origin", branch: "main" },
  target: "a".repeat(40),
};

describe("Environment HTTP route contract", () => {
  it("answers a repository command with its value, its own failures or the standard rejection", () => {
    const decode = Schema.decodeUnknownSync(
      RepositoryPushHttpApi.push.response,
    );
    const pushRejected = {
      _tag: "PushRejected",
      reason: "NonFastForward",
      detail: "Fetch first.",
    };
    const busy = repositoryRejected("Busy", "Another write is running.");

    expect(decode({ _tag: "Ok", value: updated })).toEqual({
      _tag: "Ok",
      value: updated,
    });
    expect(decode({ _tag: "Rejected", failure: pushRejected })).toEqual({
      _tag: "Rejected",
      failure: pushRejected,
    });
    expect(decode({ _tag: "Rejected", failure: busy })).toEqual({
      _tag: "Rejected",
      failure: busy,
    });
    expect(() =>
      decode({ _tag: "Rejected", failure: { _tag: "InvalidGrant" } }),
    ).toThrow();
  });

  it("rejects every failure on a route that declares none", () => {
    const decode = Schema.decodeUnknownSync(
      EnvironmentHttpApi.snapshot.response,
    );

    expect(
      decode({
        _tag: "Ok",
        value: {
          environmentId: "00000000-0000-4000-8000-000000000001",
          sequence: 3,
        },
      }),
    ).toMatchObject({ _tag: "Ok" });
    expect(() =>
      decode({
        _tag: "Rejected",
        failure: repositoryRejected("Missing", "Gone."),
      }),
    ).toThrow();
  });
});
