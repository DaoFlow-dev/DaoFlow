import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * Catches rendering errors and shows a friendly fallback.
 *
 * Wrap around any tree that should gracefully degrade:
 *   <ErrorBoundary>
 *     <RiskyComponent />
 *   </ErrorBoundary>
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary] Caught:", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div className="df-error-boundary">
          <div className="df-error-boundary__content">
            <h2 className="df-error-boundary__title">Something went wrong</h2>
            <p className="df-error-boundary__message">
              {this.state.error?.message ?? "An unexpected error occurred."}
            </p>
            <button className="df-btn df-btn--ghost" onClick={() => window.location.reload()}>
              Reload Page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
