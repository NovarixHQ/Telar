"use client";

import { useMemo } from "react";
import type { ProviderDriverKind } from "@telar/engine-client";
import { useModelCatalogue } from "@/features/providers";
import { type ModelChoice } from "@telar/client/providers";
import { selectionOf } from "../model-options";

/** Whether the selected model publishes effort levels, so the `/` menu offers `/effort`. */
export function useHasEfforts(driver: ProviderDriverKind, choice: ModelChoice, instanceId?: string): boolean {
  const models = useModelCatalogue(driver, instanceId)?.models;
  // Depends on the fields, not the choice: the composer builds a fresh one every render.
  const { model, effort, fastMode } = choice;
  return useMemo(() => {
    if (!models) return false;
    const selection = selectionOf(models, {
      ...(model ? { model } : {}),
      ...(effort ? { effort } : {}),
      ...(fastMode === undefined ? {} : { fastMode }),
    });
    return selection.levels.length > 0;
  }, [models, model, effort, fastMode]);
}
