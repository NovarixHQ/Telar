type FocusBridge = { windowFocus?: { onRestore?: (listener: () => void) => () => void } };

export function installFocusRestore(): () => void {
  if (typeof window === "undefined") return () => {};
  const bridge = (window as unknown as { telarDesktop?: FocusBridge }).telarDesktop;
  return (
    bridge?.windowFocus?.onRestore?.(() => {
      const active = document.activeElement;
      if (!(active instanceof HTMLElement) || active === document.body) return;
      active.blur();
      active.focus();
    }) ?? (() => {})
  );
}
