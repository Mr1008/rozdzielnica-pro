import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";

interface SubmitButtonProps {
  pendingText: string;
  icon: ReactNode;
  children: ReactNode;
}

/** The form's full-width submit `Button`; while the form is pending it shows the spinner and `pendingText`. */
export function SubmitButton({ pendingText, icon, children }: SubmitButtonProps) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" pending={pending} className="w-full">
      {pending ? (
        pendingText
      ) : (
        <>
          {icon}
          {children}
        </>
      )}
    </Button>
  );
}
