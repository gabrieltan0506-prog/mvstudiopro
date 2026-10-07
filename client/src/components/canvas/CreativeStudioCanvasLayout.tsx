import type { ReactNode } from "react";
/** Keep long editors scrollable without consuming the dock canvas viewport. */
export function CreativeStudioCanvasLayout({
  tools,
  children,
}: {
  tools: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      className="absolute inset-0 flex min-h-0 flex-col overflow-hidden"
      data-creative-canvas-layout
    >
      <div
        className="max-h-[45%] shrink-0 overflow-y-auto overscroll-contain px-2"
        data-creative-studio-tools
      >
        {tools}
      </div>
      <div
        className="relative min-h-0 flex-1 overflow-hidden"
        data-creative-studio-canvas
      >
        {children}
      </div>
    </div>
  );
}
