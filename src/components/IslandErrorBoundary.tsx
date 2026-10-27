import { Component, type ErrorInfo, type JSX, type ReactNode } from "react";
import { CircleAlertIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { reportClientError } from "@/lib/client-error-reporter";
import { t } from "@/lib/i18n";

/** What replaces an island that failed to render. Shown by the boundary and on `/dev/kitchen-sink`. */
export function IslandErrorFallback(): JSX.Element {
  const e = t.errors.island;
  return (
    <Alert variant="destructive">
      <CircleAlertIcon aria-hidden="true" />
      <AlertTitle>{e.title}</AlertTitle>
      <AlertDescription>
        <p>{e.description}</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-2"
          onClick={() => {
            window.location.reload();
          }}
        >
          {e.reload}
        </Button>
      </AlertDescription>
    </Alert>
  );
}

interface Props {
  /** The island's name, sent with the report. */
  component: string;
  children: ReactNode;
}

interface State {
  failed: boolean;
}

/**
 * The root of every signed-in island: a render error shows a Polish "reload" alert instead of an
 * unmounted island, and is reported as `client.boundary`. The public auth forms do not use it, as
 * the report endpoint is signed-in only.
 */
export class IslandErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, _info: ErrorInfo): void {
    reportClientError("boundary", error, { component: this.props.component });
  }

  render(): ReactNode {
    return this.state.failed ? <IslandErrorFallback /> : this.props.children;
  }
}
