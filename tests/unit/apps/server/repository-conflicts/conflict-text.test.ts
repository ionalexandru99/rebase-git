import { expect, it } from "vite-plus/test";
import {
  conflictExcerpts,
  conflictText,
} from "#server/features/repository-conflicts/git/conflict-text.ts";

const block = (name: string) => [
  `<<<<<<< ${name} current`,
  "mine",
  `||||||| ${name} base`,
  "base",
  "=======",
  "theirs",
  `>>>>>>> ${name} incoming`,
];

const numbered = (from: number, count: number) =>
  Array.from({ length: count }, (_, index) => `line ${from + index}`);

it("finds only complete marker blocks of the configured size", () => {
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

  expect(conflictText(Buffer.from(text), 9).blocks).toEqual([
    { start: 1, end: 7 },
  ]);
  expect(conflictText(Buffer.from(text), 7).blocks).toEqual([]);
});

it("sends each block with three lines around it and joins blocks whose context touches", () => {
  const lines = [
    ...numbered(1, 5),
    ...block("a"),
    ...numbered(13, 6),
    ...block("b"),
    ...numbered(26, 7),
    ...block("c"),
    "last",
  ];

  const excerpts = conflictExcerpts(
    conflictText(Buffer.from(`${lines.join("\n")}\n`), 7),
  );

  expect(excerpts).toEqual([
    {
      line: 3,
      text: `${[...numbered(3, 3), ...block("a"), ...numbered(13, 6), ...block("b"), ...numbered(26, 3)].join("\n")}\n`,
    },
    {
      line: 30,
      text: `${[...numbered(30, 3), ...block("c"), "last"].join("\n")}\n`,
    },
  ]);
});
