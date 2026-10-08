import {
  IconAlertCircle,
  IconCircleCheck,
  IconCircleFilled,
} from "@tabler/icons-react";
import { type ReactNode, useLayoutEffect, useRef } from "react";

const fullTurnMs = 250;

type RingMotion = {
  readonly from: number;
  readonly to: number;
  readonly at: number;
};

export function NoticeCard({
  icon,
  heading,
  body,
  dismiss,
  actions,
}: {
  readonly icon: ReactNode;
  readonly heading: ReactNode;
  readonly body?: ReactNode;
  readonly dismiss?: ReactNode;
  readonly actions?: ReactNode;
}) {
  return (
    <>
      <div className="flex items-start gap-3">
        {icon}
        <div className="min-w-0 flex-1">
          {heading}
          {body}
        </div>
        {dismiss}
      </div>
      {actions === undefined ? null : (
        <div className="mt-2.5 flex justify-end gap-1.5">{actions}</div>
      )}
    </>
  );
}

export function NoticeIcon({
  type,
  percent,
  label,
  onFilled,
}: {
  readonly type: string | undefined;
  readonly percent: number | undefined;
  readonly label: string;
  readonly onFilled?: (() => void) | undefined;
}) {
  if ((type === "loading" || type === "success") && percent !== undefined)
    return (
      <ProgressRing
        percent={percent}
        done={type === "success"}
        label={label}
        onFilled={onFilled}
      />
    );
  if (type === "loading")
    return (
      <span
        aria-hidden="true"
        className="flex h-5 w-4 shrink-0 items-center justify-center"
      >
        <IconCircleFilled className="size-2 text-warning" />
      </span>
    );
  return type === "success" ? (
    <IconCircleCheck
      aria-hidden="true"
      className="mt-0.5 size-4 shrink-0 text-success"
    />
  ) : (
    <IconAlertCircle
      aria-hidden="true"
      className="mt-0.5 size-4 shrink-0 text-destructive"
    />
  );
}

function ProgressRing({
  percent,
  done,
  label,
  onFilled,
}: {
  readonly percent: number;
  readonly done: boolean;
  readonly label: string;
  readonly onFilled: (() => void) | undefined;
}) {
  const arc = useRef<SVGCircleElement>(null);
  const motion = useRef<RingMotion>({ from: 0, to: 0, at: 0 });
  const target = done ? 100 : percent;
  useLayoutEffect(() => {
    const element = arc.current;
    if (element === null) return;
    const now = performance.now();
    const from = position(motion.current, now);
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    motion.current = { from: still ? target : from, to: target, at: now };
    const animation = element.animate(
      [{ strokeDashoffset: 100 - from }, { strokeDashoffset: 100 - target }],
      {
        duration: still ? 0 : (Math.abs(target - from) / 100) * fullTurnMs,
        easing: "linear",
        fill: "forwards",
      },
    );
    if (target === 100 && onFilled !== undefined)
      animation.finished.then(onFilled, () => {});
    return () => animation.cancel();
  }, [target, onFilled]);
  return (
    <svg
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      aria-hidden={done}
      className="mt-0.5 size-4 shrink-0"
      viewBox="0 0 16 16"
      fill="none"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <g transform="rotate(-90 8 8)">
        <circle cx="8" cy="8" r="6" className="stroke-foreground/15" />
        <circle
          ref={arc}
          cx="8"
          cy="8"
          r="6"
          pathLength={100}
          strokeDasharray="100 200"
          className={`transition-[stroke] duration-150 motion-reduce:transition-none ${done ? "stroke-success" : "stroke-primary"}`}
        />
      </g>
      <path
        d="M6 8l1.5 1.5l3 -3"
        strokeWidth="1.5"
        className={`stroke-success transition-opacity duration-150 motion-reduce:transition-none ${done ? "opacity-100" : "opacity-0"}`}
      />
    </svg>
  );
}

function position({ from, to, at }: RingMotion, now: number) {
  const travelled = ((now - at) / fullTurnMs) * 100;
  return from < to
    ? Math.min(to, from + travelled)
    : Math.max(to, from - travelled);
}
