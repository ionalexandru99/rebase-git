import { expect, it } from "vite-plus/test";
import { countMarkerBlocks } from "#server/features/repository-conflicts/git/conflict-files.ts";

it("counts only complete marker blocks of the configured size", () => {
  const text = [
    "<<<<<<< not a marker at size nine",
    "<<<<<<<<< current",
    "mine\r",
    "||||||||| base",
    "base",
    "=========",
    "theirs",
    ">>>>>>>>> incoming",
    "<<<<<<<<< unfinished",
    "",
  ].join("\n");

  expect(countMarkerBlocks(text, 9)).toBe(1);
  expect(countMarkerBlocks(text, 7)).toBe(0);
});
