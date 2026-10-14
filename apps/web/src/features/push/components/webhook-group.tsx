"use client";

import { useEffect, useState } from "react";
import type { WebhookStatus } from "@telar/engine-client";
import { Button } from "@/ui/button";
import { Input } from "@/ui/input";
import { Row, SettingsGroup } from "@/features/settings";
import { saveWebhook, testWebhook, webhookStatus } from "../api";

const message = (error: unknown) => (error instanceof Error && error.message ? error.message : "Couldn't save. Try again.");
const delivered = (status: number) => status >= 200 && status < 300;
const outcome = (status: number) => (delivered(status) ? `Delivered (${status}).` : status === 0 ? "Nothing answered." : `Refused with ${status}.`);

export function WebhookGroup() {
  const [status, setStatus] = useState<WebhookStatus>();
  const [url, setUrl] = useState("");
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [tested, setTested] = useState<string>();

  useEffect(() => {
    const task = window.setTimeout(() => void webhookStatus().then(setStatus, (cause: unknown) => setError(message(cause))), 0);
    return () => window.clearTimeout(task);
  }, []);

  const run = async (action: () => Promise<WebhookStatus>) => {
    setBusy(true);
    setError(undefined);
    setTested(undefined);
    try {
      setStatus(await action());
      setUrl("");
      setSecret("");
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  };

  const sendTest = async () => {
    setBusy(true);
    setTested(undefined);
    try {
      setTested(outcome((await testWebhook()).status));
    } catch (cause) {
      setTested(message(cause));
    } finally {
      setBusy(false);
    }
  };

  const target = status?.target;
  return (
    <SettingsGroup title="Webhook">
      <Row
        keywords={["webhook", "http", "post", "callback", "automation", "notify", "finished", "failed", "approval", "url"]}
        label="Webhook URL"
        hint={target ? <>Posting to <span className="font-mono text-foreground">{target}</span></> : "Telar posts JSON here when a session finishes, fails or needs your approval."}
        info="One POST per event, the same moments as a notification. A failed delivery is retried a few times, then dropped."
        {...(error ? { error } : {})}
        control={
          <div className="flex items-center gap-2">
            <Input
              type="url"
              className="h-8 w-64 font-mono text-xs"
              aria-label="Webhook URL"
              placeholder={target ? "Paste a new URL to replace it" : "https://…"}
              value={url}
              disabled={busy || !status}
              onChange={(event) => setUrl(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && url.trim()) void run(() => saveWebhook({ url: url.trim() }));
              }}
            />
            {target && !url.trim() ? (
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => void run(() => saveWebhook({ url: "" }))}>
                Remove
              </Button>
            ) : (
              <Button size="sm" disabled={busy || !url.trim()} onClick={() => void run(() => saveWebhook({ url: url.trim() }))}>
                Save
              </Button>
            )}
          </div>
        }
      />
      {status?.configured && (
        <>
          <Row
            keywords={["webhook", "secret", "key", "token", "signature", "hmac", "bearer"]}
            label="Secret"
            {...(status.hasSecret ? { status: "set" } : {})}
            info="Sent as a bearer token, and used to sign the body in X-Telar-Signature. It stays on this computer."
            control={
              <div className="flex items-center gap-2">
                <Input
                  type="password"
                  className="h-8 w-56 font-mono text-xs"
                  aria-label="Webhook secret"
                  placeholder={status.hasSecret ? "A secret is saved" : "Optional"}
                  value={secret}
                  disabled={busy}
                  onChange={(event) => setSecret(event.target.value)}
                />
                {status.hasSecret && !secret.trim() ? (
                  <Button variant="ghost" size="sm" disabled={busy} onClick={() => void run(() => saveWebhook({ secret: null }))}>
                    Remove
                  </Button>
                ) : (
                  <Button size="sm" disabled={busy || !secret.trim()} onClick={() => void run(() => saveWebhook({ secret: secret.trim() }))}>
                    Save
                  </Button>
                )}
              </div>
            }
          />
          <Row
            keywords={["webhook", "test", "try", "check"]}
            label="Send a test"
            hint={tested ?? (status.last ? `Last delivery: ${outcome(status.last.status)}` : "Posts a test event now.")}
            control={
              <Button variant="outline" size="sm" disabled={busy} onClick={() => void sendTest()}>
                Send
              </Button>
            }
          />
        </>
      )}
    </SettingsGroup>
  );
}
