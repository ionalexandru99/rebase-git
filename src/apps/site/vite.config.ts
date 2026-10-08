import tailwindcss from "@tailwindcss/vite";
import { defineConfig, type Plugin } from "vite-plus";

const downloadExtensions = {
  mac: ".dmg",
  windows: ".exe",
  linux: ".AppImage",
  debian: ".deb",
} as const;

type ReleaseAsset = {
  readonly name: string;
  readonly browser_download_url: string;
};

async function releaseAssets(): Promise<readonly ReleaseAsset[]> {
  const release = process.env.RELEASE_TAG
    ? `tags/${process.env.RELEASE_TAG}`
    : "latest";
  const token = process.env.GITHUB_TOKEN;
  const response = await fetch(
    `https://api.github.com/repos/ionalexandru99/rebase-git/releases/${release}`,
    { headers: token ? { authorization: `Bearer ${token}` } : {} },
  );
  if (!response.ok) {
    throw new Error(`GitHub release ${release} answered ${response.status}`);
  }
  const { assets } = (await response.json()) as {
    readonly assets: readonly ReleaseAsset[];
  };
  return assets;
}

function downloadLinks(): Plugin {
  return {
    name: "rebase-download-links",
    async transformIndexHtml(html) {
      const assets = await releaseAssets();
      return Object.entries(downloadExtensions).reduce(
        (page, [system, extension]) => {
          const asset = assets.find((file) => file.name.endsWith(extension));
          if (asset === undefined) {
            throw new Error(`The release has no ${extension} file`);
          }
          return page.replaceAll(
            `%download-${system}%`,
            asset.browser_download_url,
          );
        },
        html,
      );
    },
  };
}

export default defineConfig({
  publicDir: "../web/public",
  plugins: [tailwindcss(), downloadLinks()],
  build: {
    outDir: "dist",
  },
});
