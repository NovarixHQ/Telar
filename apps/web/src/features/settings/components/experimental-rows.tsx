"use client";

import { useState } from "react";
import { ChevronRightIcon } from "lucide-react";
import { decideByLabel, EXPERIMENTS, type Experiment } from "../experiment-list";
import { setExperiment, useExperiment } from "../experiments";
import { settingsRowId } from "../search";
import { Row, ToggleRow, usePendingReveal, useRestoreDefaults } from "./settings-shell";

function ExperimentRow({ experiment }: { experiment: Experiment }) {
  const [on, set] = useExperiment(experiment.id);
  return (
    <ToggleRow
      label={experiment.label}
      hint={`${experiment.hint} Decide by ${decideByLabel(experiment.decideBy)}.`}
      checked={on}
      onCheckedChange={set}
      {...(on ? { onRevert: () => set(false) } : {})}
    />
  );
}

export function ExperimentalRows({ experiments = EXPERIMENTS }: { experiments?: readonly Experiment[] }) {
  const [chosen, setOpen] = useState(false);
  useRestoreDefaults(() => {
    for (const experiment of experiments) setExperiment(experiment.id, false);
  });
  const revealing = usePendingReveal();
  const open = chosen || experiments.some((experiment) => revealing === settingsRowId({ page: "general", group: "About", label: experiment.label }));
  return (
    <>
      <Row
        label="Experiments"
        hint="Big changes on trial, each with a date to decide."
        info="Kept in this window's own storage. Another browser, or a phone, keeps its own."
        control={
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
      />
      {open &&
        (experiments.length === 0 ? (
          <Row label="Nothing on trial" hint="Trials appear here when there is one to try." control={null} />
        ) : (
          experiments.map((experiment) => <ExperimentRow key={experiment.id} experiment={experiment} />)
        ))}
    </>
  );
}
