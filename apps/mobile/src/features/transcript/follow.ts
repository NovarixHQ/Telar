const BOTTOM_SLACK = 40;

export type ScrollMetrics = { offset: number; viewport: number; content: number };

/** Following the tail: the transcript sticks to the newest row until the reader scrolls away from it. */
export type Follow = { taken: boolean; atBottom: boolean };

export const FOLLOWING: Follow = { taken: false, atBottom: true };

const isAtBottom = ({ offset, viewport, content }: ScrollMetrics) => offset + viewport >= content - BOTTOM_SLACK;

export const scrolled = (follow: Follow, metrics: ScrollMetrics, byReader: boolean): Follow => ({
  taken: follow.taken || byReader,
  atBottom: isAtBottom(metrics),
});

/** New content pins to the tail unless the reader took the scroll and is reading above it. */
export const shouldFollow = (follow: Follow) => !follow.taken || follow.atBottom;

export const showsJump = (follow: Follow) => !follow.atBottom;
