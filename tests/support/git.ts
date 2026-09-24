import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { promisify } from "node:util";

const execute = promisify(execFile);
const testIdentity = [
  "-c",
  "user.name=Rebase test",
  "-c",
  "user.email=rebase@example.test",
];

export async function git(path: string, ...arguments_: string[]) {
  const { stdout } = await execute("git", [
    "-C",
    path,
    ...testIdentity,
    ...arguments_,
  ]);
  return stdout.trim();
}

export async function createRepository(
  path: string,
  {
    commits = ["initial"],
    branches = [],
  }: {
    readonly commits?: readonly string[];
    readonly branches?: readonly string[];
  } = {},
) {
  await mkdir(path, { recursive: true });
  await git(path, "init", "-b", "main");
  for (const message of commits)
    await git(path, "commit", "--allow-empty", "-m", message);
  for (const branch of branches) await git(path, "branch", branch);
}

export async function fastImport(path: string, stream: string) {
  const imported = execute("git", ["-C", path, "fast-import", "--quiet"]);
  imported.child.stdin?.end(`${stream}done\n`);
  await imported;
}
