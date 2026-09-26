import { expect, it } from "vite-plus/test";
import {
  commitMessage,
  draftFromMessage,
} from "#web/features/working-changes/draft/commit-draft";

it("joins the subject and description with one blank line and drops an empty body", () => {
  expect(
    commitMessage({ subject: "  Fix login  ", description: "\n Details \n" }),
  ).toBe("Fix login\n\nDetails");
  expect(commitMessage({ subject: "Fix login", description: "  " })).toBe(
    "Fix login",
  );
});

it("splits an amended commit message into a draft on LF and CRLF lines", () => {
  expect(
    draftFromMessage("Fix login\r\n\r\nFirst line\r\nSecond line"),
  ).toEqual({ subject: "Fix login", description: "First line\nSecond line" });
});
