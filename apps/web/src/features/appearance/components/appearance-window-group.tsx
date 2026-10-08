"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import type { Appearance, ChatWidth, Frost } from "../appearance";
import { desktopAppearance } from "@/platform/desktop/desktop-appearance";
import { Row, Segmented, SettingsGroup } from "@/features/settings";
import { ShowThroughRow } from "./studio/tools";

const subscribeToNothing = () => () => {};
const bridgeIsPresent = () => desktopAppearance() !== undefined;
const noBridgeOnTheServer = () => false;

type Glass = "off" | Frost;

export function AppearanceWindowGroup({
  appearance,
  setAppearance,
}: {
  appearance: Appearance;
  setAppearance: (patch: Partial<Appearance>) => void;
}) {
  const hasBridge = useSyncExternalStore(subscribeToNothing, bridgeIsPresent, noBridgeOnTheServer);
  const [windowSupported, setWindowSupported] = useState(false);

  useEffect(() => {
    if (!hasBridge) return;
    let live = true;
    void desktopAppearance()
      ?.get()
      .then((state) => {
        if (!live) return;
        setWindowSupported(state.supported);
        setAppearance({ translucent: state.translucent, frost: state.frost });
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasBridge]);

  const setGlass = (next: Glass) => {
    const patch = next === "off" ? { translucent: false } : { translucent: true, frost: next };
    setAppearance(patch);
    void desktopAppearance()?.set(patch);
  };

  return (
    <SettingsGroup title="Window" description="How the window is drawn around the transcript.">
      {hasBridge && windowSupported ? (
        <>
          <Row
            keywords={["glass", "blur", "clear", "frost", "vibrancy", "transparent"]}
            label="Translucency"
            hint="Rebuilds the window."
            control={
              <Segmented<Glass>
                value={appearance.translucent ? appearance.frost : "off"}
                onChange={setGlass}
                options={[
                  { value: "off", label: "Off" },
                  { value: "blur", label: "Blur" },
                  { value: "clear", label: "Clear" },
                ]}
              />
            }
          />
        </>
      ) : (
        <p className="py-3 text-xs text-muted-foreground">Translucency needs the macOS desktop app.</p>
      )}
      <ShowThroughRow level={appearance.translucencyLevel} onChange={(translucencyLevel) => setAppearance({ translucencyLevel })} />
      <Row
        keywords={["wide", "full", "comfortable", "column", "measure", "transcript"]}
        label="Chat width"
        hint="How wide the transcript and the composer can grow."
        control={
          <Segmented<ChatWidth>
            value={appearance.chatWidth}
            onChange={(chatWidth) => setAppearance({ chatWidth })}
            options={[
              { value: "comfortable", label: "Comfortable" },
              { value: "wide", label: "Wide" },
              { value: "full", label: "Full" },
            ]}
          />
        }
      />
    </SettingsGroup>
  );
}
