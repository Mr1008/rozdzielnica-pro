import type { JSX } from "react";
import { buttonVariants } from "@/components/ui/button";
import { WIRING_VARIANTS, type WiringVariant } from "@/lib/cabinet-drawing";
import { t } from "@/lib/i18n";

interface Props {
  /** The variant the page renders. */
  active: WiringVariant;
  /** Where each option leads, from `wiringViewHrefs`. */
  hrefs: Record<WiringVariant, string>;
}

/**
 * "Widok: realistyczny / schematyczny" (S-11 Phase 7): two links, so the server renders only the chosen
 * variant. Rendered on the server; it needs no island.
 */
export function WiringViewSwitch({ active, hrefs }: Props): JSX.Element {
  const v = t.layout.section.view;
  return (
    <nav aria-label={v.navLabel} className="flex items-center gap-1">
      <span aria-hidden="true" className="text-muted-foreground text-xs">
        {v.label}:
      </span>
      {WIRING_VARIANTS.map((variant) => {
        const current = variant === active;
        return (
          <a
            key={variant}
            href={hrefs[variant]}
            aria-current={current ? "page" : undefined}
            className={buttonVariants({ size: "xs", variant: current ? "secondary" : "ghost" })}
          >
            {v.options[variant]}
          </a>
        );
      })}
    </nav>
  );
}
