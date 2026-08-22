import { notarizeDmg } from "./packaging/notarize-dmg.ts";

export default {
  appId: "com.rebase-git.app",
  productName: "Rebase",
  directories: {
    output: "release",
  },
  files: [
    "package.json",
    {
      from: "src/apps/desktop/dist/package",
      to: ".",
      filter: ["**/*"],
    },
  ],
  extraMetadata: {
    main: "main.js",
  },
  artifactName: `\${productName}-\${version}-\${os}-\${arch}.\${ext}`,
  mac: {
    category: "public.app-category.developer-tools",
    icon: "src/apps/desktop/assets/icon.png",
    target: ["dmg", "zip"],
    hardenedRuntime: true,
    notarize: Boolean(process.env.APPLE_TEAM_ID),
  },
  dmg: {
    sign: true,
  },
  win: {
    icon: "src/apps/desktop/assets/icon.png",
    target: ["nsis"],
  },
  linux: {
    category: "Development",
    icon: "src/apps/desktop/assets/icon.png",
    target: ["AppImage", "deb"],
  },
  publish: {
    provider: "github",
    owner: "ionalexandru99",
    repo: "rebase-git",
  },
  afterAllArtifactBuild: notarizeDmg,
};
