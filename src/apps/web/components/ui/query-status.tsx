import { Button } from "#web/components/ui/button.tsx";
import { cn } from "#web/lib/utils.ts";
import {
  describeFailure,
  type RequestFailure,
  type TaggedFailure,
} from "#web/platform/query/request-failure.ts";

export function QueryStatus<Failure extends TaggedFailure>({
  error,
  loading,
  onRetry,
  className = "p-3",
}: {
  readonly error: RequestFailure<Failure> | null;
  readonly loading?: string;
  readonly onRetry: () => void;
  readonly className?: string;
}) {
  if (error !== null)
    return (
      <div role="alert" className={cn("text-body", className)}>
        {describeFailure(error)}{" "}
        <Button size="xs" variant="ghost" onClick={onRetry}>
          Retry
        </Button>
      </div>
    );
  if (loading === undefined) return null;
  return (
    <p role="status" className="p-4 text-body text-muted-foreground">
      {loading}
    </p>
  );
}
