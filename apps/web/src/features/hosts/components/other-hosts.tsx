"use client";

import { useCallback, useEffect, useState } from "react";
import { XIcon } from "lucide-react";
import { createEngineApi, EngineApiError } from "@/platform/engine";
import type { PublicHost } from "@telar/engine-client";
import { forgetRows, readSidebarCache, writeSidebarCache, forgetHostHeads } from "@/features/sessions";
import { Button } from "@/ui/button";
import { Input } from "@/ui/input";
import { Row, SettingsList } from "@/features/settings";

const api = createEngineApi();

type OtherHosts = ReturnType<typeof useOtherHosts>;

export function ComputerRows() {
  const others = useOtherHosts();
  return (
    <>
      <AddComputerRow others={others} />
      <ComputerList others={others} />
    </>
  );
}

function useOtherHosts() {
  const [hosts, setHosts] = useState<PublicHost[] | null>(null);
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hostError, setHostError] = useState<{ id: string; message: string }>();

  const load = useCallback(async () => {
    try {
      setHosts((await api.hosts()).hosts);
    } catch {
      setHosts([]);
    }
  }, []);

  useEffect(() => {
    const task = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(task);
  }, [load]);

  const add = async () => {
    const pairingUrl = link.trim();
    if (!pairingUrl) return;
    setBusy(true);
    setError(null);
    try {
      await api.addHost({ pairingUrl });
      setLink("");
      await load();
    } catch (cause) {
      setError(cause instanceof EngineApiError ? cause.message : "Could not pair with that computer.");
    } finally {
      setBusy(false);
    }
  };

  const refused = (id: string, cause: unknown, fallback: string) =>
    setHostError({ id, message: cause instanceof EngineApiError ? cause.message : fallback });

  const rename = async (id: string, name: string) => {
    setHostError(undefined);
    try {
      await api.renameHost(id, name);
    } catch (cause) {
      refused(id, cause, "Could not rename that computer.");
    }
    await load();
  };

  const remove = async (id: string) => {
    setHostError(undefined);
    try {
      await api.removeHost(id);
    } catch (cause) {
      refused(id, cause, "Could not forget that computer.");
      return;
    }
    writeSidebarCache(forgetRows(readSidebarCache(), id));
    void forgetHostHeads(id).catch(() => undefined);
    await load();
  };

  return { hosts, link, setLink, busy, error, hostError, add, rename, remove };
}

function ComputerList({ others }: { others: OtherHosts }) {
  const { hosts, hostError, rename, remove } = others;
  if (!hosts?.length) return null;
  return (
    <SettingsList label="Computers">
      {hosts.map((host) => (
        <HostRow key={host.id} host={host} {...(hostError?.id === host.id ? { error: hostError.message } : {})} onRename={(name) => void rename(host.id, name)} onRemove={() => void remove(host.id)} />
      ))}
    </SettingsList>
  );
}

function AddComputerRow({ others }: { others: OtherHosts }) {
  const { link, setLink, busy, error, add } = others;
  return (
    <Row
      keywords={["host", "pair", "second machine", "remote", "mac", "computer"]}
      label="Add a computer"
      hint="Shows another Mac's sessions in this rail."
      {...(error ? { error } : {})}
      control={
        <form
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void add();
          }}
        >
          <Input
            value={link}
            onChange={(event) => setLink(event.target.value)}
            placeholder="http://mini.tail:3000/pair#token=…"
            aria-label="Pairing link from the other computer"
            className="h-8 w-72 font-mono text-xs"
            disabled={busy}
          />
          <Button type="submit" size="sm" disabled={busy || !link.trim()}>
            {busy ? "Pairing…" : "Pair"}
          </Button>
        </form>
      }
    />
  );
}

function HostRow({ host, error, onRename, onRemove }: { host: PublicHost; error?: string; onRename: (name: string) => void; onRemove: () => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(host.name);

  const commit = () => {
    setEditing(false);
    if (draft.trim() && draft.trim() !== host.name) onRename(draft);
  };

  return (
    <Row
      {...(error ? { error } : {})}
      label={
        editing ? (
          <Input
            autoFocus
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === "Enter") commit();
              if (event.key === "Escape") {
                setDraft(host.name);
                setEditing(false);
              }
            }}
            className="h-6 w-48 px-1.5 text-sm"
          />
        ) : (
          <button
            type="button"
            className="cursor-text hover:underline decoration-dotted underline-offset-2"
            title="Rename"
            onClick={() => {
              setDraft(host.name);
              setEditing(true);
            }}
          >
            {host.name}
          </button>
        )
      }
      hint={`${host.baseUrl} — forgetting it drops its sessions from this rail. That computer keeps the access until it revokes this one.`}
      control={
        <Button variant="ghost" size="icon-sm" aria-label={`Forget ${host.name}`} title="Forget this computer (its own Devices list keeps the access until revoked there)" onClick={onRemove}>
          <XIcon className="size-3.5" />
        </Button>
      }
    />
  );
}
