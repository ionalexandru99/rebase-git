import { expect, it } from "vite-plus/test";
import { tokenMarks } from "#server/features/repository-conflicts/regions/token-marks";

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
