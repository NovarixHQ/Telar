"use client";

import { Toast } from "@base-ui/react/toast";
import { CircleAlertIcon, CircleCheckIcon, XIcon } from "lucide-react";
import { useNativeViewOverlay } from "@/platform/desktop/native-view-overlay";
import { cn } from "@/ui/utils";

export type ToastAction = { id: string; label: string; onClick: () => void; disabled?: boolean };
export type ToastData = { actions?: readonly ToastAction[] };

/** Add, update or close a toast from anywhere: `toastManager.add({ title, type: "success", data: { actions } })`. */
export const toastManager = Toast.createToastManager();

const ACTION = "rounded-md border border-border px-2 py-0.5 text-2xs font-medium hover:bg-muted disabled:pointer-events-none disabled:opacity-60";

function ToastList() {
  const { toasts } = Toast.useToastManager<ToastData>();
  // The native browser view draws above the page, so a visible toast takes it down like any overlay.
  useNativeViewOverlay(toasts.length > 0);
  return toasts.map((toast) => (
    <Toast.Root
      key={toast.id}
      toast={toast}
      className="pointer-events-auto flex w-full items-start gap-2 rounded-lg bg-popover p-2.5 text-popover-foreground shadow-3 ring-1 ring-foreground/10 data-ending-style:opacity-0 data-starting-style:opacity-0 transition-opacity duration-150"
    >
      {toast.type === "error" ? (
        <CircleAlertIcon aria-hidden className="mt-0.5 size-3.5 shrink-0 text-destructive" />
      ) : (
        <CircleCheckIcon aria-hidden className="mt-0.5 size-3.5 shrink-0 text-primary" />
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <Toast.Title className="text-xs font-medium">{toast.title}</Toast.Title>
        {toast.description ? <Toast.Description className="text-2xs text-muted-foreground">{toast.description}</Toast.Description> : null}
        {toast.data?.actions?.length ? (
          <div className="flex flex-wrap gap-1">
            {toast.data.actions.map((action) => (
              <button key={action.id} type="button" disabled={action.disabled} onClick={action.onClick} className={ACTION}>
                {action.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <Toast.Close aria-label="Dismiss" className={cn("shrink-0 rounded-md p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground")}>
        <XIcon className="size-3.5" />
      </Toast.Close>
    </Toast.Root>
  ));
}

/** Mounted once at the root; renders whatever `toastManager` holds. */
export function Toaster() {
  return (
    <Toast.Provider toastManager={toastManager}>
      <Toast.Portal>
        <Toast.Viewport className="pointer-events-none fixed right-4 bottom-4 z-[100] flex w-80 flex-col gap-2">
          <ToastList />
        </Toast.Viewport>
      </Toast.Portal>
    </Toast.Provider>
  );
}
