"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { HouseIcon, SettingsIcon, type LucideIcon } from "lucide-react";
import { useSettingsReturnPath } from "@/features/settings";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/ui/tooltip";
import { cn } from "@/ui/utils";

export function isSettingsRoute(pathname: string): boolean {
  return pathname === "/settings" || /^\/projects\/[^/]+\/settings(\/|$)/.test(pathname);
}

type Destination = { label: string; icon: LucideIcon; href?: string; owns?: (pathname: string) => boolean; pinned?: boolean };

const DESTINATIONS: Destination[] = [
  { label: "Home", icon: HouseIcon },
  { label: "Settings", icon: SettingsIcon, href: "/settings", owns: isSettingsRoute, pinned: true },
];

export function ActivityBar() {
  const pathname = usePathname();
  const homeHref = useSettingsReturnPath();
  const owner = DESTINATIONS.find((destination) => destination.owns?.(pathname));
  const item = (destination: Destination) => (
    <BarLink
      key={destination.label}
      destination={destination}
      href={destination.href ?? homeHref}
      current={owner ? owner === destination : !destination.owns}
    />
  );
  return (
    <nav aria-label="App" className="relative z-20 hidden h-svh w-(--activity-bar-width) shrink-0 flex-col items-center pb-3 md:sticky md:top-0 md:flex">
      <div className="app-drag h-[var(--titlebar-height)] w-full shrink-0" />
      <div className="flex flex-col gap-1">{DESTINATIONS.filter((destination) => !destination.pinned).map(item)}</div>
      <div className="app-drag w-full flex-1" />
      <div className="flex flex-col gap-1">{DESTINATIONS.filter((destination) => destination.pinned).map(item)}</div>
    </nav>
  );
}

function BarLink({ destination, href, current }: { destination: Destination; href: string; current: boolean }) {
  const Icon = destination.icon;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Link
            href={href}
            aria-label={destination.label}
            aria-current={current ? "page" : undefined}
            className={cn(
              "app-no-drag flex size-9 items-center justify-center rounded-lg text-sidebar-foreground/70 transition-colors",
              "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
              current && "bg-sidebar-accent text-sidebar-accent-foreground",
            )}
          >
            <Icon className="size-[18px]" />
          </Link>
        }
      />
      <TooltipContent side="right">{destination.label}</TooltipContent>
    </Tooltip>
  );
}
