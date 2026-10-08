import { execFile } from "node:child_process";
import { access, readdir, readFile, realpath } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { build } from "esbuild";
import type { Plugin } from "vite-plus";
import {
  type ThirdPartyLicense,
  thirdPartyLicensesFile,
} from "#contracts/third-party-licenses/third-party-licenses.contract.ts";
import { rustTargets } from "./build-process-monitor.ts";

interface PackageJson {
  readonly name?: string;
  readonly version?: string;
  readonly license?: unknown;
  readonly homepage?: unknown;
  readonly repository?: unknown;
  readonly dependencies?: Readonly<Record<string, string>>;
}

interface InstalledPackage {
  readonly root: string;
  readonly manifest: PackageJson;
}

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const vendoredNotices = fileURLToPath(
  new URL("third-party-notices/", import.meta.url),
);

const nodeEntryPoints = [
  "src/apps/server/cli.ts",
  "src/apps/desktop/main.ts",
  "src/apps/desktop/platform/environment/environment-process.ts",
  "src/apps/desktop/preload.ts",
];

const bundledAssets: readonly Omit<ThirdPartyLicense, "notice">[] = [
  {
    name: "Symbols Nerd Font Mono",
    version: null,
    license: "MIT",
    sourceUrl: "https://github.com/ryanoasis/nerd-fonts",
  },
];

const noticeFileName = /^(?:licen[cs]e|copying|notice)(?:[._-][\w.-]*)?$/i;
const noticeExtensions = new Set(["", ".md", ".txt", ".markdown"]);

export function thirdPartyLicenses(): Plugin {
  return {
    name: "rebase:third-party-licenses",
    apply: "build",
    async generateBundle(_options, bundle) {
      const webModules = Object.values(bundle).flatMap((output) =>
        output.type === "chunk" ? Object.keys(output.modules) : [],
      );
      this.emitFile({
        type: "asset",
        fileName: thirdPartyLicensesFile,
        source: JSON.stringify(await collectThirdPartyLicenses(webModules)),
      });
    },
  };
}

async function collectThirdPartyLicenses(
  webModules: readonly string[],
): Promise<ThirdPartyLicense[]> {
  const packages = new Map<string, InstalledPackage>();
  const add = (found: InstalledPackage | undefined) => {
    if (found !== undefined)
      packages.set(`${found.manifest.name}@${found.manifest.version}`, found);
  };

  const files = [
    ...webModules.map(moduleFile),
    ...(await nodeBundleInputs()),
  ].filter((file): file is string => file !== undefined);
  for (const file of files) add(await owningPackage(file));
  for (const name of await cssImports(files))
    add(await installedPackage(name, repositoryRoot));
  for (const found of await runtimeDependencies()) add(found);
  for (const found of await processMonitorCrates()) add(found);

  const failures: string[] = [];
  const licenses: ThirdPartyLicense[] = [];
  for (const { root, manifest } of packages.values()) {
    const license = declaredLicense(manifest);
    const notice =
      (await packageNotice(root)) ??
      (await vendoredNotice(manifest.name ?? basename(root)));
    if (license === undefined || notice === undefined) {
      failures.push(`${manifest.name}@${manifest.version}`);
      continue;
    }
    licenses.push({
      name: manifest.name ?? basename(root),
      version: manifest.version ?? null,
      license,
      sourceUrl: sourceUrl(manifest),
      notice,
    });
  }
  if (failures.length > 0)
    throw new Error(
      `These bundled packages declare no license or ship no notice file (add notices to packaging/third-party-notices):\n${failures.join("\n")}`,
    );

  for (const asset of bundledAssets) {
    const notice = await vendoredNotice(asset.name);
    if (notice === undefined) throw new Error(`${asset.name} has no notice`);
    licenses.push({ ...asset, notice });
  }
  return licenses.sort(
    (left, right) =>
      left.name.localeCompare(right.name) ||
      (left.version ?? "").localeCompare(right.version ?? ""),
  );
}

async function nodeBundleInputs() {
  const { metafile } = await build({
    absWorkingDir: repositoryRoot,
    bundle: true,
    conditions: ["node", "import"],
    entryPoints: nodeEntryPoints,
    external: ["electron", "@lydell/node-pty"],
    format: "esm",
    logLevel: "silent",
    metafile: true,
    outdir: "out",
    platform: "node",
    target: "node24",
    write: false,
  });
  return Object.keys(metafile.inputs)
    .filter((input) => !/^[\w-]+:/.test(input))
    .map((input) => join(repositoryRoot, input));
}

