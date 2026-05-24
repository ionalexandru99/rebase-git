import { GitBranchIcon } from 'lucide-solid'

export function OnboardingHero() {
  return (
    <div class="mb-6 text-center">
      <div class="mx-auto mb-3.5 flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 ring-1 ring-inset ring-primary/30">
        <GitBranchIcon class="h-4 w-4 text-primary" stroke-width={2} />
      </div>
      <h1 class="text-xl font-semibold tracking-tight text-foreground">Welcome to Rebase</h1>
      <p class="mx-auto mt-1.5 max-w-xs text-sm leading-relaxed text-muted-foreground">
        Set up your workspace by choosing the folder where you keep your Git repositories.
      </p>
    </div>
  )
}
