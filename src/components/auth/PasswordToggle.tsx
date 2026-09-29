import { Eye, EyeOff } from "lucide-react";
import { InputGroupButton } from "@/components/ui/input-group";
import { t } from "@/lib/i18n";

interface PasswordToggleProps {
  visible: boolean;
  onToggle: () => void;
}

/** A ghost icon button in the field's trailing addon; focus shows the global `:focus-visible` ring. */
export function PasswordToggle({ visible, onToggle }: PasswordToggleProps) {
  return (
    <InputGroupButton
      size="icon-xs"
      onClick={onToggle}
      aria-label={visible ? t.auth.hidePassword : t.auth.showPassword}
    >
      {visible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
    </InputGroupButton>
  );
}
