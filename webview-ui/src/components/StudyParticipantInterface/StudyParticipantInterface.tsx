import React, { useState, useEffect } from 'react';
import { StudyConfigurationService } from '../../services/StudyConfigurationService';
import { MessageService } from '../../services/MessageService';

interface StudyParticipantInterfaceProps {
  onParticipantConfigured: (participantId: number) => void;
}

export const StudyParticipantInterface: React.FC<StudyParticipantInterfaceProps> = ({ 
  onParticipantConfigured 
}) => {
  const [participantId, setParticipantId] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [isConfiguring, setIsConfiguring] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const studyService = StudyConfigurationService.getInstance();
  const messageService = MessageService.getInstance();

  // Load participant ID from workspace on mount
  useEffect(() => {
    const loadParticipantId = async () => {
      try {
        messageService.sendMessage('load-participant-id', {});
        
        const handleParticipantIdLoaded = (data: any) => {
          if (data.success && data.participantId) {
            setParticipantId(data.participantId.toString());
            // Auto-configure if participant ID was previously saved
            setTimeout(() => {
              handleSubmit(new Event('submit') as any);
            }, 500);
          }
          setIsLoading(false);
        };
        
        messageService.onMessage('participant-id-loaded', handleParticipantIdLoaded);
        
        // Cleanup listener after 5 seconds
        setTimeout(() => {
          messageService.offMessage('participant-id-loaded', handleParticipantIdLoaded);
          setIsLoading(false);
        }, 5000);
        
      } catch (error) {
        console.warn('Failed to load participant ID:', error);
        setIsLoading(false);
      }
    };
    
    loadParticipantId();
  }, []);

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setError('');
    setIsConfiguring(true);

    try {
      const id = parseInt(participantId, 10);
      
      if (isNaN(id) || id < 1) {
        throw new Error('Please enter a valid participant ID (must be a positive number)');
      }

      const config = studyService.configureParticipant(id);
      if (!config) {
        throw new Error('Failed to configure participant');
      }

      // Save participant ID to workspace and notify extension of study context
      try {
        // Save participant ID for future sessions
        messageService.sendMessage('save-participant-id', { participantId: id });
        
        // Update study context for dataset-specific routing
        messageService.sendMessage('study-context-update', {
          isStudyMode: StudyConfigurationService.isStudyMode(),
          participantId: config.participantId,
          datasetSlug: config.currentDatasetSlug,
          conditionCode: config.currentConditionCode
        });
      } catch {}

      // Brief delay to show the configuration details
      setTimeout(() => {
        onParticipantConfigured(id);
      }, 1500);

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Configuration failed');
      setIsConfiguring(false);
    }
  };

  const handleSelectParticipant = (id: number) => {
    setParticipantId(String(id));
    setError('');
    setTimeout(() => handleSubmit(), 0);
  };

  if (isLoading) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-[var(--vscode-editor-background)]">
        <div className="max-w-md w-full p-8 bg-[var(--vscode-editorWidget-background)] rounded-lg border border-[var(--vscode-editorWidget-border)] shadow-lg">
          <div className="text-center">
            <div className="mb-4">
              <div className="w-12 h-12 border-2 border-[var(--vscode-progressBar-background)] border-t-[var(--vscode-progressBar-foreground)] rounded-full animate-spin mx-auto"></div>
            </div>
            <h2 className="text-xl font-semibold text-[var(--vscode-foreground)] mb-2">
              Loading Study Session
            </h2>
            <p className="text-sm text-[var(--vscode-descriptionForeground)]">
              Checking for saved participant configuration...
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (isConfiguring) {
    const info = studyService.getParticipantMapping(parseInt(participantId, 10));
    return (
      <div className="h-full w-full flex items-center justify-center bg-[var(--vscode-editor-background)]">
        <div className="max-w-md w-full p-8 bg-[var(--vscode-editorWidget-background)] rounded-lg border border-[var(--vscode-editorWidget-border)] shadow-lg">
          <div className="text-center">
            <div className="mb-4">
              <div className="w-12 h-12 border-2 border-[var(--vscode-progressBar-background)] border-t-[var(--vscode-progressBar-foreground)] rounded-full animate-spin mx-auto"></div>
            </div>
            <h2 className="text-xl font-semibold text-[var(--vscode-foreground)] mb-2">
              Configuring Study Session
            </h2>
            <p className="text-[var(--vscode-descriptionForeground)] mb-4">
              Participant P{participantId}
            </p>
            {info && (
              <div className="bg-[var(--vscode-editor-background)] p-4 rounded border text-left">
                <div className="text-sm">
                  <div className="mb-2">
                    <span className="font-medium text-[var(--vscode-foreground)]">Condition Order:</span>
                    <span className="ml-2 text-[var(--vscode-descriptionForeground)] font-mono">
                      {info.conditionOrder}
                    </span>
                  </div>
                  <div>
                    <span className="font-medium text-[var(--vscode-foreground)]">Dataset Order:</span>
                    <span className="ml-2 text-[var(--vscode-descriptionForeground)] font-mono">
                      {info.datasetOrder}
                    </span>
                  </div>
                </div>
              </div>
            )}
            <p className="text-sm text-[var(--vscode-descriptionForeground)] mt-4">
              Loading study configuration...
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full w-full flex items-center justify-center bg-[var(--vscode-editor-background)]">
      <div className="max-w-md w-full p-8 bg-[var(--vscode-editorWidget-background)] rounded-lg border border-[var(--vscode-editorWidget-border)] shadow-lg">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold text-[var(--vscode-foreground)] mb-2">
            Select Participant
          </h1>
          <p className="text-[var(--vscode-descriptionForeground)]">
            Choose a participant to begin the study session
          </p>
        </div>

        {error && (
          <div className="bg-[var(--vscode-errorBackground)] border border-[var(--vscode-errorBorder)] text-[var(--vscode-errorForeground)] px-4 py-3 rounded mb-4">
            <p className="text-sm">{error}</p>
          </div>
        )}

        <div className="grid grid-cols-3 gap-2">
          {Array.from({ length: 15 }, (_, i) => i + 1).map((p) => (
            <button
              key={p}
              disabled={isConfiguring}
              onClick={() => handleSelectParticipant(p)}
              className="px-3 py-2 rounded bg-[var(--vscode-button-background)] text-[var(--vscode-button-foreground)] hover:bg-[var(--vscode-button-hoverBackground)] text-sm"
              aria-label={`Select participant P${p}`}
            >
              P{p}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
