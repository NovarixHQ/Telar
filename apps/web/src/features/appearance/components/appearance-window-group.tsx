"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { MAX_TRANSLUCENCY, MIN_TRANSLUCENCY, type Appearance, type ChatWidth, type Frost } from "../appearance";
import { desktopAppearance } from "@/platform/desktop/desktop-appearance";
import { Row, Segmented, SettingsGroup } from "@/features/settings";

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
    <SettingsGroup title="Window">
      <Row
        keywords={["wide", "full", "comfortable", "column", "measure", "transcript"]}
        label="Chat width"
        hint="How wide the conversation and the composer can grow."
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
      {hasBridge && windowSupported && (
        <Row
          keywords={["glass", "blur", "clear", "frost", "vibrancy", "transparent"]}
          label="Translucency"
          hint="Lets the desktop show through the window, which rebuilds it."
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
      )}
      {hasBridge && windowSupported && appearance.translucent && (
        <Row
          keywords={["show-through", "show through", "opacity", "see-through", "glass"]}
          label="See-through"
          hint="How much of the desktop shows behind the canvas and the rail."
          control={
            <div className="flex items-center gap-2.5">
              <input
                type="range"
                min={MIN_TRANSLUCENCY}
                max={MAX_TRANSLUCENCY}
                step={5}
                value={appearance.translucencyLevel}
                aria-label="See-through"
                className="w-36 accent-primary"
                onChange={(event) => setAppearance({ translucencyLevel: Number(event.target.value) })}
              />
              <span className="w-9 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{appearance.translucencyLevel}%</span>
            </div>
          }
        />
      )}
    </SettingsGroup>
  );
}
