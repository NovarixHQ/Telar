import { Skeleton } from "@/ui/skeleton";

const ROWS = ["w-1/3", "w-2/5", "w-1/4"];

/** One settings group's shape, drawn while its section's code loads. */
export function SettingsSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading settings" role="status" className="mb-6 last:mb-0">
      <Skeleton className="mx-4 mb-2 h-3.5 w-28" />
      <div className="divide-y divide-border/60 rounded-xl border border-border bg-card shadow-1">
        {ROWS.map((width) => (
          <div key={width} className="flex items-center gap-4 px-4 py-3">
            <Skeleton className={`h-4 ${width}`} />
            <span className="flex-1" />
            <Skeleton className="h-6 w-20" />
          </div>
        ))}
      </div>
    </div>
  );
}
