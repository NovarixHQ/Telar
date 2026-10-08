"use client";

import { MessageResponse } from "@/ui/message";

export const READING_MEASURE = "max-w-[64ch]";

const PANEL_MARKDOWN =
  "text-xs [&_h1]:text-sm [&_h1]:mt-3 [&_h2]:text-xs-plus [&_h2]:mt-3 [&_h3]:text-xs [&_h4]:text-xs [&_h5]:text-xs [&_h6]:text-xs [&_pre]:text-3xs [&_code]:text-3xs [&_img]:max-h-64";

/** GitHub markdown through the transcript's renderer, rescaled for the panel. */
export function Markdown({ children }: { children: string }) {
  return (
    <MessageResponse className={PANEL_MARKDOWN}>
      {children}
    </MessageResponse>
  );
}
