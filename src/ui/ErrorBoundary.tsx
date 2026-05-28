import { Component, type ReactNode } from "react";

/** Minimal error boundary: renders `fallback` instead of letting a child's render
 *  error crash the whole app. Resets automatically when `resetKey` changes (e.g.
 *  when a lesson finishes regenerating), so recovery needs no extra wiring. */
export class ErrorBoundary extends Component<
  { children: ReactNode; fallback: ReactNode; resetKey?: unknown },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidUpdate(prev: { resetKey?: unknown }) {
    if (this.state.hasError && prev.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false });
    }
  }

  render() {
    return this.state.hasError ? this.props.fallback : this.props.children;
  }
}
