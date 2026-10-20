"use client";

import { useEffect, useState } from "react";
import { Button } from "@/ui/button";
import { Input } from "@/ui/input";
import { Switch } from "@/ui/switch";
import { Row } from "@/features/settings";
import { desktopHost, type DesktopHost } from "../desktop-host";

export function RunHereRow() {
  const [host, setHost] = useState<DesktopHost>();
  const [remote, setRemote] = useState<{ baseUrl: string; name: string } | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    const task = window.setTimeout(() => {
      const found = desktopHost();
      setHost(found);
      void found?.get().then((mode) => setRemote(mode.remote), () => undefined);
    }, 0);
    return () => window.clearTimeout(task);
  }, []);

  if (!host) return null;
  const local = host.runsLocalEngine;

  const run = async (action: () => Promise<unknown>, fallback: string) => {
    setBusy(true);
    setError(undefined);
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error && cause.message ? cause.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : fallback);
      setBusy(false);
    }
  };

  const toggle = (on: boolean) => {
    if (on || remote) void run(() => host.setLocal(on), "Couldn't switch. Try again.");
    else setChoosing(true);
  };

  return (
    <>
      <Row
        keywords={["engine", "client", "remote", "headless", "local", "this mac", "server", "run here"]}
        label="Run Telar on this Mac"
        hint={local ? "Turn off to use another computer's Telar from this window." : `Showing ${remote?.name ?? "another computer"}'s sessions. Turn on to use this Mac again.`}
        info="With it off, the browser, terminals, computer use and simulators run on the other computer, and this app only shows them. The app restarts when you switch."
        {...(error ? { error } : {})}
        control={<Switch aria-label="Run Telar on this Mac" checked={local && !choosing} disabled={busy} onCheckedChange={(on: boolean) => toggle(on)} />}
      />
      {(choosing || (!local && remote)) && (
        <Row
          label={remote ? remote.name : "Other computer"}
          hint={remote ? remote.baseUrl : "Paste the link `telar pair` prints there, or type user@host to set it up over ssh."}
          control={
            remote ? (
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => void run(() => host.forget(), "Couldn't forget it. Try again.")}>
                Forget
              </Button>
            ) : (
              <form
                className="flex items-center gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  void run(() => host.connect(link.trim()), "Could not pair with that computer.");
                }}
              >
                <Input value={link} onChange={(event) => setLink(event.target.value)} placeholder="user@host or http://box:7420/pair#token=…" aria-label="Pairing link or user@host of the other computer" className="h-8 w-72 font-mono text-xs" disabled={busy} />
                <Button type="submit" size="sm" disabled={busy || !link.trim()}>
                  {busy ? "Connecting…" : "Use it"}
                </Button>
                <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => setChoosing(false)}>
                  Cancel
                </Button>
              </form>
            )
          }
        />
      )}
    </>
  );
}
