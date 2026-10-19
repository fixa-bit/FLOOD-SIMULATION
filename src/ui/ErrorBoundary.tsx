import { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('FloodSim ErrorBoundary caught error:', error, errorInfo);
  }

  handleReload = () => {
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="w-full h-full min-h-[300px] bg-slate-950 flex flex-col items-center justify-center p-6 text-center text-slate-100 select-none">
          <div className="p-4 rounded-2xl bg-red-950/80 border border-red-500/50 shadow-2xl max-w-md flex flex-col items-center gap-3">
            <AlertTriangle className="w-10 h-10 text-red-400" />
            <h2 className="text-base font-bold text-white">
              {this.props.fallbackTitle || 'A rendering error occurred'}
            </h2>
            <p className="text-xs text-slate-300 font-mono bg-slate-900/90 p-2.5 rounded-lg border border-slate-800 break-words w-full text-left">
              {this.state.error?.message || 'Unknown error'}
            </p>
            <button
              onClick={this.handleReload}
              className="mt-2 px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold rounded-xl transition flex items-center gap-1.5 shadow-lg shadow-sky-600/30"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Reload Simulation</span>
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
