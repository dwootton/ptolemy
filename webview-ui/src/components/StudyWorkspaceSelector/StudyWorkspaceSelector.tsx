import React, { useEffect, useMemo, useState } from 'react';
import { MessageService } from '../../services/MessageService';

type Condition = 'Map' | 'Tree' | 'Canvas';
type Dataset = 'vehicles' | 'diamonds' | 'listings' | 'cars' | 'houses';

interface StudyStage {
  stageType?: 'task' | 'survey' | 'review';
  participantId: number;
  datasetSlug: Dataset;
  conditionCode: Condition;
  workspacePath: string;
}

interface StudyConfigResult {
  success: boolean;
  config?: {
    stages: StudyStage[];
    isCompleted?: boolean;
  };
}

export const StudyWorkspaceSelector: React.FC = () => {
  const [stages, setStages] = useState<StudyStage[]>([]);
  const [loading, setLoading] = useState(true);
  const [isCompleted, setIsCompleted] = useState<boolean>(false);
  const [resetting, setResetting] = useState<boolean>(false);
  const [resetMsg, setResetMsg] = useState<string | null>(null);

  useEffect(() => {
    const msg = MessageService.getInstance();
    const unsubscribe = msg.onMessage('study:current-config:result', (data: StudyConfigResult) => {
      if (data?.success && data?.config?.stages) {
        const tasks = data.config.stages.filter(s => !s.stageType || s.stageType === 'task');
        setStages(tasks.slice(0, 3));
        setIsCompleted(!!data.config.isCompleted);
      }
      setLoading(false);
      unsubscribe();
    });
    msg.sendMessage('study:get-current-config');
  }, []);

  const title = useMemo(() => (isCompleted ? 'Thanks for completing the study!' : 'Past Study Workspaces'), [isCompleted]);

  const handleOpen = (path: string) => {
    const msg = MessageService.getInstance();
    msg.sendMessage('workspace:switch', { path });
  };

  const handleResetStudy = async () => {
    if (resetting) return;
    setResetting(true);
    setResetMsg(null);
    try {
      const msg = MessageService.getInstance();
      await msg.sendMessage('study:reset');
      setResetMsg('Study state reset.');
    } catch (e) {
      setResetMsg('Failed to reset study state');
    } finally {
      setResetting(false);
    }
  };

  const labelFor = (d: Dataset) => ({ vehicles: 'Vehicles', diamonds: 'Diamonds', listings: 'Listings', cars: 'Cars', houses: 'Houses' } as const)[d] || d;

  return (
    <div className="flex flex-col items-center justify-center h-full w-full p-8 bg-[var(--vscode-editor-background)]">
      <div className="max-w-md w-full space-y-4">
        <div className="text-center space-y-2">
          {isCompleted && (
            <div className="flex items-center justify-center">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6L9 17l-5-5" />
              </svg>
            </div>
          )}
          <h2 className="text-xl font-semibold text-[var(--vscode-foreground)]">{title}</h2>
          <p className="text-xs text-[var(--vscode-descriptionForeground)]">
            {isCompleted ? 'You can revisit any of your study workspaces below.' : 'Select a previous workspace to revisit your state'}
          </p>
        </div>
        <div className="border border-[var(--vscode-widget-border)] rounded-md divide-y divide-[var(--vscode-widget-border)]">
          {loading && (
            <div className="px-3 py-2 text-xs text-[var(--vscode-descriptionForeground)]">Loading…</div>
          )}
          {!loading && stages.length === 0 && (
            <div className="px-3 py-2 text-xs text-[var(--vscode-descriptionForeground)]">No study workspaces found</div>
          )}
          {!loading && stages.map((s, idx) => (
            <button
              key={`${s.workspacePath}-${idx}`}
              onClick={() => handleOpen(s.workspacePath)}
              className="w-full text-left px-3 py-2 hover:bg-[var(--vscode-list-hoverBackground)]"
              title={s.workspacePath}
            >
              <div className="flex items-center justify-between">
                <span><span role="img" aria-label="folder">📁</span> {labelFor(s.datasetSlug)} · {s.conditionCode}</span>
                <span className="text-xs text-[var(--vscode-descriptionForeground)] truncate max-w-[50%]">{s.workspacePath}</span>
              </div>
            </button>
          ))}
        </div>
        {isCompleted && (
          <div className="flex items-center justify-between">
            <button
              onClick={handleResetStudy}
              disabled={resetting}
              className="px-3 py-2 rounded bg-[var(--vscode-button-background)] text-[var(--vscode-button-foreground)] hover:bg-[var(--vscode-button-hoverBackground)] text-xs"
            >
              {resetting ? 'Resetting…' : 'Reset Study State'}
            </button>
            {resetMsg && (
              <div className="text-xs text-[var(--vscode-descriptionForeground)]">{resetMsg}</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
