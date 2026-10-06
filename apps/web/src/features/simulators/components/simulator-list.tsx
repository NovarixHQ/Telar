"use client";

import { useState } from "react";
import { InfoIcon, PowerIcon, SmartphoneIcon } from "lucide-react";
import type { SimulatorPlatformAvailability, SimulatorsState, SimulatorSummary } from "@telar/engine-client";
import { Button } from "@/ui/button";
import { PanelEmpty, PanelRow, PanelSectionLabel } from "@/ui/panel";
import { Spinner } from "@/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/ui/tooltip";

type ListProps = {
  state: SimulatorsState | undefined;
  error: string | undefined;
  onTurnOn: () => Promise<void>;
  onRetry: () => void;
  onOpen: (simulator: SimulatorSummary) => void;
  onStart: (simulator: SimulatorSummary) => Promise<void>;
  onShutdown: (simulator: SimulatorSummary) => Promise<void>;
};

function Setup({ state, error, onTurnOn, onRetry }: Pick<ListProps, "state" | "error" | "onTurnOn" | "onRetry">) {
  const [turning, setTurning] = useState(false);
  if (!state) {
    return error ? (
      <PanelEmpty icon={<SmartphoneIcon />} title="The engine did not answer" action={<Button size="sm" variant="outline" onClick={onRetry}>Try again</Button>}>
        {error}
      </PanelEmpty>
    ) : (
      <PanelEmpty icon={<Spinner />} title="Looking for simulators" />
    );
  }
  if (state.status === "disabled") {
    const turnOn = async () => {
      setTurning(true);
      await onTurnOn().finally(() => setTurning(false));
    };
    return (
      <PanelEmpty
        icon={<SmartphoneIcon />}
        title="Simulators are off"
        action={
          <Button size="sm" disabled={turning} onClick={() => void turnOn()}>
            Turn on simulators
          </Button>
        }
      >
        Turning them on sets up a helper on this Mac the first time, then lists, starts and shows its simulators here.
      </PanelEmpty>
    );
  }
  if (state.status === "failed") {
    return (
      <PanelEmpty icon={<SmartphoneIcon />} title="Simulators could not start" action={<Button size="sm" variant="outline" onClick={onRetry}>Try again</Button>}>
        {state.detail ?? "The helper stopped before it was ready."}
      </PanelEmpty>
    );
  }
  return (
    <PanelEmpty icon={<Spinner />} title={state.status === "installing" ? "Setting up simulators" : "Starting simulators"}>
      {state.detail ?? "This takes a few seconds."}
    </PanelEmpty>
  );
}

function SimulatorRow({ simulator, onOpen, onStart, onShutdown }: { simulator: SimulatorSummary } & Pick<ListProps, "onOpen" | "onStart" | "onShutdown">) {
  const [busy, setBusy] = useState<"starting" | "stopping">();
  const run = async (what: "starting" | "stopping", action: () => Promise<void>) => {
    setBusy(what);
    await action().finally(() => setBusy(undefined));
  };
  return (
    <PanelRow>
      <SmartphoneIcon className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate">{simulator.name}</span>
        <span className="truncate text-3xs text-muted-foreground">
          {simulator.version} · {busy === "starting" ? "Starting…" : busy === "stopping" ? "Shutting down…" : simulator.booted ? "Running" : "Off"}
        </span>
      </span>
      {busy ? (
        <Spinner />
      ) : simulator.booted ? (
        <>
          <Button size="icon-sm" variant="ghost" aria-label={`Shut down ${simulator.name}`} onClick={() => void run("stopping", () => onShutdown(simulator))}>
            <PowerIcon />
          </Button>
          <Button size="xs" variant="outline" onClick={() => onOpen(simulator)}>
            Open
          </Button>
        </>
      ) : (
        <Button size="xs" variant="outline" onClick={() => void run("starting", () => onStart(simulator))}>
          Start
        </Button>
      )}
    </PanelRow>
  );
}

function Unavailable({ platform }: { platform: SimulatorPlatformAvailability }) {
  return (
    <span className="inline-flex items-center gap-1">
      {platform.reason ?? `${platform.platform} is not available on this Mac.`}
      {platform.detail && (
        <Tooltip>
          <TooltipTrigger
            render={
              <button type="button" aria-label="Why" data-info={platform.detail} className="text-muted-foreground/60 hover:text-foreground">
                <InfoIcon className="size-3" />
              </button>
            }
          />
          <TooltipContent side="top" className="max-w-72 text-xs leading-snug">
            {platform.detail}
          </TooltipContent>
        </Tooltip>
      )}
    </span>
  );
}

export function SimulatorList(props: ListProps) {
  const { state, error } = props;
  if (state?.status !== "ready") return <Setup {...props} />;
  const unavailable = state.platforms.filter((platform) => !platform.available);
  const empty = state.simulators.length === 0;
  return (
    <div className="flex flex-col">
      {error && <p className="px-4 pt-2 text-2xs text-destructive">{error}</p>}
      {!empty && unavailable.map((platform) => (
        <p key={platform.platform} className="px-4 pt-2 text-2xs text-muted-foreground">
          <Unavailable platform={platform} />
        </p>
      ))}
      {state.errors.map((note) => (
        <p key={note} className="px-4 pt-2 text-2xs text-muted-foreground">
          {note}
        </p>
      ))}
      {empty ? (
        <PanelEmpty icon={<SmartphoneIcon />} title="No simulators on this Mac">
          {unavailable[0] ? <Unavailable platform={unavailable[0]} /> : "A simulator appears here once one is installed."}
        </PanelEmpty>
      ) : (
        <>
          <PanelSectionLabel label="Simulators" count={state.simulators.length} />
          {state.simulators.map((simulator) => (
            <SimulatorRow key={simulator.id} simulator={simulator} onOpen={props.onOpen} onStart={props.onStart} onShutdown={props.onShutdown} />
          ))}
        </>
      )}
    </div>
  );
}
