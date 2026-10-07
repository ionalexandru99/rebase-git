import {
  createFileTreeIconResolver,
  type FileTreeIcons,
  getBuiltInSpriteSheet,
} from "@pierre/trees";
import { useInsertionEffect } from "react";

export const fileIcons = {
  set: "complete",
  colored: true,
} as const satisfies FileTreeIcons;

const palette = {
  gray: "light-dark(#84848a, #adadb1)",
  red: "light-dark(#d52c36, #ff6762)",
  vermilion: "light-dark(#ff8c5b, #d5512f)",
  orange: "light-dark(#d47628, #ffa359)",
  yellow: "light-dark(#d5a910, #ffd452)",
  green: "light-dark(#199f43, #5ecc71)",
  teal: "light-dark(#17a5af, #64d1db)",
  cyan: "light-dark(#1ca1c7, #68cdf2)",
  blue: "light-dark(#1a85d4, #69b1ff)",
  indigo: "light-dark(#693acf, #9d6afb)",
  purple: "light-dark(#a631be, #d568ea)",
  pink: "light-dark(#d32a61, #ff678d)",
  mauve: "light-dark(#594c5b, #79697b)",
} as const;

const tokenColors: Readonly<Record<string, keyof typeof palette>> = {
  astro: "purple",
  database: "purple",
  vite: "purple",
  babel: "yellow",
  browserslist: "yellow",
  javascript: "yellow",
  bash: "green",
  markdown: "green",
  svgo: "green",
  vue: "green",
  biome: "blue",
  c: "blue",
  cpp: "blue",
  docker: "blue",
  python: "blue",
  typescript: "blue",
  vscode: "blue",
  webpack: "blue",
  bootstrap: "indigo",
  css: "indigo",
  eslint: "indigo",
  terraform: "indigo",
  wasm: "indigo",
  bun: "mauve",
  claude: "orange",
  html: "orange",
  json: "orange",
  rust: "orange",
  svg: "orange",
  swift: "orange",
  zig: "orange",
  zip: "orange",
  git: "vermilion",
  go: "cyan",
  oxc: "cyan",
  react: "cyan",
  tailwind: "cyan",
  graphql: "pink",
  image: "pink",
  sass: "pink",
  mcp: "teal",
  prettier: "teal",
  table: "teal",
  npm: "red",
  postcss: "red",
  ruby: "red",
  svelte: "red",
  yml: "red",
};

const spriteId = "rebase-file-icons";
const resolver = createFileTreeIconResolver(fileIcons);

function ensureSprite() {
  if (document.getElementById(spriteId) !== null) return;
  const sprite = document.createElement("div");
  sprite.id = spriteId;
  sprite.setAttribute("aria-hidden", "true");
  sprite.style.cssText =
    "position:absolute;width:0;height:0;overflow:hidden;pointer-events:none";
  sprite.innerHTML = getBuiltInSpriteSheet(fileIcons.set);
  document.body.prepend(sprite);
}

export function FileIcon({ path }: { readonly path: string }) {
  useInsertionEffect(ensureSprite, []);
  const icon = resolver.resolveIcon("file-tree-icon-file", path);
  return (
    <svg
      aria-hidden="true"
      viewBox={icon.viewBox ?? "0 0 16 16"}
      className="size-3.5 shrink-0"
      style={{ color: palette[tokenColors[icon.token ?? ""] ?? "gray"] }}
    >
      <use href={`#${icon.name}`} />
    </svg>
  );
}
