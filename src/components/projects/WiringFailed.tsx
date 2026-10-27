import type { JSX } from "react";
import { CircleAlertIcon } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { t } from "@/lib/i18n";

/**
 * Stands where the wires go when the browser failed to route them. `data-wiring-failed` lets the print
 * page tell "failed" from "still loading" when its script starts after the failure.
 */
export function WiringFailed(): JSX.Element {
  return (
    <Alert variant="destructive" role="status" data-wiring-failed="">
      <CircleAlertIcon aria-hidden="true" />
      <AlertDescription>{t.layout.section.wiresFailed}</AlertDescription>
    </Alert>
  );
}
