import React, { useState, useEffect } from "react";
import { DatasetLoader } from "../DatasetLoader";
import { MessageService } from "../../services/MessageService";
import { StudyConfigurationService } from "../../services/StudyConfigurationService";
import { FeatureFlags } from "../../utils/featureFlags";

interface Checkpoint {
  id: string;
  timestamp: string;
  createdAt: Date;
  analets: any[];
  datasetName?: string;
  description: string;
  analetsCount: number;
}

interface InitialLoadScreenProps {
  onDatasetLoaded: (dataset: any) => void;
  onCheckpointLoaded: (checkpoint: Checkpoint) => void;
}

export const InitialLoadScreen: React.FC<InitialLoadScreenProps> = ({ onDatasetLoaded, onCheckpointLoaded }) => {
  const [view, setView] = useState<'selection' | 'dataset' | 'checkpoint'>('selection');
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [quickActions, setQuickActions] = useState<{
    csvPaths: string[];
    hasVehiclesFinal: boolean;
    baselineCheckpointPath?: string;
    checkpointFiles: string[];
  } | null>(null);
  const [localWorkspaces, setLocalWorkspaces] = useState<Array<{ name: string; path: string; hasPtolemy: boolean; csvCount: number; checkpointCount: number }>>([]);
  const [resetNotice, setResetNotice] = useState<string | null>(null);
  const [studyToggleBusy, setStudyToggleBusy] = useState(false);
  const [studyModeEnabled, setStudyModeEnabled] = useState<boolean>(() => {
    try { return window.localStorage.getItem('meridian.studyMode.override') === 'true'; } catch { return false; }
  });
  const [studyStages, setStudyStages] = useState<any[] | null>(null);
  const [currentStageIndex, setCurrentStageIndex] = useState<number | null>(null);
  const [gotoBusyIndex, setGotoBusyIndex] = useState<number | null>(null);

  const messageService = MessageService.getInstance();

  // Hydrate workspace info and quick actions
  useEffect(() => {
    const handleInfo = (data: any) => {
      if (data?.success) {
        setQuickActions(data.quickActions || null);
      }
    };
    const unsub = messageService.onMessage('workspace:info:result', handleInfo);
    messageService.sendMessage('workspace:info');
    return () => {
      unsub();
      messageService.offMessage('workspace:info:result', handleInfo);
    };
  }, [messageService]);

  // Load study stages summary (if study is active)
  useEffect(() => {
    const onConfig = (data: any) => {
      if (data?.success && data?.config) {
        const stages = Array.isArray(data.config.stages) ? data.config.stages : [];
        setStudyStages(stages);
        try { setCurrentStageIndex(typeof data.currentStage?.stageIndex === 'number' ? data.currentStage.stageIndex : (typeof data.config.currentStageIndex === 'number' ? data.config.currentStageIndex : null)); } catch {}
      }
    };
    const off = messageService.onMessage('study:current-config:result', onConfig);
    messageService.sendMessage('study:get-current-config');
    return () => { off(); messageService.offMessage('study:current-config:result', onConfig); };
  }, [messageService]);

  // Load local folders list from extension root
  useEffect(() => {
    const handleList = (data: any) => {
      if (data?.success && Array.isArray(data.folders)) {
        setLocalWorkspaces(data.folders);
      }
    };
    const unsub = messageService.onMessage('workspace:list-local-folders:result', handleList);
    messageService.sendMessage('workspace:list-local-folders');
    return () => {
      unsub();
      messageService.offMessage('workspace:list-local-folders:result', handleList);
    };
  }, [messageService]);

  // Load checkpoints when checkpoint view is selected
  useEffect(() => {
    if (view === 'checkpoint') {
      loadCheckpoints();
    }
  }, [view]);

  const loadCheckpoints = async () => {
    setLoading(true);
    try {
      messageService.sendMessage('get-checkpoints', {});
      // Listen for response
      const unsubscribe = messageService.onMessage('checkpoints-loaded', (data) => {
        const parsedCheckpoints = data.checkpoints.map((cp: any) => ({
          ...cp,
          createdAt: new Date(cp.createdAt)
        }));
        setCheckpoints(parsedCheckpoints);
        setLoading(false);
        unsubscribe(); // Clean up listener
      });

      // Timeout fallback
      setTimeout(() => {
        if (loading) {
          setLoading(false);
          console.warn('⚠️ [InitialLoadScreen] Checkpoint loading timeout');
        }
      }, 5000);
    } catch (error) {
      console.error('❌ [InitialLoadScreen] Failed to load checkpoints:', error);
      setLoading(false);
    }
  };

  const restoreCheckpoint = async (checkpoint: Checkpoint) => {
    setRestoring(checkpoint.id);
    try {
      messageService.sendMessage('restore-checkpoint', { checkpointId: checkpoint.id });
      // Listen for response
      const unsubscribe = messageService.onMessage('checkpoint-restored', (data) => {
        if (data.success) {
          onCheckpointLoaded(checkpoint);
        } else {
          console.error('❌ [InitialLoadScreen] Failed to restore checkpoint:', data.error);
          alert(`Failed to restore checkpoint: ${data.error}`);
        }
        setRestoring(null);
        unsubscribe(); // Clean up listener
      });
    } catch (error) {
      console.error('❌ [InitialLoadScreen] Failed to restore checkpoint:', error);
      alert(`Failed to restore checkpoint: ${error}`);
      setRestoring(null);
    }
  };

  // New: Load specific CSV as a new workspace named after the dataset
  const handleLoadCsvAsWorkspace = (csvPath: string) => {
    try {
      // Load the dataset within the current workspace rather than creating a new one
      messageService.sendMessage('analyze-dataset-from-path', { filePath: csvPath });
    } catch (error) {
      console.error('❌ [InitialLoadScreen] Error loading dataset from path:', error);
    }
  };

  // New: Switch to a checkpoint's workspace and restore it
  const handleRestoreCheckpointFile = (checkpointPath: string) => {
    try {
      messageService.sendMessage('workspace:switch-to-checkpoint', { filePath: checkpointPath });
    } catch (error) {
      console.error('❌ [InitialLoadScreen] Error switching to checkpoint workspace:', error);
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

  const enableStudyMode = async () => {
    if (studyToggleBusy) return;
    setStudyToggleBusy(true);
    try {
      // Persist local override so FeatureFlags in webview picks it up after reload
      try { window.localStorage.setItem('meridian.studyMode.override', 'true'); } catch {}
      setStudyModeEnabled(true);
      // Ask extension to persist override and reload window to activate handlers
      await messageService.sendMessage('set-study-mode', { enabled: true, reload: true });
    } catch (e) {
      console.error('❌ [InitialLoadScreen] Failed to enable Study Mode:', e);
      setStudyToggleBusy(false);
    }
  };

  if (view === 'dataset') {
    return <DatasetLoader onDatasetLoaded={onDatasetLoaded} />;
  }

  if (view === 'checkpoint') {
    return (
      <div className="flex flex-col items-center justify-center h-full w-full p-8 bg-[var(--vscode-editor-background)]">
        <div className="max-w-4xl w-full space-y-6">
          {/* Header */}
          <div className="text-center space-y-2">
            <h1 className="text-2xl font-bold text-[var(--vscode-foreground)]">
              Load Checkpoint
            </h1>
            <p className="text-sm text-[var(--vscode-descriptionForeground)]">
              Restore a previous analysis state
            </p>
          </div>

          {/* Back button */}
          <div className="flex justify-start">
            <button
              onClick={() => setView('selection')}
              className="flex items-center gap-2 px-3 py-2 text-[var(--vscode-textLink-foreground)] hover:bg-[var(--vscode-toolbar-hoverBackground)] rounded transition-colors text-sm"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" />
              </svg>
              Back to options
            </button>
          </div>

          {/* Checkpoints List */}
          <div className="bg-[var(--vscode-editor-background)] border border-[var(--vscode-widget-border)] rounded-lg shadow-lg">
            {loading && (
              <div className="flex items-center justify-center py-12">
                <div className="text-[var(--vscode-descriptionForeground)]">Loading checkpoints...</div>
              </div>
            )}

            {!loading && checkpoints.length === 0 && (
              <div className="flex items-center justify-center py-12">
                <div className="text-center text-[var(--vscode-descriptionForeground)]">
                  <div className="text-6xl mb-4">📸</div>
                  <div className="text-lg mb-2">No checkpoints found</div>
                  <div className="text-sm">Checkpoints are created automatically when you add analets</div>
                </div>
              </div>
            )}

            {!loading && checkpoints.length > 0 && (
              <div className="max-h-96 overflow-y-auto">
                <div className="p-4 space-y-3">
                  {checkpoints.map((checkpoint) => (
                    <div
                      key={checkpoint.id}
                      className="border border-[var(--vscode-widget-border)] rounded-lg p-4 hover:bg-[var(--vscode-list-hoverBackground)] transition-colors cursor-pointer"
                      onClick={() => !restoring && restoreCheckpoint(checkpoint)}
                    >
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

                        {/* Loading indicator */}
                        {restoring === checkpoint.id && (
                          <div className="text-xs text-[var(--vscode-descriptionForeground)]">
                            🔄 Restoring...
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Selection view
  return (
    <div className="flex flex-col items-center justify-center h-full w-full p-8 bg-[var(--vscode-editor-background)]">
      <div className="max-w-md w-full space-y-6">
        {/* Header */}
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-bold text-[var(--vscode-foreground)]">
            Ptolemy
          </h1>
          <p className="text-sm text-[var(--vscode-descriptionForeground)]">
            a map for data analysis:
          </p>
        </div>

        {/* Workspace picker */}
        <div className="space-y-2">
          <div className="text-xs font-semibold text-[var(--vscode-descriptionForeground)] uppercase tracking-wide">Select a workspace</div>
          <div className="border border-[var(--vscode-widget-border)] rounded-md divide-y divide-[var(--vscode-widget-border)]">
            {localWorkspaces.length === 0 ? (
              <div className="px-3 py-2 text-xs text-[var(--vscode-descriptionForeground)]">No folders found under current root</div>
            ) : (
              localWorkspaces.map(ws => (
                <button
                  key={ws.path}
                  onClick={() => messageService.sendMessage('workspace:switch', { path: ws.path })}
                  className="w-full text-left px-3 py-2 hover:bg-[var(--vscode-list-hoverBackground)]"
                  title={ws.path}
                >
                  <div className="flex items-center justify-between">
                    <span><span role="img" aria-label="folder">📁</span> {ws.name}</span>
                    <span className="text-xs text-[var(--vscode-descriptionForeground)]">{ws.checkpointCount} ckpt • {ws.csvCount} csv</span>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* After workspace switch, show checkpoint or csv list (detected in workspace) */}
        {quickActions && (quickActions.checkpointFiles?.length > 0 || quickActions.csvPaths?.length > 0) && (
          <div className="space-y-2 p-3 border border-[var(--vscode-widget-border)] rounded-md">
            <div className="text-xs font-semibold text-[var(--vscode-descriptionForeground)] uppercase tracking-wide">Detected in Workspace</div>
            <div className="flex flex-col gap-2">
              {quickActions.checkpointFiles && quickActions.checkpointFiles.length > 0 ? (
                <div className="text-xs">
                  <div className="mb-1 opacity-80">Checkpoints:</div>
                  <div className="space-y-1">
                    {quickActions.checkpointFiles.map(p => (
                      <button key={p} onClick={() => handleRestoreCheckpointFile(p)} className="w-full text-left px-2 py-1 rounded hover:bg-[var(--vscode-list-hoverBackground)]" title={p}>
                        <span role="img" aria-label="checkpoint">📸</span> {p.split('/').pop()}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                quickActions.csvPaths && quickActions.csvPaths.length > 0 && (
                  <div className="text-xs">
                    <div className="mb-1 opacity-80">CSV files:</div>
                    <div className="space-y-1">
                      {quickActions.csvPaths.map(p => (
                        <button key={p} onClick={() => handleLoadCsvAsWorkspace(p)} className="w-full text-left px-2 py-1 rounded hover:bg-[var(--vscode-list-hoverBackground)]" title={p}>
                          <span role="img" aria-label="csv">📄</span> {p.split('/').pop()}
                        </button>
                      ))}
                    </div>
                  </div>
                )
              )}
            </div>
          </div>
        )}

        {/* Study Stages (jump-to) */}
        {FeatureFlags.STUDY_MODE_ENABLED && Array.isArray(studyStages) && studyStages.length > 0 && (
          <div className="space-y-2 p-3 border border-[var(--vscode-widget-border)] rounded-md">
            <div className="text-xs font-semibold text-[var(--vscode-descriptionForeground)] uppercase tracking-wide">Study Stages</div>
            <div className="flex flex-col gap-2">
              {studyStages
                .map((s, i) => ({ s, i }))
                .filter(({ s }) => !s.stageType || s.stageType === 'task')
                .map(({ s, i }) => (
                  <button
                    key={i}
                    disabled={gotoBusyIndex === i}
                    onClick={async () => {
                      try {
                        setGotoBusyIndex(i);
                        await messageService.sendMessage('study:goto-stage', { index: i });
                      } finally {
                        setGotoBusyIndex(null);
                      }
                    }}
                    className="w-full text-left px-2 py-2 rounded hover:bg-[var(--vscode-list-hoverBackground)]"
                    title={`Jump to ${s.datasetSlug} • ${s.conditionCode}`}
                  >
                    <div className="flex items-center justify-between">
                      <span><span role="img" aria-label="stage">🎯</span> {s.datasetSlug} • {s.conditionCode}</span>
                      {currentStageIndex === i && (<span className="text-[10px] text-[var(--vscode-descriptionForeground)]">current</span>)}
                    </div>
                  </button>
                ))}
            </div>
          </div>
        )}

        {/* Options */}
        <div className="space-y-4">
          {/* Study Mode entry point */}
          {!FeatureFlags.STUDY_MODE_ENABLED && !studyModeEnabled && (
            <button
              onClick={enableStudyMode}
              disabled={studyToggleBusy}
              className="w-full p-4 border-2 border-[var(--vscode-widget-border)] rounded-lg hover:border-[var(--vscode-testing-iconPassed)] hover:bg-[var(--vscode-list-hoverBackground)] transition-colors text-center"
            >
              <div className="text-lg font-medium text-[var(--vscode-foreground)]">
                {studyToggleBusy ? 'Enabling Study Mode…' : 'Enable Study Mode'}
              </div>
              <div className="text-xs text-[var(--vscode-descriptionForeground)] mt-1">Reloads window to activate study UI</div>
            </button>
          )}

          {/* Load Dataset Option */}
          <button
            onClick={() => setView('dataset')}
            className="w-full p-4 border-2 border-[var(--vscode-widget-border)] rounded-lg hover:border-[var(--vscode-focusBorder)] hover:bg-[var(--vscode-list-hoverBackground)] transition-colors text-center"
          >
            <div className="text-lg font-medium text-[var(--vscode-foreground)]">
              Load Dataset
            </div>
          </button>

          {/* Load Checkpoint Option */}
          <button
            onClick={() => setView('checkpoint')}
            className="w-full p-4 border-2 border-[var(--vscode-widget-border)] rounded-lg hover:border-[var(--vscode-focusBorder)] hover:bg-[var(--vscode-list-hoverBackground)] transition-colors text-center"
          >
            <div className="text-lg font-medium text-[var(--vscode-foreground)]">
              Load Checkpoint
            </div>
          </button>

          {/* Reset Study UI State (only visible in study mode) */}
          {FeatureFlags.STUDY_MODE_ENABLED && StudyConfigurationService.isStudyMode() && (
            <button
              onClick={() => {
                try {
                  StudyConfigurationService.getInstance().resetConfiguration();
                  // Also tell the extension to reset and emit study:ended so App shows participant input
                  try { messageService.sendMessage('study:reset'); } catch {}
                  setResetNotice('Study UI state has been reset.');
                } catch (e) {
                  console.error('Failed to reset study UI state', e);
                  setResetNotice('Failed to reset study UI state');
                }
              }}
              className="w-full p-3 border border-[var(--vscode-widget-border)] rounded-lg hover:bg-[var(--vscode-list-hoverBackground)] transition-colors text-center text-[var(--vscode-descriptionForeground)]"
            >
              Reset Study UI State
            </button>
          )}
          {resetNotice && (
            <div className="text-xs text-[var(--vscode-descriptionForeground)] text-center">{resetNotice}</div>
          )}
        </div>
      </div>
    </div>
  );
};
