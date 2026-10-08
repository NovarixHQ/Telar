"use client";

import { useMemo } from "react";
import type { ProviderDriverKind } from "@telar/engine-client";
import { type ModelChoice, useModelCatalogue } from "@/features/providers";
import { selectionOf } from "../model-options";

/** The effort rows the `/` menu offers, from the same selection as the reasoning pill. */
export function useComposerEfforts(driver: ProviderDriverKind, choice: ModelChoice, instanceId?: string): string[] {
  const models = useModelCatalogue(driver, instanceId)?.models;
  // Depends on the fields, not the choice: the composer builds a fresh one every render.
  const { model, effort, fastMode } = choice;
  return useMemo(() => {
    if (!models) return [];
    const selection = selectionOf(models, {
      ...(model ? { model } : {}),
      ...(effort ? { effort } : {}),
      ...(fastMode === undefined ? {} : { fastMode }),
    });
    return [...selection.levels];
  }, [models, model, effort, fastMode]);
}
