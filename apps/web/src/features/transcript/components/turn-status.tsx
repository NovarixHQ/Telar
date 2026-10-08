"use client";

import { useNow } from "@/ui/hooks/use-now";
import { fmtElapsed } from "@/ui/format";
import { HourglassIcon, TriangleAlertIcon } from "lucide-react";
import { type RateLimitType, type TurnFailureCode } from "@telar/engine-client";
import { Shimmer } from "@/ui/shimmer";
import { cn } from "@/ui/utils";

export function Marker({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 py-0.5">
      <span className="h-px flex-1 bg-border" />
      <span className="flex max-w-[80%] items-center gap-1.5 rounded-full border border-dashed border-border px-2.5 py-0.5 text-center font-mono text-4xs text-muted-foreground">
        {children}
      </span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

// The folder banner under the composer carries the remedy, so the row only names the stop.
const BRIEF: Partial<Record<TurnFailureCode, string>> = {
  workspace_unavailable: "Stopped: the project folder isn't reachable",
};

/** The failure's first sentence leads; the rest waits behind the disclosure. */
function splitFailure(failure: string, code?: TurnFailureCode): { lead: string; rest: string } {
  const brief = code && BRIEF[code];
  if (brief) return { lead: brief, rest: failure };
  const [lead = failure, ...rest] = failure.split(/(?<=[.!?])\s+(?=[A-Z])/);
  return { lead, rest: rest.join(" ") };
}

function FailureRow({ failure, code, detail }: { failure: string; code?: TurnFailureCode | undefined; detail?: string | undefined }) {
  const { lead, rest } = splitFailure(failure, code);
  const more = [rest, detail].filter(Boolean).join("\n\n");
  return (
    <div role="status" className="py-0.5 text-sm text-muted-foreground">
      <div className="flex items-start gap-2">
        <TriangleAlertIcon aria-hidden className="mt-0.5 size-3.5 shrink-0 text-warning" />
        <span className="min-w-0 flex-1">{lead}</span>
      </div>
      {more && (
        <details className="mt-1 pl-5.5 text-xs">
          <summary className="cursor-pointer select-none">Details</summary>
          <p className="mt-1 whitespace-pre-wrap break-words">{more}</p>
        </details>
      )}
    </div>
  );
}

export function TurnFailureRow({
  failure,
  code,
  detail,
  resumeAt,
  limitType,
  onResume,
  resuming,
}: {
  failure: string;
  code?: TurnFailureCode;
  detail?: string;
  resumeAt?: number;
  limitType?: RateLimitType;
  onResume?: () => void;
  resuming?: boolean;
}) {
  // A limit with no reset time cannot promise one, so it falls back to the
  // ordinary row rather than rendering "resets at Invalid Date".
  if (code !== "rate_limited" || resumeAt === undefined) return <FailureRow failure={failure} code={code} detail={detail} />;
  const resets = new Date(resumeAt);
  const sameDay = resets.toDateString() === new Date().toDateString();
  const at = sameDay
    ? resets.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : resets.toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" });
  // `other` names nothing a person can act on, so it earns no parenthetical —
  // the same rule `titleForProviderWait` follows in the engine.
  const limit = limitType && limitType !== "other" ? `${limitType.replaceAll("_", " ")} ` : "";
  return (
    <div role="status" className="flex flex-wrap items-center gap-x-2 gap-y-1 py-0.5 text-sm text-muted-foreground">
      <HourglassIcon className="size-3.5 shrink-0" />
      <span className="min-w-0 flex-1">
        Waiting for the {limit}limit to reset at {at}
      </span>
      {onResume && (
        <button
          type="button"
          disabled={resuming}
          onClick={onResume}
          className="shrink-0 rounded-md border border-border px-2 py-0.5 text-2xs text-foreground transition-colors outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
        >
          {resuming ? "Resuming…" : "Resume now"}
        </button>
      )}
    </div>
  );
}

/** Seconds of silence before the indicator flips to its long-silence state. */
const SILENCE_THRESHOLD = 20;

export function WorkingIndicator({
  label,
  startedAt,
  lastActivityAt,
  delegated,
  compacting,
  awaiting,
}: {
  label: string;
  startedAt?: number;
  /** When anything last happened on this turn. Absent means nothing has yet. */
  lastActivityAt?: number;
  /** Sub-agents are carrying this turn. A quiet main loop is then the CORRECT
   *  state rather than a stalled one. */
  delegated?: boolean;
  /** The provider is squeezing its context. Silence is what a compaction IS —
   *  see `isCompacting`. */
  compacting?: boolean;
  /** A person owes the turn an answer, so its silence is theirs, not the agent's. */
  awaiting?: boolean;
}) {
  const now = useNow(1_000);
  const elapsed = startedAt ? Math.max(0, Math.floor((now - startedAt) / 1000)) : 0;
  const quiet = lastActivityAt ? Math.max(0, Math.floor((now - lastActivityAt) / 1000)) : elapsed;
  // Delegation, compaction and an open question are all silences on purpose;
  // warning on them would make the readout noise where it should mean "stuck".
  const silent = !delegated && !compacting && !awaiting && quiet >= SILENCE_THRESHOLD;

  return (
    <div className={cn("flex items-center gap-2 text-2xs text-muted-foreground/70", silent && "text-warning/80")}>
      <span
        aria-hidden
        className={cn("size-1.5 shrink-0 rounded-full motion-safe:animate-pulse", silent ? "bg-warning" : "bg-muted-foreground/50")}
      />
      <Shimmer as="span" className={cn("text-2xs", silent && "text-warning/80")}>
        {label}
      </Shimmer>
      <span className="shrink-0 font-mono tabular-nums">{fmtElapsed(elapsed)}</span>
      {/* A run that has said nothing for 20s is the case a detached session most
          needs surfaced — it is the difference between slow and stuck. */}
      {silent && <span className="shrink-0 font-mono tabular-nums text-warning">· no output {fmtElapsed(quiet)}</span>}
    </div>
  );
}
