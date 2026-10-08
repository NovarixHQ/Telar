"use client";

import { useEffect, useState } from "react";
import { ToggleRow, useRestoreDefaults } from "@/features/settings";
import { desktopBrowserBridge } from "../desktop-browser-bridge";

export function LoginOfferToggle() {
  const [offer, setOffer] = useState<boolean>();
  const bridge = desktopBrowserBridge();

  useEffect(() => {
    void bridge?.loginOfferPrefs?.().then((prefs) => setOffer(prefs.offerAfterSignIn));
  }, [bridge]);

  const change = async (next: boolean) => {
    if (!bridge?.loginOfferPrefs) return;
    setOffer(next);
    setOffer((await bridge.loginOfferPrefs({ offerAfterSignIn: next })).offerAfterSignIn);
  };
  useRestoreDefaults(() => change(false));
  if (!bridge?.loginOfferPrefs || offer === undefined) return null;
  return (
    <ToggleRow
      keywords={["1password", "save login", "remember", "offer", "prompt", "password"]}
      label="Offer to remember after you sign in"
      hint="After you type a login in Telar's browser, ask whether agents may reuse it."
      checked={offer}
      onCheckedChange={(next) => void change(next)}
      {...(offer ? { onRevert: () => void change(false) } : {})}
    />
  );
}

export function PasswordManagerToggles() {
  const [enabled, setEnabled] = useState<boolean>();
  const bridge = desktopBrowserBridge();

  useEffect(() => {
    void bridge?.passwordManager?.().then((prefs) => setEnabled(prefs.enabled));
  }, [bridge]);

  if (!bridge?.passwordManager) return <LoginOfferToggle />;
  if (enabled === undefined) return null;
  const change = async (next: boolean) => {
    setEnabled(next);
    setEnabled((await bridge.passwordManager!({ enabled: next })).enabled);
  };
  return (
    <>
      <ToggleRow
        keywords={["1password", "extension", "autofill", "disable", "off", "credential", "integrations"]}
        label="Use a password manager in the browser"
        hint="Lets Telar's browser and agents fill logins from your password manager."
        info="Off hides its browser button and stops agents filling logins at once. Browsers already open keep its extension loaded until Telar restarts."
        checked={enabled}
        onCheckedChange={(next) => void change(next)}
      />
      {enabled && <LoginOfferToggle />}
    </>
  );
}
