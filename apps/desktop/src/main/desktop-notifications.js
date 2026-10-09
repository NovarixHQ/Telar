"use strict";

const DESKTOP_NOTICE = "telar:desktop-notification";
const DESKTOP_APPROVE = "telar:desktop-notification:approve";
const DESKTOP_APPROVED = "telar:desktop-notification:approved";
const DESKTOP_DISMISS = "telar:desktop-notification:dismiss";
const KINDS = new Set(["blocked", "finished", "failed"]);
const ALERT_ID = /^[a-f0-9]{64}$/;

const text = (value, max) => typeof value === "string" && value.length > 0 && value.length <= max;

const appPath = (value) =>
  text(value, 1024) && value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/\\");

function parseNotice(message) {
  if (!message || typeof message !== "object" || message.type !== DESKTOP_NOTICE) return null;
  const { kind, id, sessionId, title, body, path, request } = message;
  if (!KINDS.has(kind) || !ALERT_ID.test(id) || !text(sessionId, 256) || !text(title, 160) || !text(body, 200) || !appPath(path)) return null;
  if (request !== undefined && !text(request, 256)) return null;
  return { kind, id, sessionId, title, body, path, ...(request === undefined ? {} : { request }) };
}

function routeOf(url) {
  try {
    return new URL(url).pathname;
  } catch {
    return null;
  }
}

function shouldNotifyDesktop(notice, context = {}) {
  if (context.focused && context.viewingPath === notice.path) return false;
  return true;
}

function createDesktopNotifier({ Notification, send, context, open, chime, enabled = () => true }) {
  const live = new Map();

  const pending = new Map();

  function show(notice) {
    live.get(notice.sessionId)?.close();
    const approvable = notice.request !== undefined;
    const banner = new Notification({
      id: notice.id,
      title: notice.title,
      body: notice.body,
      ...chime.options(notice.kind),
      actions: approvable ? [{ type: "button", text: "Approve" }, { type: "button", text: "Open" }] : [{ type: "button", text: "Open" }],
    });
    const forget = () => {
      if (live.get(notice.sessionId) === banner) live.delete(notice.sessionId);
    };
    banner.on("click", () => {
      forget();
      open(notice.path);
    });
    banner.on("action", (details, legacyIndex) => {
      forget();
      const index = typeof details?.actionIndex === "number" ? details.actionIndex : legacyIndex;
      if (approvable && index === 0) {
        pending.set(notice.request, notice.path);
        send({ type: DESKTOP_APPROVE, sessionId: notice.sessionId, requestId: notice.request });
      } else open(notice.path);
    });
    banner.on("close", forget);
    banner.on("show", () => chime.shown(notice.kind));
    live.set(notice.sessionId, banner);
    banner.show();
  }

  return {
    handleServerMessage(message) {
      if (message?.type === DESKTOP_DISMISS) {
        if (text(message.sessionId, 256)) live.get(message.sessionId)?.close();
        if (typeof message.id === "string" && ALERT_ID.test(message.id)) Notification.remove(message.id);
        return;
      }
      if (message?.type === DESKTOP_APPROVED) {
        const path = pending.get(message.requestId);
        pending.delete(message.requestId);

        if (path && message.ok !== true) open(path);
        return;
      }
      const notice = parseNotice(message);
      if (!notice || !enabled() || !shouldNotifyDesktop(notice, context())) return;
      show(notice);
    },
    liveCount: () => live.size,
  };
}

module.exports = {
  DESKTOP_NOTICE,
  DESKTOP_APPROVE,
  DESKTOP_APPROVED,
  DESKTOP_DISMISS,
  parseNotice,
  routeOf,
  shouldNotifyDesktop,
  createDesktopNotifier,
};