async function processMonitorCrates() {
  const crates = new Map<string, InstalledPackage>();
  for (const target of Object.values(rustTargets)) {
    const { stdout } = await promisify(execFile)(
      "cargo",
      [
        "metadata",
        "--format-version",
        "1",
        "--locked",
        "--filter-platform",
        target,
        "--manifest-path",
        "native/process-monitor/Cargo.toml",
      ],
      { cwd: repositoryRoot, maxBuffer: 64 * 1_048_576 },
    );
    const metadata = JSON.parse(stdout) as {
      readonly packages: readonly (PackageJson & {
        readonly id: string;
        readonly manifest_path: string;
      })[];
      readonly workspace_members: readonly string[];
    };
    for (const crate of metadata.packages)
      if (!metadata.workspace_members.includes(crate.id))
        crates.set(crate.id, {
          root: dirname(crate.manifest_path),
          manifest: crate,
        });
  }
  return crates.values();
}

async function runtimeDependencies() {
  const found: InstalledPackage[] = [];
  const visit = async (manifest: PackageJson, from: string) => {
    for (const name of Object.keys(manifest.dependencies ?? {})) {
      const dependency = await installedPackage(name, from);
      if (
        dependency === undefined ||
        found.some(({ root }) => root === dependency.root)
      )
        continue;
      found.push(dependency);
      await visit(dependency.manifest, dependency.root);
    }
  };
  await visit(await readManifest(repositoryRoot), repositoryRoot);
  return found;
}

async function cssImports(files: readonly string[]) {
  const names = new Set<string>();
  for (const file of files) {
    if (extname(file) !== ".css" || isInstalled(file)) continue;
    const source = await readFile(file, "utf8");
    for (const [, specifier] of source.matchAll(
      /@import\s+["']([^"'.][^"']*)["']/g,
    ))
      names.add(packageName(specifier ?? ""));
  }
  return names;
}

function moduleFile(id: string) {
  if (id.startsWith("\0")) return undefined;
  return id.split("?", 1)[0];
}

async function owningPackage(
  file: string,
): Promise<InstalledPackage | undefined> {
  if (!isInstalled(file)) return undefined;
  for (
    let directory = dirname(await realpath(file));
    basename(directory) !== "node_modules" && dirname(directory) !== directory;
    directory = dirname(directory)
  ) {
    const manifest = await readManifest(directory).catch(() => undefined);
    if (manifest?.name !== undefined && manifest.version !== undefined)
      return { root: directory, manifest };
  }
  return undefined;
}

async function installedPackage(
  name: string,
  from: string,
): Promise<InstalledPackage | undefined> {
  for (let directory = from; ; directory = dirname(directory)) {
    const candidate = join(directory, "node_modules", name);
    if (await exists(join(candidate, "package.json"))) {
      const root = await realpath(candidate);
      return { root, manifest: await readManifest(root) };
    }
    if (dirname(directory) === directory) return undefined;
  }
}

async function packageNotice(root: string) {
  const files = (await readdir(root, { withFileTypes: true }))
    .filter(
      (entry) =>
        entry.isFile() &&
        noticeFileName.test(entry.name) &&
        noticeExtensions.has(extname(entry.name).toLowerCase()),
    )
    .map((entry) => entry.name)
    .sort();
  const notices = await Promise.all(
    files.map(async (file) =>
      (await readFile(join(root, file), "utf8")).trim(),
    ),
  );
  const text = notices.filter(Boolean).join("\n\n---\n\n");
  return text === "" ? undefined : text;
}

async function vendoredNotice(name: string) {
  const file = join(
    vendoredNotices,
    `${name.toLowerCase().replaceAll(/[^\w.-]+/g, "-")}.txt`,
  );
  return (await exists(file))
    ? (await readFile(file, "utf8")).trim()
    : undefined;
}

function declaredLicense({ license }: PackageJson) {
  if (typeof license === "string" && license.trim() !== "")
    return license.trim();
  if (
    typeof license === "object" &&
    license !== null &&
    "type" in license &&
    typeof license.type === "string"
  )
    return license.type;
  return undefined;
}

function sourceUrl({ homepage, repository }: PackageJson) {
  const url =
    typeof repository === "string"
      ? repository
      : typeof repository === "object" &&
          repository !== null &&
          "url" in repository &&
          typeof repository.url === "string"
        ? repository.url
        : typeof homepage === "string"
          ? homepage
          : undefined;
  if (url === undefined) return null;
  const normalized = url
    .replace(/^github:/, "https://github.com/")
    .replace(/^git\+/, "")
    .replace(/^(?:ssh:\/\/)?git@github\.com[:/]/, "https://github.com/")
    .replace(/^git:\/\//, "https://")
    .replace(/\.git$/, "")
    .replace(/^([\w.-]+\/[\w.-]+)$/, "https://github.com/$1");
  return /^https?:\/\//.test(normalized) ? normalized : null;
}

function packageName(specifier: string) {
  const parts = specifier.split("/");
  return specifier.startsWith("@")
    ? parts.slice(0, 2).join("/")
    : (parts[0] ?? specifier);
}

function isInstalled(path: string) {
  return path.replaceAll("\\", "/").includes("/node_modules/");
}

async function readManifest(directory: string): Promise<PackageJson> {
  return JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
}

async function exists(path: string) {
  return access(path).then(
    () => true,
    () => false,
  );
}
