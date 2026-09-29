import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Loader2Icon } from "lucide-react";

/** Registry component; the only change is the Polish label from `t` instead of an inline "Loading". */
function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  return (
    <Loader2Icon
      role="status"
      aria-label={t.common.loading}
      className={cn("size-4 animate-spin", className)}
      {...props}
    />
  );
}

export { Spinner };
