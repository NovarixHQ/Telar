import { Skeleton } from "@/ui/skeleton";

/** The conversation frame a `loading.tsx` draws so a navigation commits at once; vague on purpose. */
export function SessionSkeleton({ composer = false }: { composer?: boolean }) {
  return (
    <main data-surfaces className="group/surfaces flex min-h-0 flex-1 overflow-hidden md:overflow-visible md:gap-2" aria-busy="true">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden md:rounded-xl md:bg-sidebar md:shadow-sm md:ring-1 md:ring-sidebar-border">
        <div className="flex h-12 shrink-0 items-center gap-2 px-4">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-24" />
          <span className="flex-1" />
          <Skeleton className="size-7" />
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-hidden px-4 py-6">
          {composer ? (
            <div className="m-auto w-full max-w-(--chat-content-max-width) space-y-3">
              <Skeleton className="mx-auto h-6 w-56" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : (
            <div className="mx-auto w-full max-w-(--chat-content-max-width) space-y-6">
              <div className="flex justify-end">
                <Skeleton className="h-10 w-2/5" />
              </div>
              <div className="space-y-2">
                <Skeleton className="h-4 w-11/12" />
                <Skeleton className="h-4 w-4/5" />
                <Skeleton className="h-4 w-2/3" />
              </div>
              <div className="flex justify-end">
                <Skeleton className="h-8 w-1/3" />
              </div>
              <div className="space-y-2">
                <Skeleton className="h-4 w-10/12" />
                <Skeleton className="h-4 w-3/5" />
              </div>
            </div>
          )}
        </div>
        {!composer && (
          <div className="shrink-0 px-4 pb-4">
            <Skeleton className="mx-auto h-20 w-full max-w-(--chat-content-max-width)" />
          </div>
        )}
      </div>
    </main>
  );
}
