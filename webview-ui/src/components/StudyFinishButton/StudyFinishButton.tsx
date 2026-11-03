import React, { useState } from 'react';
import { MessageService } from '../../services/MessageService';
import { StudyConfigurationService } from '../../services/StudyConfigurationService';

interface StudyFinishButtonProps {
  onConditionFinished?: () => void;
  condition?: 'Map' | 'Tree' | 'Canvas';
  dataset?: 'vehicles' | 'diamonds' | 'listings' | 'cars' | 'houses';
}

export const StudyFinishButton: React.FC<StudyFinishButtonProps> = ({
  onConditionFinished,
  condition,
  dataset
}) => {
  const [isFinishing, setIsFinishing] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);

  const studyService = StudyConfigurationService.getInstance();
  const messageService = MessageService.getInstance();

  const currentCondition = condition || studyService.getCurrentConditionCode();
  const currentDataset = dataset || studyService.getCurrentDatasetSlug();

  const handleFinishClick = () => {
    setShowConfirmation(true);
  };

  const handleConfirmFinish = async () => {
    setIsFinishing(true);
    setShowConfirmation(false);
    try {
      // Use the new study application controller system
      const result = await new Promise<any>((resolve) => {
        const unsubscribe = messageService.onMessage('study:advance-stage:result', (payload: any) => {
          unsubscribe();
          resolve(payload);
        });
        // Send advance stage message (replaces the old finish-condition message)
        messageService.sendMessage('study:advance-stage');
      });

      if (result.success) {
        if (result.completed) {
          alert('Congratulations! You have completed the entire study.');
        }
        onConditionFinished?.();
      } else {
        console.error('[flow-debug][webview] Failed to advance stage:', result.error);
        alert(`Failed to advance to next stage: ${result.error}`);
      }

    } catch (error) {
      console.error('[flow-debug][webview] Failed to finish condition:', error);
      alert('Failed to finish condition. Please try again.');
    } finally {
      setIsFinishing(false);
    }
  };

  const handleCancelFinish = () => {
    setShowConfirmation(false);
  };

  if (showConfirmation) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-[var(--vscode-editorWidget-background)] border border-[var(--vscode-editorWidget-border)] rounded-lg p-6 max-w-md w-full mx-4">
          <h3 className="text-lg font-semibold text-[var(--vscode-foreground)] mb-4">
            Finish Current Condition
          </h3>
          <p className="text-[var(--vscode-descriptionForeground)] mb-6">
            Are you sure you want to finish the current condition ({currentCondition}) for dataset {currentDataset}?
            This will save your progress and advance to the next phase of the study.
          </p>
          <div className="flex gap-3 justify-end">
            <button
              onClick={handleCancelFinish}
              className="px-4 py-2 bg-[var(--vscode-button-secondaryBackground)] text-[var(--vscode-button-secondaryForeground)] hover:bg-[var(--vscode-button-secondaryHoverBackground)] rounded transition-colors"
              disabled={isFinishing}
            >
              Cancel
            </button>
            <button
              onClick={handleConfirmFinish}
              className="px-4 py-2 bg-[var(--vscode-button-background)] text-[var(--vscode-button-foreground)] hover:bg-[var(--vscode-button-hoverBackground)] rounded transition-colors"
              disabled={isFinishing}
            >
              {isFinishing ? 'Finishing...' : 'Finish Condition'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <button
      onClick={handleFinishClick}
      disabled={isFinishing}
      className="inline-flex items-center gap-2 px-3 py-1.5 bg-[var(--vscode-button-background)] text-[var(--vscode-button-foreground)] hover:bg-[var(--vscode-button-hoverBackground)] disabled:opacity-50 rounded text-sm transition-colors"
      title="Finish current study condition and advance to next phase"
    >
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      {isFinishing ? 'Finishing...' : 'Finish Condition'}
    </button>
  );
};
