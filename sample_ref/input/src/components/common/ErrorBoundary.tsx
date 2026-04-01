/**
 * @file ErrorBoundary.tsx
 * @author Turtle Village
 * @description Reactコンポーネントツリー内のエラーを捕捉し、ユーザーフレンドリーなフォールバックUIを表示するラッパーコンポーネント。
 */
import { Component, type ReactNode, type ErrorInfo } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { useLogStore } from '../../stores/logStore';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

/**
 * アプリケーション全体のエラーをキャッチするErrorBoundary
 * React 18対応のクラスコンポーネント実装
 */
class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    // 次のレンダリングでフォールバックUIを表示するためにstateを更新
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // エラー情報をログに記録（本番環境ではエラー追跡サービスに送信可能）
    console.error('ErrorBoundary caught an error:', error);
    console.error('Component stack:', errorInfo.componentStack);

    // ログストアにエラーを記録
    useLogStore.getState().error('GLOBAL', 'Reactエラーバウンダリでエラーを捕捉', {
      errorName: error.name,
      errorMessage: error.message,
      componentStack: errorInfo.componentStack?.substring(0, 200)
    });

    this.setState({ errorInfo });
  }

  handleReload = (): void => {
    // ページをリロード
    window.location.reload();
  };

  handleReset = (): void => {
    // エラー状態をリセット（再試行）
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      // カスタムフォールバックが提供されている場合はそれを使用
      if (this.props.fallback) {
        return this.props.fallback;
      }

      // デフォルトのエラーUI
      return (
        <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
          <div className="bg-gray-800 rounded-lg shadow-xl max-w-md w-full p-6 text-center">
            <div className="flex justify-center mb-4">
              <AlertTriangle className="w-16 h-16 text-red-500" />
            </div>

            <h1 className="text-xl font-bold text-white mb-2">
              エラーが発生しました
            </h1>

            <p className="text-gray-400 mb-4">
              予期しないエラーが発生しました。
              ページをリロードするか、しばらくしてから再度お試しください。
            </p>

            {/* エラー詳細（開発環境のみ表示） */}
            {import.meta.env.DEV && this.state.error && (
              <details className="mb-4 text-left">
                <summary className="text-sm text-gray-500 cursor-pointer hover:text-gray-400">
                  エラー詳細を表示
                </summary>
                <div className="mt-2 p-3 bg-gray-900 rounded text-xs font-mono text-red-400 overflow-auto max-h-40">
                  <div className="font-bold mb-1">{this.state.error.name}</div>
                  <div className="mb-2">{this.state.error.message}</div>
                  {this.state.errorInfo && (
                    <pre className="text-gray-500 whitespace-pre-wrap">
                      {this.state.errorInfo.componentStack}
                    </pre>
                  )}
                </div>
              </details>
            )}

            <div className="flex gap-3 justify-center">
              <button
                onClick={this.handleReset}
                className="px-4 py-2 bg-gray-700 text-white rounded hover:bg-gray-600 transition-colors"
              >
                再試行
              </button>
              <button
                onClick={this.handleReload}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-500 transition-colors flex items-center gap-2"
              >
                <RefreshCw className="w-4 h-4" />
                リロード
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
