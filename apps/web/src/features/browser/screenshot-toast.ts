import { toastManager, type ToastAction, type ToastData } from "@/ui/toast";
import type { DesktopBrowserBridge } from "./types";

const COPIED_MS = 2_000;

const failure = (error: unknown) => (error instanceof Error ? error.message : "An error occurred.");

export function showScreenshotToast(bridge: DesktopBrowserBridge, path: string) {
  const copied = { path: false, image: false };
  let id = "";

  const render = (title = "Screenshot saved", description?: string, type: "success" | "error" = "success") => {
    const actions: ToastAction[] = [];
    if (bridge.copyScreenshot) actions.push({ id: "copy-image", label: copied.image ? "Copied!" : "Copy image", disabled: copied.image, onClick: copyImage });
    actions.push({ id: "copy-path", label: copied.path ? "Copied!" : "Copy path", disabled: copied.path, onClick: copyPath });
    if (bridge.revealFile) actions.push({ id: "reveal", label: "Reveal in Finder", onClick: () => void bridge.revealFile?.(path) });
    const toast = { title, description, type, data: { actions } satisfies ToastData };
    if (id) toastManager.update(id, toast);
    else id = toastManager.add(toast);
  };

  const flash = (key: keyof typeof copied) => {
    copied[key] = true;
    render();
    window.setTimeout(() => {
      copied[key] = false;
      render();
    }, COPIED_MS);
  };

  function copyPath() {
    if (!navigator.clipboard?.writeText) return render("Unable to copy screenshot path", "Clipboard API unavailable.", "error");
    void navigator.clipboard.writeText(path).then(
      () => flash("path"),
      (error) => render("Unable to copy screenshot path", failure(error), "error"),
    );
  }

  function copyImage() {
    void bridge.copyScreenshot?.(path).then(
      () => flash("image"),
      (error) => render("Unable to copy screenshot", failure(error), "error"),
    );
  }

  render();
  return id;
}

export function showScreenshotFailure(error: unknown) {
  return toastManager.add({ type: "error", title: "Unable to capture screenshot", description: failure(error) });
}
