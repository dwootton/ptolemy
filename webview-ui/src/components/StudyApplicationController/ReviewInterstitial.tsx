import React, { useMemo } from 'react';
import { MessageService } from '../../services/MessageService';
import { studySurveyUrl } from '../../utilities/studySurveyUrl';

export interface ReviewInterstitialProps {
  participantId: number | string;
  participantLabel?: string | null;
  admin?: boolean;
  stageIndex?: number;
  totalStages?: number;
}

export const ReviewInterstitial: React.FC<ReviewInterstitialProps> = ({ participantId, participantLabel, admin, stageIndex, totalStages }) => {
  const messageService = MessageService.getInstance();

  const participantIdStr = useMemo(() => {
    const base = (participantLabel && String(participantLabel).trim().length > 0)
      ? String(participantLabel).trim()
      : (typeof participantId === 'number' ? `P${participantId}` : String(participantId).trim());
    return base;
  }, [participantId, participantLabel]);

  const url = useMemo(() => {
    const params = new URLSearchParams();
    params.set('type', 'Results');
    params.set('participantId', participantIdStr);
    if (admin) params.set('admin', '1');
    return studySurveyUrl(import.meta.env.VITE_STUDY_SURVEY_URL, Object.fromEntries(params));
  }, [participantIdStr, admin]);

  const handleNext = () => {
    const nextIndex = typeof stageIndex === 'number' ? stageIndex + 1 : undefined;
    if (typeof nextIndex === 'number' && typeof totalStages === 'number' && nextIndex < totalStages) {
      console.log('[StudyNext] interstitial:review next-click (goto)', { from: stageIndex, to: nextIndex, total: totalStages });
      const t0 = performance.now();
      const unsubscribe = messageService.onMessage('study:goto-stage:result', (data: any) => {
        unsubscribe();
        const t1 = performance.now();
        console.log('[StudyNext] interstitial:review goto result', { ok: !!data?.success, durationMs: Math.round(t1 - t0) });
      });
      messageService.sendMessage('study:goto-stage', { index: nextIndex });
    } else {
      console.log('[StudyNext] interstitial:review next-click (advance)', { participantId: participantIdStr, admin: !!admin });
      const t0 = performance.now();
      const unsubscribe = messageService.onMessage('study:advance-stage:result', (data: any) => {
        unsubscribe();
        const t1 = performance.now();
        console.log('[StudyNext] interstitial:review advance result', {
          ok: !!data?.success,
          completed: !!data?.completed,
          hasError: !!data?.error,
          durationMs: Math.round(t1 - t0),
          msg: data?.message,
        });
      });
      // Advancing from review completes the study
      messageService.sendMessage('study:advance-stage');
    }
  };

  const handleBack = () => {
    if (typeof stageIndex !== 'number') return;
    const prevIndex = stageIndex - 1;
    if (prevIndex < 0) return;
    console.log('[StudyNext] interstitial:review back-click', { from: stageIndex, to: prevIndex, total: totalStages });
    const t0 = performance.now();
    const unsubscribe = messageService.onMessage('study:goto-stage:result', (data: any) => {
      unsubscribe();
      const t1 = performance.now();
      console.log('[StudyNext] interstitial:review back goto result', { ok: !!data?.success, durationMs: Math.round(t1 - t0) });
    });
    messageService.sendMessage('study:goto-stage', { index: prevIndex });
  };

  return (
    <div className="w-full h-full flex items-center justify-center">
      <div className="max-w-xl w-full p-6 rounded-md border border-[var(--vscode-dropdown-border)] bg-[var(--vscode-editor-background)] text-[var(--vscode-foreground)] shadow">
        <h2 className="text-lg font-semibold mb-2">Review Responses</h2>
        <p className="text-sm mb-4">
          Open the responses view for this participant.
        </p>
        {url ? <>
        <a href={url} target="_blank" rel="noopener noreferrer" className="inline-block mb-4 underline text-[var(--vscode-textLink-foreground)]">
          Open Responses Viewer
        </a>
        <div className="text-xs mb-4 break-all opacity-80">{url}</div>
        </> : <p className="text-sm mb-4">No study survey is configured.</p>}
        <div className="flex gap-2">
          <button onClick={handleBack} disabled={typeof stageIndex !== 'number' || stageIndex <= 0} className="px-3 py-1 rounded bg-[var(--vscode-button-background)] text-[var(--vscode-button-foreground)] hover:bg-[var(--vscode-button-hoverBackground)] disabled:opacity-50">
            Back
          </button>
          <button onClick={handleNext} disabled={typeof stageIndex !== 'number' || typeof totalStages !== 'number' || stageIndex >= (totalStages - 1)} className="px-3 py-1 rounded bg-[var(--vscode-button-background)] text-[var(--vscode-button-foreground)] hover:bg-[var(--vscode-button-hoverBackground)] disabled:opacity-50">
            Next
          </button>
        </div>
      </div>
    </div>
  );
};
