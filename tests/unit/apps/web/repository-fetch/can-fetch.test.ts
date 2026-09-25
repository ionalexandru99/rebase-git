import { describe, expect, it } from "vite-plus/test";
import {
  canFetch,
  type FetchConditions,
} from "#web/features/repository-fetch/can-fetch";

const ready: FetchConditions = {
  connected: true,
  writable: true,
  fetching: false,
  recoveryBusy: false,
  pulling: false,
  freshnessReady: true,
};

describe("fetch availability", () => {
  it("fetches on a ready, writable connection", () => {
    expect(canFetch(ready)).toBe(true);
  });

  it.each<[string, Partial<FetchConditions>]>([
    ["disconnected", { connected: false }],
    ["without write access", { writable: false }],
    ["while already fetching", { fetching: true }],
    ["while a repository operation is busy", { recoveryBusy: true }],
    ["while pulling", { pulling: true }],
    ["before repository status is known", { freshnessReady: false }],
  ])("disables fetch %s", (_, override) => {
    expect(canFetch({ ...ready, ...override })).toBe(false);
  });
});
