import { FetchHttpClient } from '@effect/platform'
import { Layer, ManagedRuntime } from 'effect'
import { GitClient, GitClientLive, SidecarConfigFromIpc } from './git-client'

export const makeRuntime = <ROut, E>(layer: Layer.Layer<ROut, E>) => ManagedRuntime.make(layer)

const AppLayer = GitClientLive.pipe(
  Layer.provide(FetchHttpClient.layer),
  Layer.provide(SidecarConfigFromIpc)
)

export const runtime = makeRuntime(AppLayer)

export { GitClient }
