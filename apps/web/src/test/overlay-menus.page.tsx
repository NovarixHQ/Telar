import { createRoot } from "react-dom/client";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/ui/dropdown-menu";
import { useOverlayLayerHost } from "@/platform/desktop/overlay-layer";

function BrowserHost() {
  useOverlayLayerHost();
  return null;
}

const ROWS = Array.from({ length: 8 }, (_, index) => `A longer menu row ${index + 1}`);

function Menu({ id, style, align }: { id: string; style: React.CSSProperties; align?: "start" | "end" }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger id={id} style={{ position: "fixed", width: 120, height: 24, ...style }}>
        {id}
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className={`menu-${id}`}>
        {ROWS.map((row) => (
          <DropdownMenuItem key={row}>{row}</DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

createRoot(document.getElementById("root")!).render(
  <>
    <BrowserHost />
    <Menu id="low" style={{ left: 300, bottom: 40 }} />
    <Menu id="high" style={{ right: 260, top: 60 }} align="end" />
  </>,
);
