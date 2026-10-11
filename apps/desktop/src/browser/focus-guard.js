const { HUMAN_ATTRIBUTION_GRACE_MS } = require("./shared");

module.exports = {
  async keepCockpitFocus(scope, work) {
    if (this.window.isDestroyed() || !this.window.webContents.isFocused?.()) return work();
    this.focusHolds.set(scope, (this.focusHolds.get(scope) || 0) + 1);
    try {
      return await work();
    } finally {
      const left = this.focusHolds.get(scope) - 1;
      if (left) this.focusHolds.set(scope, left);
      else this.focusHolds.delete(scope);
      for (const tab of this.scopeTabs(scope)) this.returnFocusFrom(tab);
    }
  },

  noteCockpitFocused() {
    this.pageKeysTabId = null;
  },

  noteTabFocused(tab) {
    const held = this.focusHolds.has(tab.scopeKey) || !this.isTabShown(tab);
    const keep = held ? this.humanActive(tab) : this.pageKeysTabId === tab.id || this.justTouched(tab);
    if (keep) this.pageKeysTabId = tab.id;
    else if (this.focusCockpitFrom(tab)) tab.focusReturnedAt = this.now();
  },

  noteTabGesture(tab) {
    tab.gestureAt = this.now();
    const returnedAt = tab.focusReturnedAt;
    tab.focusReturnedAt = undefined;
    if (returnedAt !== undefined && this.now() - returnedAt < HUMAN_ATTRIBUTION_GRACE_MS) this.contentsOf(tab)?.focus();
  },

  justTouched(tab) {
    return tab.gestureAt !== undefined && this.now() - tab.gestureAt < HUMAN_ATTRIBUTION_GRACE_MS;
  },

  returnFocusFrom(tab) {
    if (!this.humanActive(tab)) this.focusCockpitFrom(tab);
  },

  focusCockpitFrom(tab) {
    const page = tab.view?.webContents;
    if (!page || page.isDestroyed() || !page.isFocused?.()) return false;
    if (tab.stage || this.window.isDestroyed()) return false;
    this.pageKeysTabId = null;
    this.window.webContents.focus();
    return true;
  },
};
