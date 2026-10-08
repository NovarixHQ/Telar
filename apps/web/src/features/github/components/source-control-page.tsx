"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCwIcon } from "lucide-react";
import type { GitHubCliAuth } from "@telar/engine-client";
import { createEngineApi } from "@/platform/engine";
import { UNAVAILABLE } from "../github-forge";
import { Badge } from "@/ui/badge";
import { Button } from "@/ui/button";
import { Spinner } from "@/ui/spinner";
import { Row, SettingsGroup } from "@/features/settings";

const api = createEngineApi();

type Unavailable = Extract<GitHubCliAuth, { signedIn: false }>;
type GhState = { status: "checking" } | GitHubCliAuth;

const FIX: Record<Unavailable["unavailable"], string> = {
  not_installed: "Install the GitHub CLI — `brew install gh` on macOS, or your own package manager — then run `gh auth login`.",
  not_authenticated: "Run `gh auth login` in a terminal on this machine. Sign-in lives outside Telar, the same as it does for Claude and Codex.",
  failed: "Run `gh auth status` in a terminal on this machine to see what it says.",
};

function hint(state: GhState): string | undefined {
  if ("status" in state || state.signedIn) return undefined;
  return [UNAVAILABLE[state.unavailable].detail, state.message, FIX[state.unavailable]].filter(Boolean).join(" ");
}

function GhStatus({ state }: { state: GhState }) {
  if ("status" in state) return <Spinner />;
  if (state.signedIn) return <Badge variant="secondary">Authenticated</Badge>;
  return <Badge variant="outline">{UNAVAILABLE[state.unavailable].title}</Badge>;
}

export function SourceControlPage() {
  const [state, setState] = useState<GhState>({ status: "checking" });

  const probe = useCallback(async () => {
    setState({ status: "checking" });
    try {
      setState((await api.githubCliAuth()).auth);
    } catch (cause) {
      setState({ signedIn: false, unavailable: "failed", message: cause instanceof Error ? cause.message : "The engine did not answer." });
    }
  }, []);

  useEffect(() => {
    const task = window.setTimeout(() => void probe(), 0);
    return () => window.clearTimeout(task);
  }, [probe]);

  const detail = hint(state);
  return (
    <SettingsGroup
      title="Source control"
      description="Read through a CLI you signed in to yourself. Telar holds no token of its own."
    >
      <Row
        keywords={["gh", "git", "pull request", "issues", "token", "auth", "sign in", "cli", "forge", "gitlab"]}
        label="GitHub"
        {...(detail ? { hint: detail } : {})}
        {...("signedIn" in state && state.signedIn && state.account ? { status: <Badge variant="outline">{state.account}</Badge> } : {})}
        control={
          <div className="flex items-center gap-2">
            <GhStatus state={state} />
            <Button
              size="sm"
              variant="outline"
              disabled={"status" in state}
              onClick={() => void probe()}
              aria-label="Check gh again"
            >
              <RefreshCwIcon className="size-3.5" />
              Check again
            </Button>
          </div>
        }
      />
    </SettingsGroup>
  );
}
