import { describe, expect, it } from "vite-plus/test";
import {
  canPull,
  type PullConditions,
} from "#web/features/repository-pull/can-pull";

const ready: PullConditions = {
  connected: true,
  writable: true,
  activeBranch: "main",
  recoveryBusy: false,
  pulling: false,
  freshnessReady: true,
};

describe("pull availability", () => {
  it("pulls a checked-out branch on a ready, writable connection", () => {
    expect(canPull(ready)).toBe(true);
  });

  it.each<[string, Partial<PullConditions>]>([
    ["disconnected", { connected: false }],
    ["without write access", { writable: false }],
    ["without a checked-out branch", { activeBranch: undefined }],
    ["while a repository operation is busy", { recoveryBusy: true }],
    ["while already pulling", { pulling: true }],
    ["before repository status is known", { freshnessReady: false }],
  ])("disables pull %s", (_, override) => {
    expect(canPull({ ...ready, ...override })).toBe(false);
  });
});
