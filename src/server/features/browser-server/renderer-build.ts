import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { Data, Effect } from 'effect4'

export class RendererBuildFailure extends Data.TaggedError('RendererBuildFailure')<{
  readonly message: string
  readonly detail?: unknown
}> {}

export interface RendererBuild {
  readonly files: ReadonlyMap<string, Buffer>
  readonly indexHtml: string
  readonly productVersion: string
  readonly rendererBuildId: string
}

interface RendererManifest {
  readonly productVersion: string
  readonly rendererBuildId: string
}

async function loadFiles(webRoot: string, relativeDirectory = ''): Promise<Map<string, Buffer>> {
  const files = new Map<string, Buffer>()
  const directory = path.join(webRoot, relativeDirectory)
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relativePath = path.posix.join(relativeDirectory, entry.name)
    if (entry.isDirectory()) {
      for (const [nestedPath, contents] of await loadFiles(webRoot, relativePath)) {
        files.set(nestedPath, contents)
      }
    } else if (entry.isFile()) {
      files.set(relativePath, await readFile(path.join(webRoot, relativePath)))
    }
  }
  return files
}

function parseRendererManifest(contents: Buffer): RendererManifest {
  const parsed = JSON.parse(contents.toString('utf8')) as Partial<RendererManifest>
  if (
    typeof parsed.productVersion !== 'string' ||
    typeof parsed.rendererBuildId !== 'string' ||
    parsed.rendererBuildId.length < 8
  ) {
    throw new TypeError('The Web build manifest is invalid')
  }
  return parsed as RendererManifest
}

export function loadRendererBuild(
  webRoot: string
): Effect.Effect<RendererBuild, RendererBuildFailure> {
  return Effect.tryPromise({
    try: async () => {
      const files = await loadFiles(webRoot)
      const indexHtml = files.get('index.html')
      const manifestContents = files.get('rebase-manifest.json')
      if (!indexHtml || !manifestContents) {
        throw new TypeError('The Web build is missing index.html or rebase-manifest.json')
      }
      const manifest = parseRendererManifest(manifestContents)
      return {
        files,
        indexHtml: indexHtml.toString('utf8'),
        productVersion: manifest.productVersion,
        rendererBuildId: manifest.rendererBuildId
      }
    },
    catch: (detail) =>
      new RendererBuildFailure({ message: 'Could not load the exact Web build', detail })
  })
}
