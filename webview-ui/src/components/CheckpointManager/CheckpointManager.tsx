import React, { useState, useEffect } from "react";
import { MessageService } from "../../services/MessageService";

interface Checkpoint {
  id: string;
  timestamp: string;
  createdAt: Date;
  analets: any[];
  datasetName?: string;
  description: string;
  analetsCount: number;
}

interface CheckpointManagerProps {
  onClose?: () => void;
  onRestore?: (checkpoint: Checkpoint) => void;
}

export const CheckpointManager: React.FC<CheckpointManagerProps> = (props) => {
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const messageService = MessageService.getInstance();

  // Load checkpoints on mount
  useEffect(() => {
    loadCheckpoints();
  }, []);

  const loadCheckpoints = async () => {
    setLoading(true);
    try {
      const off = messageService.onMessage('checkpoints-loaded', (data) => {
        off();
        const parsedCheckpoints = data.checkpoints.map((cp: any) => ({
          ...cp,
          createdAt: new Date(cp.createdAt)
        }));
        setCheckpoints(parsedCheckpoints);
        setLoading(false);
      });
      messageService.sendMessage('get-checkpoints', {});
    } catch (error) {
      console.error('❌ [CheckpointManager] Failed to load checkpoints:', error);
      setLoading(false);
    }
  };

  const restoreCheckpoint = async (checkpoint: Checkpoint) => {
    setRestoring(checkpoint.id);
    try {
      const off = messageService.onMessage('checkpoint-restored', (data) => {
        off();
        if (data.success) {
          props.onRestore?.(checkpoint);
          props.onClose?.();
        } else {
          console.error('❌ [CheckpointManager] Failed to restore checkpoint:', data.error);
          alert(`Failed to restore checkpoint: ${data.error}`);
        }
        setRestoring(null);
      });
      messageService.sendMessage('restore-checkpoint', { checkpointId: checkpoint.id });
    } catch (error) {
      console.error('❌ [CheckpointManager] Failed to restore checkpoint:', error);
      console.error(`❌ [CheckpointManager] Failed to restore checkpoint: ${error}`);
      setRestoring(null);
    }
  };

  const deleteCheckpoint = async (checkpoint: Checkpoint) => {
    // Note: VS Code webviews don't support confirm() modals
    // TODO: Consider implementing a custom confirmation modal within the webview

    setDeleting(checkpoint.id);
    try {
      const off = messageService.onMessage('checkpoint-deleted', (data) => {
        off();
        if (data.success) {
          setCheckpoints(prev => prev.filter(cp => cp.id !== checkpoint.id));
        } else {
          console.error('❌ [CheckpointManager] Failed to delete checkpoint:', data.error);
          alert(`Failed to delete checkpoint: ${data.error}`);
        }
        setDeleting(null);
      });
      messageService.sendMessage('delete-checkpoint', { checkpointId: checkpoint.id });
    } catch (error) {
      console.error('❌ [CheckpointManager] Failed to delete checkpoint:', error);
      alert(`Failed to delete checkpoint: ${error}`);
      setDeleting(null);
    }
  };

  const formatDate = (date: Date) => {
    return date.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getRelativeTime = (date: Date) => {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} min ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-[var(--vscode-editor-background)] border border-[var(--vscode-widget-border)] rounded-lg shadow-lg max-w-4xl w-full max-h-5/6 flex flex-col m-4">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[var(--vscode-widget-border)]">
          <div className="flex items-center gap-3">
            <div className="text-lg font-semibold text-[var(--vscode-foreground)]">
              📸 Checkpoint Manager
            </div>
            <div className="text-sm text-[var(--vscode-descriptionForeground)]">
              {checkpoints.length} checkpoint{checkpoints.length !== 1 ? 's' : ''}
            </div>
          </div>
          <button
            onClick={props.onClose}
            className="text-[var(--vscode-foreground)] hover:bg-[var(--vscode-toolbar-hoverBackground)] rounded p-1 transition-colors"
            title="Close"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {loading && (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-[var(--vscode-descriptionForeground)]">Loading checkpoints...</div>
            </div>
          )}

          {!loading && checkpoints.length === 0 && (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center text-[var(--vscode-descriptionForeground)]">
                <div className="text-6xl mb-4">📸</div>
                <div className="text-lg mb-2">No checkpoints found</div>
                <div className="text-sm">Checkpoints are created automatically when you add analets</div>
              </div>
            </div>
          )}

          {!loading && checkpoints.length > 0 && (
            <div className="flex-1 overflow-y-auto p-4">
              <div className="space-y-3">
                {checkpoints.map((checkpoint) => (
                    <div key={checkpoint.id} className="border border-[var(--vscode-widget-border)] rounded-lg p-4 hover:bg-[var(--vscode-list-hoverBackground)] transition-colors">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          {/* Main info */}
                          <div className="flex items-center gap-2 mb-2">
                            <div className="text-sm font-medium text-[var(--vscode-foreground)] truncate">
                              {checkpoint.description}
                            </div>
                            <div className="text-xs px-2 py-1 bg-[var(--vscode-badge-background)] text-[var(--vscode-badge-foreground)] rounded">
                              {checkpoint.analetsCount} analet{checkpoint.analetsCount !== 1 ? 's' : ''}
                            </div>
                          </div>

                          {/* Dataset info */}
                          {checkpoint.datasetName && (
                            <div className="text-xs text-[var(--vscode-descriptionForeground)] mb-2">
                              📊 Dataset: {checkpoint.datasetName}
                            </div>
                          )}

                          {/* Timestamp */}
                          <div className="flex items-center gap-4 text-xs text-[var(--vscode-descriptionForeground)]">
                            <div>📅 {formatDate(checkpoint.createdAt)}</div>
                            <div>🕒 {getRelativeTime(checkpoint.createdAt)}</div>
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => restoreCheckpoint(checkpoint)}
                            disabled={restoring === checkpoint.id}
                            className="px-3 py-1.5 bg-[var(--vscode-button-background)] text-[var(--vscode-button-foreground)] hover:bg-[var(--vscode-button-hoverBackground)] rounded text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            title="Restore this checkpoint"
                          >
                            {restoring === checkpoint.id ? '🔄 Restoring...' : '🔄 Restore'}
                          </button>
                          <button
                            onClick={() => deleteCheckpoint(checkpoint)}
                            disabled={deleting === checkpoint.id}
                            className="px-2 py-1.5 text-[var(--vscode-errorForeground)] hover:bg-[var(--vscode-list-errorForeground)] hover:bg-opacity-10 rounded text-xs transition-colors disabled:opacity-50"
                            title="Delete this checkpoint"
                          >
                            {deleting === checkpoint.id ? '⏳' : '🗑️'}
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-[var(--vscode-widget-border)] bg-[var(--vscode-editorGroupHeader-tabsBackground)]">
          <div className="flex items-center justify-between text-xs text-[var(--vscode-descriptionForeground)]">
            <div>
              Checkpoints are saved automatically when analets are created
            </div>
            <div className="flex items-center gap-4">
              <button
                onClick={() => {
                  const off = messageService.onMessage('checkpoint-saved', (data) => {
                    off();
                    if (data.success) {
                      loadCheckpoints();
                    } else {
                      alert(`Failed to save checkpoint: ${data.error}`);
                    }
                  });
                  messageService.sendMessage('save-checkpoint', {});
                }}
                className="px-3 py-1.5 bg-[var(--vscode-button-background)] text-[var(--vscode-button-foreground)] hover:bg-[var(--vscode-button-hoverBackground)] rounded text-xs font-medium"
              >
                📸 Save checkpoint
              </button>
              <button
                onClick={loadCheckpoints}
                className="text-[var(--vscode-textLink-foreground)] hover:underline"
              >
                🔄 Refresh
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};