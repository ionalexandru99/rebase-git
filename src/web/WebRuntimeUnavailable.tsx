export function WebRuntimeUnavailable(): React.JSX.Element {
  return (
    <main className="grid min-h-screen place-items-center bg-background p-6 text-foreground">
      <section className="max-w-md space-y-3 text-center">
        <h1 className="text-xl font-semibold">Web runtime unavailable</h1>
        <p className="text-sm text-muted-foreground">
          The browser client will be enabled when the local server runtime is available.
        </p>
      </section>
    </main>
  )
}
