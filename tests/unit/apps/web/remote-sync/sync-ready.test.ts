import { describe, expect, it } from "vite-plus/test";
import {
  type SyncConditions,
  syncReady,
} from "#web/features/remote-sync/remote-sync";

const ready: SyncConditions = {
  canRun: true,
  freshnessReady: true,
  recoveryBusy: false,
  pulling: false,
};

describe("remote sync availability", () => {
  it("fetches and pulls on a ready, writable connection", () => {
    expect(syncReady(ready)).toBe(true);
  });

  it.each<[string, Partial<SyncConditions>]>([
    ["when the command cannot run", { canRun: false }],
    ["while a repository operation is busy", { recoveryBusy: true }],
    ["while pulling", { pulling: true }],
    ["before repository status is known", { freshnessReady: false }],
  ])("disables fetch and pull %s", (_, override) => {
    expect(syncReady({ ...ready, ...override })).toBe(false);
  });
});
