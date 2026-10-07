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

  stageWindow(scopeKey) {
    return this.poppedStages.get(scopeKey)?.window || this.window;
  },

  stageBoundsOf(scopeKey) {
    return this.poppedStages.get(scopeKey)?.bounds || this.bounds;
  },

  isScopeShown(scopeKey) {
    const stage = this.poppedStages.get(scopeKey);
    return stage ? stage.visible : scopeKey === this.visibleScopeKey;
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

  mountView(tab, view) {
    const win = this.stageWindow(tab.scopeKey);
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

  popOut(scopeKey) {
    const scope = this.requireScope(scopeKey);
    if (this.isPopped(scope)) return this.showStage(scope);
    if (!this.scopeTabs(scope).length) throw new Error("Open a page before moving the browser into its own window.");
    if (!this.openStageWindow) throw new Error("This build cannot open the browser in a window of its own.");
    const window = this.openStageWindow(scope, { project: this.scopeProjects.get(scope) ?? null });
    const stage = { window, bounds: { ...UNMEASURED }, radius: 0, visible: false };
    this.poppedStages.set(scope, stage);
    if (this.visibleScopeKey === scope) this.visibleScopeKey = null;
    for (const tab of this.scopeTabs(scope)) this.moveView(tab, window);

    window.on("close", () => this.dropStage(stage, { closing: true }));
    window.on("closed", () => this.dropStage(stage, { closing: true }));
    window.on("moved", () => { if (!this._disposed) this.applyShownGeometry(); });
    window.webContents?.on?.("zoom-changed", () => { if (!this._disposed) this.applyVisibility(); });
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

  bringBack(scopeKey) {
    const scope = this.requireScope(scopeKey);
    const stage = this.poppedStages.get(scope);
    if (stage) this.dropStage(stage);
    return this.state(scope);
  },

  dropStage(stage, { closing = false, quiet = false } = {}) {
    const entry = [...this.poppedStages].find(([, candidate]) => candidate === stage);
    if (!entry) return;
    const [scope] = entry;
    this.poppedStages.delete(scope);
    if (!this._disposed) for (const tab of this.scopeTabs(scope)) this.moveView(tab, this.window);
    if (!closing) {
      try { if (!stage.window.isDestroyed()) stage.window.destroy(); } catch {}
    }
    if (this._disposed || quiet) return;
    this.applyVisibility();
    this.emitState(scope);
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
