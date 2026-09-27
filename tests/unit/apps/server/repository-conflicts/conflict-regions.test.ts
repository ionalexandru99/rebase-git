import { expect, it } from "vite-plus/test";
import {
  markerBlocks,
  openRegionLines,
  tokenMarks,
} from "#server/features/repository-conflicts/conflict-regions.ts";

it("reads only markers of the configured size", () => {
  const text = [
    "<<<<<<< not a marker at size nine",
    "<<<<<<<<< current",
    "mine\r",
    "=========",
    "theirs",
    ">>>>>>>>> incoming",
    "",
  ].join("\n");

  expect(markerBlocks(text, 9)).toEqual([
    { line: 2, current: ["mine"], base: [], incoming: ["theirs"] },
  ]);
  expect(markerBlocks(text, 7)).toEqual([]);
});

it("matches identical regions to separate marker blocks in order", () => {
  const region = { line: 0, current: ["x"], base: [], incoming: ["y"] };
  const block = (line: number) => ({ ...region, line, base: ["z"] });

  expect(
    openRegionLines([region, region, region], [block(3), block(9)]),
  ).toEqual([3, 9, null]);
});

it("marks only the tokens that differ from the base", () => {
  expect(
    tokenMarks(
      ["const total = count + 1;", "return total;"],
      ["const total = count * 2;", "return total;", "log(total);"],
    ),
  ).toEqual([
    { line: 0, start: 20, end: 21 },
    { line: 0, start: 22, end: 23 },
    { line: 2, start: 0, end: 11 },
  ]);
});
