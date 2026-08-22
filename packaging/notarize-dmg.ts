import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execute = promisify(execFile);

export async function notarizeDmg({
  artifactPaths,
}: {
  readonly artifactPaths: readonly string[];
}) {
  if (process.platform !== "darwin" || !process.env.APPLE_TEAM_ID) return [];

  const dmgPaths = artifactPaths.filter((path) => path.endsWith(".dmg"));
  for (const path of dmgPaths) {
    await execute("xcrun", [
      "notarytool",
      "submit",
      path,
      "--wait",
      "--apple-id",
      process.env.APPLE_ID ?? "",
      "--password",
      process.env.APPLE_APP_SPECIFIC_PASSWORD ?? "",
      "--team-id",
      process.env.APPLE_TEAM_ID,
    ]);
    await execute("xcrun", ["stapler", "staple", path]);
  }

  return [];
}
