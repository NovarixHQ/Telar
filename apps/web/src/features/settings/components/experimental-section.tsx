"use client";

import { useState } from "react";
import { ChevronRightIcon, FlaskConicalIcon } from "lucide-react";
import { decideByLabel, EXPERIMENTS, useExperiment, type Experiment } from "../experiments";
import { Row, SettingsGroup, ToggleRow, usePendingReveal } from "./settings-shell";

function ExperimentRow({ experiment }: { experiment: Experiment }) {
  const [on, set] = useExperiment(experiment.id);
  return (
    <ToggleRow
      label={experiment.label}
      icon={FlaskConicalIcon}
      hint={`${experiment.hint} Decide by ${decideByLabel(experiment.decideBy)}.`}
      checked={on}
      onCheckedChange={set}
      {...(on ? { onRevert: () => set(false) } : {})}
    />
  );
}

export function ExperimentalSection({ experiments = EXPERIMENTS }: { experiments?: readonly Experiment[] }) {
  const [chosen, setOpen] = useState(false);
  const revealing = usePendingReveal();
  const open = chosen || revealing?.startsWith("settings-row-general-experimental-") === true;
  return (
    <SettingsGroup
      title="Experimental"
      scope="browser"
      description="Big changes on trial. Each one has a date to decide."
      action={
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((shown) => !shown)}
          className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronRightIcon className={`size-3.5 transition-transform ${open ? "rotate-90" : ""}`} />
          {open ? "Hide" : "Show"}
        </button>
      }
    >
      {open &&
        (experiments.length === 0 ? (
          <Row label="Nothing on trial" hint="Trials appear here when there is one to try." control={null} />
        ) : (
          experiments.map((experiment) => <ExperimentRow key={experiment.id} experiment={experiment} />)
        ))}
    </SettingsGroup>
  );
}
