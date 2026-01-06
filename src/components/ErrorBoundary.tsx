import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  children?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  private handleReload = () => {
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background p-4">
      return (
        <div className="min-h-screen flex items-center justify-center bg-background p-4">
          <div className="w-full max-w-md border border-destructive/50 rounded-lg bg-card text-card-foreground shadow-sm">
            <div className="flex flex-col space-y-1.5 p-6">
              <div className="flex items-center gap-2 text-destructive mb-2">
                <AlertCircle className="h-6 w-6" />
                <h3 className="text-2xl font-semibold leading-none tracking-tight">Something went wrong</h3>
              </div>
              <p className="text-sm text-muted-foreground">
                An unexpected error occurred in the application.
              </p>
            </div>
            <div className="p-6 pt-0">
              <div className="bg-muted p-4 rounded-md text-sm font-mono break-all text-muted-foreground">
                {this.state.error?.message || "Unknown error"}
              </div>
            </div>
            <div className="flex items-center p-6 pt-0">
              <Button onClick={this.handleReload} className="w-full">
                <RefreshCw className="mr-2 h-4 w-4" />
                Reload Application
              </Button>
            </div>
          </div>
        </div>
      );
        </div>
      );
    }

    return this.props.children;
  }
}
