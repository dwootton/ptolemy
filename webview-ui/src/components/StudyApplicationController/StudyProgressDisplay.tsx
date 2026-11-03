import React, { useState, useEffect } from 'react';
import { MessageService } from '../../services/MessageService';
import './StudyProgressDisplay.css';

export interface StudyStage {
  id: string;
  stageType?: 'task' | 'survey' | 'review';
  participantId: number;
  datasetSlug: 'vehicles' | 'diamonds' | 'listings' | 'cars' | 'houses';
  conditionCode: 'Map' | 'Tree' | 'Canvas';
  workspacePath: string;
  checkpointPath?: string;
  instrumentationEnabled: boolean;
  stageIndex: number;
  totalStages: number;
}

export interface StudyProgressInfo {
  currentStage: number;
  totalStages: number;
  isCompleted: boolean;
}

export interface StudyProgressDisplayProps {
  onFinishCondition?: () => void;
  onResetStudy?: () => void;
  className?: string;
}

export const StudyProgressDisplay: React.FC<StudyProgressDisplayProps> = ({
  onFinishCondition,
  onResetStudy,
  className
}) => {
  const [studyInfo, setStudyInfo] = useState<StudyProgressInfo | null>(null);
  const [currentStage, setCurrentStage] = useState<StudyStage | null>(null);
  const [isActive, setIsActive] = useState(false);
  const [isFinishing, setIsFinishing] = useState(false);
  const [isNextLoading, setIsNextLoading] = useState(false);
  const [isBackLoading, setIsBackLoading] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  
  const messageService = MessageService.getInstance();

  // Load initial study state
  useEffect(() => {
    loadStudyInfo();
    
    // Listen for study updates
    const unsubscribers = [
      messageService.onMessage('study:stage-changed', handleStageChanged),
      messageService.onMessage('study:condition-changed', handleConditionChanged),
      messageService.onMessage('study:ended', handleStudyEnded)
    ];

    return () => {
      unsubscribers.forEach(unsub => unsub());
    };
  }, []);

  const loadStudyInfo = async () => {
    try {
      // Get current study configuration
      const configResult = await new Promise<any>((resolve) => {
        const unsubscribe = messageService.onMessage('study:current-config:result', (data: any) => {
          unsubscribe();
          resolve(data);
        });
        messageService.sendMessage('study:get-current-config');
      });

      if (configResult.success && configResult.config) {
        setStudyInfo(configResult.progress);
        setCurrentStage(configResult.currentStage);
        setIsActive(configResult.isActive);
      } else {
        // No active study
        setStudyInfo(null);
        setCurrentStage(null);
        setIsActive(false);
      }
    } catch (error) {
      console.error('Failed to load study info:', error);
    }
  };

  const handleStageChanged = (message: any) => {
    setCurrentStage(message.data.stage);
    setStudyInfo(message.data.progress);
    setIsActive(true);
  };

  const handleConditionChanged = (_message: any) => {
    // Reload study info to get updated state
    loadStudyInfo();
  };

  const handleStudyEnded = (_message: any) => {
    setStudyInfo(null);
    setCurrentStage(null);
    setIsActive(false);
  };

  const handleFinishCondition = async () => {
    if (!isActive || isFinishing) return;

    setIsFinishing(true);

    try {
      const result = await new Promise<any>((resolve) => {
        const unsubscribe = messageService.onMessage('study:advance-stage:result', (data: any) => {
          unsubscribe();
          resolve(data);
        });
        messageService.sendMessage('study:advance-stage');
      });

      if (result.success) {
        if (result.completed) {
          // Study completed
          onFinishCondition?.();
        } else {
          // Advanced to next stage
          onFinishCondition?.();
        }
      } else {
        console.error('Failed to advance stage:', result.error);
      }
    } catch (error) {
      console.error('Failed to finish condition:', error);
    } finally {
      setIsFinishing(false);
    }
  };

  const handleResetStudy = async () => {
    if (!window.confirm('Are you sure you want to reset the current study session?')) {
      return;
    }

    try {
      const result = await new Promise<any>((resolve) => {
        const unsubscribe = messageService.onMessage('study:reset:result', (data: any) => {
          unsubscribe();
          resolve(data);
        });
        messageService.sendMessage('study:reset');
      });

      if (result.success) {
        onResetStudy?.();
      } else {
        console.error('Failed to reset study:', result.error);
      }
    } catch (error) {
      console.error('Failed to reset study:', error);
    }
  };

  const handleGotoStage = async (index: number) => {
    try {
      console.log('[StudyNext] goto-stage: sending request', {
        fromIndex: currentStage?.stageIndex,
        toIndex: index,
        total: currentStage?.totalStages,
        dataset: currentStage?.datasetSlug,
        condition: currentStage?.conditionCode,
      });
      const t0 = performance.now();
      const result = await new Promise<any>((resolve) => {
        const unsubscribe = messageService.onMessage('study:goto-stage:result', (data: any) => {
          unsubscribe();
          resolve(data);
        });
        messageService.sendMessage('study:goto-stage', { index });
      });
      const t1 = performance.now();
      console.log('[StudyNext] goto-stage: result received', {
        ok: !!result?.success,
        hasError: !!result?.error,
        durationMs: Math.round(t1 - t0),
        stageIndex: result?.stage?.stageIndex,
        dataset: result?.stage?.datasetSlug,
        condition: result?.stage?.conditionCode,
      });
      if (!result?.success) {
        console.error('Failed to navigate to stage:', result?.error);
      }
    } catch (error) {
      console.error('Failed to navigate to stage:', error);
    }
  };

  const handleNext = async () => {
    if (!currentStage || isNextLoading) return;
    const nextIndex = (currentStage.stageIndex ?? 0) + 1;
    if (currentStage.totalStages != null && nextIndex >= currentStage.totalStages) return;
    console.log('[StudyNext] next-click', {
      fromIndex: currentStage.stageIndex,
      toIndex: nextIndex,
      total: currentStage.totalStages,
      dataset: currentStage.datasetSlug,
      condition: currentStage.conditionCode,
    });
    setIsNextLoading(true);
    const t0 = performance.now();
    await handleGotoStage(nextIndex);
    const t1 = performance.now();
    console.log('[StudyNext] next-complete', { durationMs: Math.round(t1 - t0) });
    setIsNextLoading(false);
  };

  const handleBack = async () => {
    if (!currentStage || isBackLoading) return;
    const prevIndex = (currentStage.stageIndex ?? 0) - 1;
    if (prevIndex < 0) return;
    setIsBackLoading(true);
    await handleGotoStage(prevIndex);
    setIsBackLoading(false);
  };

  const getDatasetDisplayName = (slug: 'vehicles' | 'diamonds' | 'listings' | 'cars' | 'houses'): string => {
    const names = {
      vehicles: 'Vehicles',
      diamonds: 'Diamonds',
      listings: 'Listings',
      cars: 'Cars', 
      houses: 'Houses'
    };
    return names[slug] || slug;
  };

  const getConditionDisplayName = (code: 'Map' | 'Tree' | 'Canvas'): string => {
    return code;
  };

  // Don't render if no active study
  if (!isActive || !studyInfo || !currentStage) {
    return null;
  }

  const progress = studyInfo;
  const stage = currentStage;

  return (
    <div className={`study-progress-display ${className || ''}`}>
      <div className="study-progress-display__main">
        <div className="study-progress-display__header">
          <div className="study-progress-display__title">
            Study Progress
          </div>
          <div className="study-progress-display__stage">
            Stage {progress.currentStage} of {progress.totalStages}
          </div>
        </div>

        <div className="study-progress-display__progress">
          <div className="study-progress-display__progress-bar">
            <div 
              className="study-progress-display__progress-fill"
              style={{
                width: `${(progress.currentStage / progress.totalStages) * 100}%`
              }}
            />
          </div>
          <div className="study-progress-display__progress-text">
            {Math.round((progress.currentStage / progress.totalStages) * 100)}% Complete
          </div>
        </div>

        <div className="study-progress-display__current">
          <div className="study-progress-display__dataset">
            Dataset: <strong>{getDatasetDisplayName(stage.datasetSlug)}</strong>
          </div>
          <div className="study-progress-display__condition">
            Condition: <strong>{getConditionDisplayName(stage.conditionCode)}</strong>
          </div>
        </div>

        <div className="study-progress-display__actions">
          <button
            className="study-progress-display__nav-btn"
            onClick={handleBack}
            disabled={isBackLoading || (stage.stageIndex <= 0)}
            title={stage.stageIndex <= 0 ? 'Already at first stage' : 'Go to previous stage'}
          >
            {isBackLoading && <div className="spinner" />}
            Back
          </button>

          <button
            className="study-progress-display__nav-btn primary"
            onClick={handleNext}
            disabled={isNextLoading || (stage.stageIndex >= stage.totalStages - 1)}
            title={stage.stageIndex >= stage.totalStages - 1 ? 'Already at last stage' : 'Go to next stage'}
          >
            {isNextLoading && <div className="spinner" />}
            Next
          </button>

          <button
            className="study-progress-display__finish-btn"
            onClick={handleFinishCondition}
            disabled={isFinishing}
          >
            {isFinishing ? (
              <>
                <div className="spinner" />
                Advancing...
              </>
            ) : (
              'Finish Condition'
            )}
          </button>
          
          <button
            className="study-progress-display__details-btn"
            onClick={() => setShowDetails(!showDetails)}
          >
            {showDetails ? 'Hide Details' : 'Show Details'}
          </button>
        </div>

        {showDetails && (
          <div className="study-progress-display__details">
            <h4>Current Stage Details</h4>
            <div className="study-progress-display__detail-item">
              <span>Participant ID:</span>
              <span>{stage.participantId}</span>
            </div>
            <div className="study-progress-display__detail-item">
              <span>Stage Index:</span>
              <span>{stage.stageIndex + 1}</span>
            </div>
            <div className="study-progress-display__detail-item">
              <span>Workspace:</span>
              <span className="study-progress-display__path">{stage.workspacePath}</span>
            </div>
            {stage.checkpointPath && (
              <div className="study-progress-display__detail-item">
                <span>Checkpoint:</span>
                <span className="study-progress-display__path">{stage.checkpointPath}</span>
              </div>
            )}
            <div className="study-progress-display__detail-item">
              <span>Instrumentation:</span>
              <span className={`study-progress-display__status ${stage.instrumentationEnabled ? 'enabled' : 'disabled'}`}>
                {stage.instrumentationEnabled ? 'Enabled' : 'Disabled'}
              </span>
            </div>
            
            <div className="study-progress-display__admin-actions">
              <button
                className="study-progress-display__reset-btn"
                onClick={handleResetStudy}
              >
                Reset Study
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
