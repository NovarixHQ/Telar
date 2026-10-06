import { canvasPanelKey, clearPanelTabs, editorInstanceKey, writePanelTabs, type PanelTab, type PanelTabState } from "@/features/panel";
import { clearEditor, writeEditor, type EditorState } from "@/features/files";

/** Moves the canvas's panel strip and Editor files to the session created from it; the next new conversation starts empty. */
export function handOffCanvas(
  target: string,
  projectId: string,
  { panel, editors }: { panel: PanelTabState<PanelTab>; editors: Record<string, EditorState> },
) {
  writePanelTabs(target, panel, Date.now());
  for (const [instance, state] of Object.entries(editors)) writeEditor(editorInstanceKey(target, instance), state, Date.now());
  clearPanelTabs(canvasPanelKey(projectId));
  for (const instance of Object.keys(editors)) clearEditor(editorInstanceKey(canvasPanelKey(projectId), instance));
  clearEditor(canvasPanelKey(projectId));
}
