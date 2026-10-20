"use strict";

const fs = require("node:fs");

const STREAM_PATH = "/v2/push/desktop/stream";
const MESSAGES_PATH = "/v2/push/desktop/messages";
const APPROVE = "telar:desktop-notification:approve";
const APPROVED = "telar:desktop-notification:approved";
const RETRY_MS = 2_000;

function frames(onMessage) {
  let buffered = "";
  return (chunk) => {
    buffered += chunk;
    const parts = buffered.split("\n\n");
    buffered = parts.pop() ?? "";
    for (const part of parts) {
      for (const line of part.split("\n")) {
        if (!line.startsWith("data: ")) continue;
        try {
          onMessage(JSON.parse(line.slice(6)));
        } catch {
          continue;
        }
      }
    }
  };
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function discoveryEndpoint(file, read = readJson) {
  return () => {
    const discovery = read(file);
    return discovery?.port && discovery?.token ? { host: discovery.host || "127.0.0.1", port: discovery.port, token: discovery.token } : null;
  };
}

const originOf = (endpoint) => endpoint.baseUrl ?? `http://${endpoint.host}:${endpoint.port}`;

function createEngineNotices({ onMessage, retryMs = RETRY_MS, fetchImpl = (url, init) => fetch(url, init) }) {
  let endpointOf = null;
  let current = null;
  let timer = null;

  const retry = () => {
    if (!endpointOf || timer) return;
    timer = setTimeout(() => {
      timer = null;
      void connect();
    }, retryMs);
    timer.unref?.();
  };

  async function connect() {
    const endpoint = endpointOf?.();
    if (!endpoint) return retry();
    const controller = new AbortController();
    current = controller;
    try {
      const response = await fetchImpl(`${originOf(endpoint)}${STREAM_PATH}`, {
        headers: { authorization: `Bearer ${endpoint.token}`, accept: "text/event-stream" },
        signal: controller.signal,
      });
      if (response.ok && response.body) {
        const feed = frames(onMessage);
        const decoder = new TextDecoder();
        for await (const chunk of response.body) feed(decoder.decode(chunk, { stream: true }));
      } else await response.body?.cancel();
    } catch {}
    if (current !== controller) return;
    current = null;
    retry();
  }

  async function send(message) {
    const endpoint = endpointOf?.();
    try {
      if (endpoint) {
        const response = await fetchImpl(`${originOf(endpoint)}${MESSAGES_PATH}`, {
          method: "POST",
          headers: { authorization: `Bearer ${endpoint.token}`, "content-type": "application/json" },
          body: JSON.stringify(message),
        });
        await response.body?.cancel();
        if (response.ok) return;
      }
    } catch {}
    if (message?.type === APPROVE) onMessage({ type: APPROVED, sessionId: message.sessionId, requestId: message.requestId, ok: false });
  }

  return {
    send,
    start(endpoint) {
      if (endpointOf) return;
      endpointOf = endpoint;
      void connect();
    },
    stop() {
      endpointOf = null;
      if (timer) clearTimeout(timer);
      timer = null;
      const controller = current;
      current = null;
      controller?.abort();
    },
  };
}

module.exports = { createEngineNotices, discoveryEndpoint, STREAM_PATH, MESSAGES_PATH };
