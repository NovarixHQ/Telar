"use client";

import { useEffect } from "react";
import { AppearancePublisher } from "./appearance-publisher";
import { HostLookFollower } from "./host-look-follower";
import { applyAppearance, useAppearance } from "../appearance";

export function AppearanceProvider({ children }: { children: React.ReactNode }) {
  const { appearance } = useAppearance();
  useEffect(() => applyAppearance(appearance), [appearance]);
  return (
    <>
      <AppearancePublisher />
      <HostLookFollower />
      {children}
    </>
  );
}
