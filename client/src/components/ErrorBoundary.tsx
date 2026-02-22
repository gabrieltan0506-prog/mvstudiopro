import React, { Component, ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

interface Props {
  children: ReactNode;
  fallback?: (error: Error, resetError: () => void) => ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * ErrorBoundary 组件
 * 
 * 用于捕获子组件中的 JavaScript 错误，防止整个应用崩溃。
 */
export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("ErrorBoundary caught an error:", error, errorInfo);
  }

  resetError = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError && this.state.error) {
      if (this.props.fallback) {
        return this.props.fallback(this.state.error, this.resetError);
      }

      return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-[#0A0A0C] p-6 text-center">
          <div className="mb-6">
            <AlertTriangle size={64} className="text-[#FF453A]" />
          </div>
          <h2 className="text-2xl font-bold text-[#F7F4EF] mb-3">糟糕！出现错误了</h2>
          <p className="text-base text-[#9B9691] mb-8 leading-6 max-w-md">
            {this.state.error.message || "应用程序遇到了一个未预期的错误"}
          </p>
          <button
            className="flex items-center gap-2 bg-[#FF6B35] text-white font-semibold px-6 py-3 rounded-xl hover:bg-orange-600 transition-colors"
            onClick={this.resetError}
          >
            <RefreshCw size={20} />
            <span>重新加载</span>
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
