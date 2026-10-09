const UNMEASURED = { x: 0, y: 0, width: 1, height: 1 };

const SCOPE_CLAIM = { visible: 3, panel: 2, pages: 1 };

const EXACT_SCOPE_CLAIM = 10;

module.exports = {
  scopeClaim(scopeKey) {
    const wanted = String(scopeKey ?? "").trim();
    if (!wanted || this._disposed || this.window?.isDestroyed?.()) return 0;

    const bySession = !wanted.includes("#");
    let best = 0;
    const consider = (scope, rank) => {
      if (typeof scope !== "string" || !scope) return;
      const exact = scope === wanted;
      if (!exact && !(bySession && scope.startsWith(`${wanted}#`))) return;
      const claim = exact ? EXACT_SCOPE_CLAIM + rank : rank;
      if (claim > best) best = claim;
    };
    consider(this.visibleScopeKey, SCOPE_CLAIM.visible);
    for (const scope of this.poppedStages.keys()) consider(scope, SCOPE_CLAIM.visible);
    for (const scope of this.boundsByScope.keys()) consider(scope, SCOPE_CLAIM.panel);

    for (const scope of this.scopesClosedByPerson) consider(scope, SCOPE_CLAIM.panel);
    for (const tab of this.tabs) if (tab.view) consider(tab.scopeKey, SCOPE_CLAIM.pages);
    return best;
  },

  isPopped(scopeKey) {
    return this.poppedStages.has(scopeKey);
  },

  windowOfTab(tab) {
    return tab.stage?.window || this.window;
  },

  boundsOfTab(tab) {
    return tab.stage?.bounds || this.bounds;
  },

  placeTabs(scopeKey, stage) {
    return this.scopeTabs(scopeKey).filter((tab) => (tab.stage || null) === (stage || null));
  },

  activeIdIn(scopeKey, stage) {
    return (stage ? stage.activeTabId : this.activeTabIds.get(scopeKey)) ?? null;
  },

  setActiveIn(scopeKey, stage, id) {
    if (stage) stage.activeTabId = id;
    else this.activeTabIds.set(scopeKey, id);
  },

  settleActiveAfter(tab, stage, position) {
    if (this.activeIdIn(tab.scopeKey, stage) !== tab.id) return;
    const remaining = this.placeTabs(tab.scopeKey, stage).filter((candidate) => candidate !== tab);
    const next = position === undefined ? remaining.at(-1) : (remaining[position] ?? remaining[position - 1]);
    this.setActiveIn(tab.scopeKey, stage, next?.id ?? null);
  },

  isTabShown(tab) {
    const stage = tab.stage;
    if (stage) return stage.visible && stage.activeTabId === tab.id;
    return tab.scopeKey === this.visibleScopeKey && tab.id === this.activeTabIds.get(tab.scopeKey);
  },

  stageOfSender(scopeKey, sender) {
    const stage = this.poppedStages.get(scopeKey);
    return stage && sender && stage.window.webContents === sender ? stage : null;
  },

  windowOfSender(sender) {
    if (!sender) return null;
    return [this.window, ...this.stageWindows()].find((win) => win && !win.isDestroyed?.() && win.webContents === sender) || null;
  },

  stageWindows() {
    return [...this.poppedStages.values()].map((stage) => stage.window);
  },

  sendToScope(scopeKey, channel, payload) {
    const popped = scopeKey ? this.poppedStages.get(scopeKey)?.window : null;
    for (const win of [this.window, popped]) {
      if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
    }
  },

  sendToAllStages(channel, payload) {
    for (const win of [this.window, ...this.stageWindows()]) {
      if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
    }
  },

  sendState(scopeKey, extra) {
    const stage = this.poppedStages.get(scopeKey);
    const send = (win, place) => {
      if (win && !win.isDestroyed()) win.webContents.send("telar:browser:state", extra ? { ...this.state(scopeKey, place), ...extra } : this.state(scopeKey, place));
    };
    send(this.window, null);
    if (stage) send(stage.window, stage.window.webContents);
  },

  mountView(tab, view) {
    const win = this.windowOfTab(tab);
    win.contentView.addChildView(view);
    tab.stageWindow = win;
  },

  unmountView(tab, view) {
    const win = tab.stageWindow || this.window;
    tab.stageWindow = null;
    try { if (!win.isDestroyed?.()) win.contentView.removeChildView(view); } catch {}
  },

  moveView(tab, win) {
    const view = tab.view;
    if (!view || tab.stageWindow === win) return;
    view.setVisible(false);
    this.unmountView(tab, view);
    win.contentView.addChildView(view);
    tab.stageWindow = win;
    tab.lastPlaced = undefined;
  },

  moveTab(tab, stage) {
    const from = tab.stage || null;
    if (from === (stage || null)) return;
    this.settleActiveAfter(tab, from);
    tab.stage = stage || null;
    this.moveView(tab, this.windowOfTab(tab));
    if (stage) stage.activeTabId = tab.id;
  },

  openStage(scope) {
    if (!this.openStageWindow) throw new Error("This build cannot open the browser in a window of its own.");
    const window = this.openStageWindow(scope, { project: this.scopeProjects.get(scope) ?? null });
    const stage = { window, bounds: { ...UNMEASURED }, radius: 0, visible: false, activeTabId: null };
    this.poppedStages.set(scope, stage);
    window.on("close", () => this.dropStage(stage, { closing: true }));
    window.on("closed", () => this.dropStage(stage, { closing: true }));
    window.on("moved", () => { if (!this._disposed) this.applyShownGeometry(); });
    window.webContents?.on?.("zoom-changed", () => { if (!this._disposed) this.applyVisibility(); });
    return stage;
  },

  popOut(scopeKey, { index, restore = false } = {}) {
    const scope = this.requireScope(scopeKey);
    const restored = restore ? this.placeTabs(scope, null).filter((tab) => tab.restoredInWindow) : [];
    if (restore) for (const tab of this.scopeTabs(scope)) tab.restoredInWindow = false;
    const panelActive = this.placeTabs(scope, null).find((tab) => tab.id === this.activeTabIds.get(scope));
    const chosen = index !== undefined ? [this.tabAt(scope, index)] : restored.length ? restored : panelActive ? [panelActive] : [];
    if (!chosen.length) {
      if (this.isPopped(scope)) return this.showStage(scope);
      throw new Error("Open a page before moving the browser into its own window.");
    }
    if (chosen.every((tab) => tab.stage)) return this.showStage(scope);
    const stage = this.poppedStages.get(scope) || this.openStage(scope);
    for (const tab of chosen) this.moveTab(tab, stage);
    this.applyVisibility();
    this.emitState(scope);
    return this.state(scope);
  },

  showStage(scopeKey) {
    const scope = this.requireScope(scopeKey);
    const win = this.poppedStages.get(scope)?.window;
    if (win && !win.isDestroyed()) {
      if (win.isMinimized?.()) win.restore();
      win.show?.();
      win.focus();
    }
    return this.state(scope);
  },

  isCompactStage(scopeKey) {
    const win = this.poppedStages.get(scopeKey)?.window;
    return Boolean(win && !win.isDestroyed() && this.stageWindowCompact(win));
  },

  floatStage(scopeKey, on, { index, fromWindow = false } = {}) {
    const scope = this.requireScope(scopeKey);
    const wanted = on === undefined ? !this.isCompactStage(scope) : on;
    if (wanted && !fromWindow) this.popOut(scope, { index });
    if (!this.isPopped(scope)) return this.state(scope);
    return this.setStageCompact(scope, wanted);
  },

  setStageCompact(scopeKey, on) {
    const scope = this.requireScope(scopeKey);
    const win = this.poppedStages.get(scope)?.window;
    if (!win) throw new Error("Only a browser in its own window can float on top.");
    if (!this.compactStageWindow) throw new Error("This build cannot float the browser on top.");
    this.compactStageWindow(win, on);
    this.emitState(scope);
    return this.state(scope);
  },

  bringBack(scopeKey, { focus = false } = {}) {
    const scope = this.requireScope(scopeKey);
    const stage = this.poppedStages.get(scope);
    if (stage) this.dropStage(stage);
    if (focus && !this.window.isDestroyed()) {
      if (this.window.isMinimized?.()) this.window.restore();
      this.window.show?.();
      this.window.focus?.();
    }
    return this.state(scope);
  },

  dropStage(stage, { closing = false, quiet = false } = {}) {
    const entry = [...this.poppedStages].find(([, candidate]) => candidate === stage);
    if (!entry) return;
    const [scope] = entry;
    this.poppedStages.delete(scope);
    if (!this._disposed) this.onStageClosed?.(scope);
    const returning = this.tabs.filter((tab) => tab.stage === stage);
    for (const tab of returning) {
      tab.stage = null;
      if (!this._disposed) this.moveView(tab, this.window);
    }
    if (returning.some((tab) => tab.id === stage.activeTabId)) this.activeTabIds.set(scope, stage.activeTabId);
    if (!closing) {
      try { if (!stage.window.isDestroyed()) stage.window.destroy(); } catch {}
    }
    if (this._disposed || quiet) return;
    this.applyVisibility();
    this.emitState(scope);
  },

  dropEmptyStage(scope) {
    const stage = this.poppedStages.get(scope);
    if (stage && !this.placeTabs(scope, stage).length) this.dropStage(stage, { quiet: true });
  },

  closeAllStages() {
    for (const stage of this.poppedStages.values()) this.dropStage(stage);
  },

  setStageBounds(stage, scope, next, radius) {
    const same = sameRect(stage.bounds, next) && stage.radius === radius;
    stage.bounds = next;
    stage.radius = radius;
    this.applyShownGeometry();
    if (!same) this.scheduleBoundsEmit(scope);
  },
};

function sameRect(a, b) {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}
