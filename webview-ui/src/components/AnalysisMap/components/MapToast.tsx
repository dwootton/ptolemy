/**
 * Toast notification component for AnalysisMap
 */

// React import not needed for JSX in modern React
import { ToastState } from "../hooks/useMapState";

interface MapToastProps {
  toastState: ToastState;
  onClose: () => void;
}

export function MapToast({ toastState, onClose }: MapToastProps) {
  if (!toastState.visible || !toastState.message) {
    return null;
  }

  return (
    <div
      className={`
        absolute top-16 left-1/2 transform -translate-x-1/2 
        bg-[var(--vscode-editor-background)] rounded-lg px-3 py-2 
        shadow-lg z-40 border border-[var(--vscode-widget-border)]
        transition-opacity duration-300
        ${toastState.visible ? 'opacity-100' : 'opacity-0'}
      `}
    >
      <div className="flex items-center gap-2">
        <span className="text-[var(--vscode-foreground)] text-sm">
          {toastState.message}
        </span>
        <button
          onClick={onClose}
          className="text-[var(--vscode-foreground)] hover:text-[var(--vscode-errorForeground)] transition-colors"
          aria-label="Close notification"
        >
          ×
        </button>
      </div>
    </div>
  );
}