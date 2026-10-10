"use strict";

const { anchorOn, boundsFor, displayFor } = require("./quick-composer-layout");

function createPlacement({ screen, window: current }) {
  let place = null;
  let mode = "compact";
  const live = () => {
    const win = current();
    return win && !win.isDestroyed() ? win : null;
  };
  const apply = (animate) => {
    const win = live();
    if (place && win) win.setBounds(boundsFor({ area: place.area, anchor: place.anchor, mode }), animate);
  };

  return {
    open(held, nextMode = "compact") {
      const display = displayFor(screen, held);
      place = { display: display.id, area: display.workArea, anchor: anchorOn(display, held?.display === display.id ? held.offset : null) };
      mode = nextMode;
      apply(false);
    },
    resize(nextMode) {
      if (nextMode === mode || (nextMode !== "compact" && nextMode !== "expanded")) return;
      mode = nextMode;
      apply(true);
    },
    settle() {
      const win = live();
      if (!place || !win) return;
      const bounds = win.getBounds();
      const display = screen.getDisplayMatching(bounds);
      place = { display: display.id, area: display.workArea, anchor: { x: bounds.x, bottom: bounds.y + bounds.height } };
      const fitted = boundsFor({ area: place.area, anchor: place.anchor, mode });
      if (fitted.x !== bounds.x || fitted.y !== bounds.y) apply(false);
    },
    mode: () => mode,
    held: () => (place ? { display: place.display, offset: { x: place.anchor.x - place.area.x, bottom: place.anchor.bottom - place.area.y } } : null),
  };
}

module.exports = { createPlacement };
