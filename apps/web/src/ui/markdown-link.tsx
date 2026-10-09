"use client";

import { useState, type AnchorHTMLAttributes, type MouseEvent } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { hostFromPathname, hostPrefix } from "@/platform/engine/host-client";
import { useLinkPolicy } from "@/platform/link-policy";
import { Button } from "@/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/ui/dialog";
import { cn } from "@/ui/utils";

const APP_ROUTE = /^\/(?:projects|hosts|settings|usage)(?:[/?#]|$)/;

/** The cockpit route an href points at, under the viewed host's prefix, or undefined for anything external. */
export function inAppHref(href: string, pathname: string, origin: string): string | undefined {
  let path: string;
  if (href.startsWith("/") && !href.startsWith("//")) path = href;
  else {
    try {
      const url = new URL(href);
      if (url.origin !== origin) return undefined;
      path = `${url.pathname}${url.search}${url.hash}`;
    } catch {
      return undefined;
    }
  }
  if (!APP_ROUTE.test(path)) return undefined;
  return path.startsWith("/projects") ? `${hostPrefix(hostFromPathname(pathname))}${path}` : path;
}

type Props = AnchorHTMLAttributes<HTMLAnchorElement> & { node?: unknown };

export function MarkdownLink({ href, className, children, node: _node, ...props }: Props) {
  const pathname = usePathname() ?? "";
  const { openInSessionBrowser } = useLinkPolicy();
  const [confirming, setConfirming] = useState(false);
  const style = cn("wrap-anywhere font-medium text-primary underline", className);
  const route = href ? inAppHref(href, pathname, typeof window === "undefined" ? "" : window.location.origin) : undefined;
  if (route) return <Link {...props} href={route} className={style} data-streamdown="link">{children}</Link>;
  const external = Boolean(href) && !href!.startsWith("#");
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.defaultPrevented || !external || openInSessionBrowser) return;
    event.preventDefault();
    setConfirming(true);
  };
  return (
    <>
      <a {...props} href={href} className={style} data-streamdown="link" onClick={onClick} {...(external ? { target: "_blank", rel: "noreferrer" } : {})}>
        {children}
      </a>
      {confirming && href && <ExternalLinkDialog url={href} onClose={() => setConfirming(false)} />}
    </>
  );
}

function ExternalLinkDialog({ url, onClose }: { url: string; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Open external link?</DialogTitle>
          <DialogDescription>You&apos;re about to visit an external website.</DialogDescription>
        </DialogHeader>
        <p className="break-all rounded-md bg-muted px-2 py-1.5 font-mono text-xs">{url}</p>
        <DialogFooter>
          <Button variant="outline" onClick={() => void navigator.clipboard?.writeText(url).catch(() => undefined)}>Copy link</Button>
          <Button
            onClick={() => {
              onClose();
              window.open(url, "_blank", "noreferrer");
            }}
          >
            Open link
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
