import {
  type Icon,
  IconBrandCSharp,
  IconBrandDocker,
  IconBrandGit,
  IconBrandJavascript,
  IconBrandPython,
  IconBrandReact,
  IconBrandTypescript,
  IconCode,
  IconDatabase,
  IconFile,
  IconFileTypeCss,
  IconFileTypeHtml,
  IconFileTypePdf,
  IconFileZip,
  IconJson,
  IconMarkdown,
  IconPhoto,
  IconSettings,
  IconTerminal2,
} from "@tabler/icons-react";

const fileTypes: Readonly<Record<string, Icon>> = {
  ts: IconBrandTypescript,
  mts: IconBrandTypescript,
  cts: IconBrandTypescript,
  tsx: IconBrandReact,
  jsx: IconBrandReact,
  js: IconBrandJavascript,
  mjs: IconBrandJavascript,
  cjs: IconBrandJavascript,
  cs: IconBrandCSharp,
  py: IconBrandPython,
  json: IconJson,
  jsonc: IconJson,
  md: IconMarkdown,
  mdx: IconMarkdown,
  css: IconFileTypeCss,
  scss: IconFileTypeCss,
  html: IconFileTypeHtml,
  htm: IconFileTypeHtml,
  sql: IconDatabase,
  yaml: IconSettings,
  yml: IconSettings,
  toml: IconSettings,
  ini: IconSettings,
  xml: IconCode,
  csproj: IconCode,
  sh: IconTerminal2,
  bash: IconTerminal2,
  ps1: IconTerminal2,
  bat: IconTerminal2,
  png: IconPhoto,
  jpg: IconPhoto,
  jpeg: IconPhoto,
  gif: IconPhoto,
  webp: IconPhoto,
  svg: IconPhoto,
  ico: IconPhoto,
  pdf: IconFileTypePdf,
  zip: IconFileZip,
  gz: IconFileZip,
  tar: IconFileZip,
  rs: IconCode,
  go: IconCode,
  java: IconCode,
  c: IconCode,
  cpp: IconCode,
  h: IconCode,
  rb: IconCode,
  php: IconCode,
};

export function ChangeFileIcon({ path }: { readonly path: string }) {
  const name = path.split("/").at(-1)?.toLowerCase() ?? "";
  const extension = name.includes(".") ? (name.split(".").at(-1) ?? "") : "";
  const FileIcon = name.startsWith(".git")
    ? IconBrandGit
    : name === "dockerfile" || name.endsWith(".dockerfile")
      ? IconBrandDocker
      : name === ".env" || name.startsWith(".env.")
        ? IconSettings
        : (fileTypes[extension] ?? IconFile);
  return (
    <FileIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
  );
}
