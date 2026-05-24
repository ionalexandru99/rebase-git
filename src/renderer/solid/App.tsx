import { createSignal } from 'solid-js'

export default function App() {
  const [count, setCount] = createSignal(0)
  return (
    <div class="flex h-screen items-center justify-center bg-background text-foreground">
      <div class="flex flex-col items-center gap-4">
        <h1 class="text-2xl font-semibold">Rebase — SolidJS renderer</h1>
        <p class="text-muted-foreground text-sm">Scaffold online. Migration in progress.</p>
        <button
          type="button"
          class="rounded-md border px-3 py-1.5 text-sm"
          onClick={() => setCount((value) => value + 1)}
        >
          clicked {count()} times
        </button>
      </div>
    </div>
  )
}
