import type { JSX } from "react";
import { buttonVariants } from "@/components/ui/button";
import { t } from "@/lib/i18n";
import { DRAWING_VIEWS, type DrawingView } from "@/lib/wiring-view";

interface Props {
  /** The view the page renders. */
  active: DrawingView;
  /** Where each option leads, from `wiringViewHrefs`. */
  hrefs: Record<DrawingView, string>;
}

/**
 * "Widok: realistyczny / schematyczny / 3D" (S-11 Phase 7, GitHub #14): one link per view, so the server
 * renders only the chosen one. Rendered on the server; it needs no island.
 */
export function WiringViewSwitch({ active, hrefs }: Props): JSX.Element {
  const v = t.layout.section.view;
  return (
    <nav aria-label={v.navLabel} className="flex items-center gap-1">
      <span aria-hidden="true" className="text-muted-foreground text-xs">
        {v.label}:
      </span>
      {DRAWING_VIEWS.map((view) => {
        const current = view === active;
        return (
          <a
            key={view}
            href={hrefs[view]}
            aria-current={current ? "page" : undefined}
            className={buttonVariants({ size: "xs", variant: current ? "secondary" : "ghost" })}
          >
            {v.options[view]}
          </a>
        );
      })}
    </nav>
  );
}
