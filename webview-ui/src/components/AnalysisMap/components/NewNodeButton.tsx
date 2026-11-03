/**
 * New node button component for AnalysisMap
 */

// React import not needed for JSX in modern React
import { NewNodeButton as NewNodeButtonType } from "../hooks/useMapState";

interface NewNodeButtonProps {
  newNodeButton: NewNodeButtonType | null;
  onGoToNode: () => void;
  onDismiss: () => void;
}

export function NewNodeButton({ newNodeButton, onGoToNode, onDismiss }: NewNodeButtonProps) {
  if (!newNodeButton) {
    return null;
  }

  return (
    <div
      className="absolute z-50 animate-pulse"
      style={{
        left: newNodeButton.position.x,
        top: newNodeButton.position.y,
        transform: 'translateX(-50%)',
        animation: 'pulse 2s infinite',
      }}
    >
      <div className="flex flex-col items-center gap-2">
        <button
          onClick={onGoToNode}
          className="bg-purple-600 hover:bg-purple-700 text-white px-3 py-2 rounded-lg shadow-lg text-sm font-medium transition-colors"
        >
          🎯 Go to New Node
        </button>
        <button
          onClick={onDismiss}
          className="text-xs text-[var(--vscode-descriptionForeground)] hover:text-[var(--vscode-foreground)] underline"
        >
          dismiss
        </button>
      </div>
    </div>
  );
}