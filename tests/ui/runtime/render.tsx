import { Layer, ManagedRuntime } from "effect";
import type { ReactNode } from "react";
import { afterEach } from "vitest";
import {
  cleanup,
  type RenderOptions,
  render as renderComponent,
} from "vitest-browser-react";
import { ApplicationRuntime } from "#web-ui/platform/effect/application-runtime-context";

const runtimes = new Set<ManagedRuntime.ManagedRuntime<never, never>>();

afterEach(async () => {
  await cleanup();
  await Promise.all([...runtimes].map((runtime) => runtime.dispose()));
  runtimes.clear();
});

export function render(children: ReactNode, options: RenderOptions = {}) {
  const runtime = ManagedRuntime.make(Layer.empty);
  runtimes.add(runtime);
  const Wrapper = options.wrapper;
  return renderComponent(children, {
    ...options,
    wrapper: ({ children }) => (
      <ApplicationRuntime value={runtime}>
        {Wrapper === undefined ? children : <Wrapper>{children}</Wrapper>}
      </ApplicationRuntime>
    ),
  });
}
