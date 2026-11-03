import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { AnalysisMapSection } from "./components/AnalysisMapSection";
import { DatasetLoader, DatasetInfo, DatasetViewer, DatasetProfile } from "./components/DatasetLoader";
import { NewAnalysisList } from "./components/NewAnalysisList";
import { SettingsButton } from "./components/SettingsButton";
// import { FilterBar } from "./components/FilterBar";
// Removed CheckpointManager in baseline system
import { NotebookSyncButton } from "./components/NotebookSyncButton";
import { InitialLoadScreen } from "./components/InitialLoadScreen";
import { SidebarSkeleton } from "./components/SidebarSkeleton";
import { StudyParticipantInterface } from "./components/StudyParticipantInterface";
import { StudyConfigurationService } from "./services/StudyConfigurationService";
import { FeatureFlags } from "./utils/featureFlags";

// Conditionally import study components only in study builds
import { StudyFinishButton, StudyParticipantInput, StudyProgressDisplay } from "./components/StudyComponents";
import { SurveyInterstitial } from "./components/StudyApplicationController/SurveyInterstitial";
import { ReviewInterstitial } from "./components/StudyApplicationController/ReviewInterstitial";
import { StudyWorkspaceSelector } from "./components/StudyWorkspaceSelector/StudyWorkspaceSelector";
import { MapNoteEditor } from "./components/NoteEditor/MapNoteEditor";
import { StateService } from "./services/StateService";
import { MessageService } from "./services/MessageService";
import { ConstraintService } from "./services/ConstraintService";
import { AnaletStateService } from "./services/AnaletStateService";
import { TelemetryService } from "./services/TelemetryService";
// RRwebRecorder removed - now using TelemetryService for RRWeb recording
import { Analet } from "./types/analet";
import { useAnalysisComponents } from "./hooks/useAnalysisComponents";
import { useAnaletLoader } from "./hooks/useAnaletLoader";
import { useSharedSelection } from "./hooks/useSharedSelection";
import { useSessionState } from "./hooks/useSessionState";
// import { ConceptualStatements } from "./components/ConceptualStatements/ConceptualStatements";
  // Skeleton for list is handled inside NewAnalysisList via isLoading
import { MessagingBridge } from "./components/MessagingBridge";
import { PurgeController } from "./components/bridge/PurgeController";
// import { useDatasetDataForStatements } from "./hooks/data/useDatasetDataForStatements";
import { computeMortonOrder, sortAnaletsByOrder } from "./utilities/spatialOrdering";
import { useAnimatedDots } from "./hooks/useAnimatedDots";
// Eagerly initialize bearing metrics detection (drag-drop -> semantic jump)
import './services/BearingMetricsService';


  const App = () => {
    // Check if we're in study mode (only relevant if study features are enabled)
    const isStudyMode = FeatureFlags.STUDY_MODE_ENABLED && StudyConfigurationService.isStudyMode();
    const studyService = StudyConfigurationService.getInstance();

    // Study-specific state (only relevant if study features are enabled)
    const [showStudyInterface, setShowStudyInterface] = useState(false);

    // New study application controller state (only relevant if study features are enabled)
    const [showStudyParticipantInput, setShowStudyParticipantInput] = useState(false);
    const [hasActiveStudy, setHasActiveStudy] = useState(false);
    const [currentStudyStage, setCurrentStudyStage] = useState<any | null>(null);
    const [showStudyWorkspaceSelector, setShowStudyWorkspaceSelector] = useState(false);

    // Session state management for extension navigation persistence (used for dataset info, selections, etc.)
    const sessionState = useSessionState();

    // testing: log flags and initial state
    useEffect(() => {
    }, []);

    const stateService = StateService.getInstance();
    // Removed onMessage usage in favor of useNotebookSelectionSync hook
  const constraintService = ConstraintService.getInstance();
  const [hasDataset, setHasDataset] = useState(stateService.getHasDataset());
  const [datasetInfo, setDatasetInfo] = useState(stateService.getDatasetInfo());
  const [isRestoringDataset, setIsRestoringDataset] = useState(true); // Start with restoration in progress
  const [restorationComplete, setRestorationComplete] = useState(false);
  const [isInitialLoad, setIsInitialLoad] = useState(false); // Track if we're in initial load mode
  const [isLoadingFramingAnalets, setIsLoadingFramingAnalets] = useState(false); // Track framing analet generation
  const [, setForceProjectionUpdate] = useState(0); // Force re-projection after drag
  const [selectedFolderName, setSelectedFolderName] = useState<string | null>(() => {
    // Initialize from persisted state
    const persistedState = stateService.loadPersistedState();
    return persistedState.selectedFolderName;
  }); // Track selected folder
  const [clusterFolderState, setClusterFolderState] = useState<{
    isLoading: boolean;
    progress: string | null;
  }>({ isLoading: false, progress: null });

  const [datasetProfile, setDatasetProfile] = useState<DatasetProfile | null>(null);
  // One-time refresh button for map condition to set similarity alpha to 0.5
  const [showAlphaRefresh, setShowAlphaRefresh] = useState<boolean>(false);
  // Global filter state (disabled)
  // const [filterText, setFilterText] = useState<string>("");
  // const [hideUnexplored, setHideUnexplored] = useState<boolean>(false);
  const filterText: string = "";
  const hideUnexplored: boolean = false;
  // Setters unused while filter UI disabled


  // Auto-tracking state (lifted from AnalysisMap)
  const [isTrackingEnabled, setIsTrackingEnabled] = useState(true);

  // Grid layout state
  const [gridLayoutEnabled, setGridLayoutEnabled] = useState(stateService.getGridLayoutEnabled());
  const [viewMode, setViewMode] = useState(stateService.getViewMode());

  // Checkpoint manager removed in baseline system

  // Note editing state
  const [isEditingNote, setIsEditingNote] = useState(false);
  const [noteTargetAnalet, setNoteTargetAnalet] = useState<Analet | null>(null);
  const [noteContent, setNoteContent] = useState('');
  const [showStudyProgress, setShowStudyProgress] = useState(false);
  const studyProgressRef = useRef<HTMLDivElement | null>(null);
  const studyProgressBtnRef = useRef<HTMLButtonElement | null>(null);

  // Initialize one-time alpha refresh visibility when entering/exiting Map condition
  useEffect(() => {
    try {
      const inMapCondition = (!gridLayoutEnabled) && FeatureFlags.STUDY_MODE_ENABLED && hasActiveStudy && currentStudyStage?.conditionCode === 'Map';
      if (inMapCondition) {
        const dismissed = localStorage.getItem('alpha_refresh_dismissed') === '1';
        setShowAlphaRefresh(!dismissed);
      } else {
        setShowAlphaRefresh(false);
      }
    } catch {
      // default no-op
    }
  }, [gridLayoutEnabled, hasActiveStudy, currentStudyStage]);

  // testing helper to log in render paths
  const logRender = useCallback((_msg: string) => { return null; }, []);
  const dots = useAnimatedDots(400, 3);

  useEffect(() => {
    // Removed selectedFolderName persistence - handled in separate useEffect

    // Set up message service and handlers
    const messageService = MessageService.getInstance();

    // Initialize telemetry services
    const telemetryService = TelemetryService.getInstance();

    // Check for active study session on component mount (only if study features are enabled)
    const checkActiveStudy = async () => {
      if (!FeatureFlags.STUDY_MODE_ENABLED) {
        return; // Skip study checks if study mode is not enabled
      }

      try {
        // First check if there's restore info available
        const restoreInfoResult = await new Promise<any>((resolve) => {
          const unsubscribe = messageService.onMessage('study:restore-info:result', (data: any) => {
            unsubscribe();
            resolve(data);
          });
          messageService.sendMessage('study:get-restore-info');
        });
        if (restoreInfoResult.success && restoreInfoResult.restoreInfo && restoreInfoResult.restoreInfo.canRestore) {
          // Attempt automatic restoration
          const restoreResult = await new Promise<any>((resolve) => {
            const unsubscribe = messageService.onMessage('study:restore-session:result', (data: any) => {
              unsubscribe();
              resolve(data);
            });
            messageService.sendMessage('study:restore-session');
          });
          if (restoreResult.success) {
            setHasActiveStudy(true);
            setShowStudyParticipantInput(false);
            return; // Exit early on successful restoration
          } else {
            console.warn('Study session restoration failed:', restoreResult.error);
          }
        }

        // If no restoration available or restoration failed, check for active study
        const result = await new Promise<any>((resolve) => {
          const unsubscribe = messageService.onMessage('study:current-config:result', (data: any) => {
            unsubscribe();
            resolve(data);
          });
          messageService.sendMessage('study:get-current-config');
        });
        if (result.success && result.isActive && result.config) {
          setHasActiveStudy(true);
          setShowStudyParticipantInput(false);
          try { setCurrentStudyStage(result.currentStage || null); } catch {}
          try { (window as any).__meridian_participant_label__ = result.config.participantLabel || null; } catch {}
        } else if (isStudyMode) {
          // Show new study input if in study mode but no active study
          setShowStudyParticipantInput(true);
        }
      } catch (error) {
        console.error('Failed to check active study:', error);
        if (isStudyMode) {
          setShowStudyParticipantInput(true);
        }
      }
    };

    checkActiveStudy();

    // Note: RRWeb recording is now controlled via the settings toggle
    // which uses the new instrumentation system in TelemetryService

    // Record page view telemetry
    telemetryService.recordPageView('main_app', {
      hasDataset: hasDataset,
      isRestoringDataset: isRestoringDataset,
      timestamp: Date.now()
    });

    // Handler for successful dataset restoration
    messageService.onMessage('dataset-restored', (data) => {
      try { console.log('[dataset-bug][webview] dataset-restored', { name: data?.dataset?.name, columns: data?.dataset?.columns?.length, enhanced: data?.enhanced }); } catch {}
      if (data.dataset) {
        stateService.setDataset(data.dataset, true); // Skip persistence since it's coming from extension
        setHasDataset(stateService.getHasDataset());
        setDatasetInfo(stateService.getDatasetInfo());
      }

      // Handle dataset profile if available from restoration
      if (data.profile) {
        // Backend now sends in frontend format, no transformation needed
        const profile: DatasetProfile = {
          enhanced: data.enhanced || false,
          columns: data.profile.columns || [],
          quality: data.profile.dataQuality || data.profile.quality || {
            overall: 'good',
            overallScore: 0.8,
            completeness: 1,
            consistency: 1,
            duplicates: 0
          },
          relationships: data.profile.relationships || []
        };
        setDatasetProfile(profile);
      } else {
        try { console.log('[dataset-bug][webview] dataset profile not provided for', data?.dataset?.name); } catch {}
      }

      setIsRestoringDataset(false);
      setIsLoadingFramingAnalets(false);
      setRestorationComplete(true);
    });

    // Handler for extension ready (restoration complete, no dataset found)
    messageService.onMessage('extension-ready', () => {
      if (!restorationComplete) {
        setIsRestoringDataset(false);
        setRestorationComplete(true);
        setIsInitialLoad(true);
      }
    });

    messageService.onMessage('dataset-analysis-complete', (data) => {
      try { console.log('[dataset-bug][webview] dataset-analysis-complete', { ok: data?.success, hasProfile: !!data?.profile, cols: data?.profile?.columns?.length }); } catch {}
      if (data.success) {
        setIsLoadingFramingAnalets(false); // Stop loading framing analets

        if (data.dataset) {
          // Update dataset info if analysis provided dataset data
          stateService.setDataset(data.dataset, true); // Skip persistence since it's coming from extension
          setHasDataset(stateService.getHasDataset());
          setDatasetInfo(stateService.getDatasetInfo());
        } else {
          // Enhanced analysis completed but dataset is already set - just confirm state
          setHasDataset(stateService.getHasDataset());
          setDatasetInfo(stateService.getDatasetInfo());
        }

        // Handle dataset profile if available
        if (data.profile) {
          // Backend now sends in frontend format, no transformation needed
          const profile: DatasetProfile = {
            enhanced: data.enhanced || false,
            columns: data.profile.columns || [],
            quality: data.profile.dataQuality || data.profile.quality || {
              overall: 'good',
              overallScore: 0.8,
              completeness: 1,
              consistency: 1,
              duplicates: 0
            },
            relationships: data.profile.relationships || []
          };
          setDatasetProfile(profile);
        }
      } else {
        setIsLoadingFramingAnalets(false); // Stop loading on error
        console.error('❌ [App] Dataset analysis failed:', data.error);
      }
    });

    // When study ends (e.g., manual reset), go back to participant selector
    messageService.onMessage('study:ended', (_data: any) => {
      setHasActiveStudy(false);
      setShowStudyParticipantInput(true);
    });

    // When study completes, show post-study workspace selector
    messageService.onMessage('study:advance-stage:result', (payload: any) => {
      if (payload?.success && payload?.completed) {
        setShowStudyWorkspaceSelector(true);
      }
    });

    // Adjust view mode when study stage changes
    messageService.onMessage('study:stage-changed', (payload: any) => {
      try {
        const stage = payload?.stage;
        if (!stage) { return; }
        setCurrentStudyStage(stage);
        // Avoid initial loader flicker in study mode when switching stages
        setIsInitialLoad(false);
        // Only adjust view mode for task stages
        if (!stage.stageType || stage.stageType === 'task') {
          const mode = stage.conditionCode === 'Map' ? 'map' : (stage.conditionCode === 'Canvas' ? 'canvas' : 'tree');
          stateService.setViewMode(mode as any);
          if (mode === 'map') {
            // Enforce similarity alpha = 0.5 deterministically for map condition
            try {
              localStorage.setItem('similarity_alpha', '0.5');
              window.dispatchEvent(new CustomEvent('similarityConfigChanged', { detail: { alpha: 0.5 } }) as any);
            } catch {}
            // Show one-time refresh by title unless dismissed
            try {
              const dismissed = localStorage.getItem('alpha_refresh_dismissed') === '1';
              setShowAlphaRefresh(!dismissed);
            } catch { setShowAlphaRefresh(true); }
          }
        }
        // Refresh the explicit recording preference after switching stages.
        messageService.sendMessage('get-instrumentation-status');
        // Clear any locally cached notes and session to avoid stale carryover between stages
        try {
          // Clear webview-side note state immediately
          window.dispatchEvent(new CustomEvent('analysisNotesUpdated', { detail: { notes: [] } }));
          // Reset hierarchy notes reference so tree doesn't render stale note nodes
          try { require('./services/HierarchyService').HierarchyService.getInstance().setNotes([]); } catch {}
          // Clear persisted session cache (may contain analysis components from previous stage)
          try { sessionState.clearSession(); } catch {}
        } catch {}
        // Show loading indicators while dataset loads for the new stage
        setIsRestoringDataset(true);
        setIsLoadingFramingAnalets(true);
      } catch {}
    });

    // Hide study progress when clicking outside
    const onDocClick = (e: MouseEvent) => {
      if (!showStudyProgress) return;
      const target = e.target as Node;
      const withinPanel = studyProgressRef.current && studyProgressRef.current.contains(target);
      const withinButton = studyProgressBtnRef.current && studyProgressBtnRef.current.contains(target as Node);
      if (!withinPanel && !withinButton) {
        setShowStudyProgress(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    // Allow Settings to request the workspace selector
    const onShowSelector = () => setShowStudyWorkspaceSelector(true);
    window.addEventListener('showWorkspaceSelector' as any, onShowSelector);

    messageService.onMessage('fileList', () => {
      // Handle file list if needed
    });

    // Handler for dataset cleared confirmation
    messageService.onMessage('dataset-cleared', (data) => {
      if (data.success) {
        // Reset UI state to dataset loading view (StateService handles its own clearing)
        (async () => {
          try {
            stateService.clearAllState();
            try { sessionState.clearSession(); } catch {}
            setHasDataset(false);
            setDatasetInfo(null);

            // Force refresh of all UI components by dispatching events
            window.dispatchEvent(new CustomEvent('analetsUpdated'));
            window.dispatchEvent(new CustomEvent('conceptualStatementsUpdated'));
            try { window.dispatchEvent(new CustomEvent('analysisNotesUpdated', { detail: { notes: [] } })); } catch {}
          } catch (error) {
            console.error('Error clearing state:', error);
          }
        })();
      } else {
        console.error('❌ [App] Failed to clear dataset from backend:', data.error);
      }
    });

    // Handler for purge data response
    messageService.onMessage('purge-data-response', (data) => {
      if (data.success && !data.cancelled) {
        // Reset all UI state to initial state (StateService handles its own purge clearing)
        (async () => {
          try {
            stateService.clearAllState();
            setHasDataset(false);
            setDatasetInfo(null);
            setIsInitialLoad(true);

            // Force refresh of all UI components by dispatching events
            window.dispatchEvent(new CustomEvent('analetsUpdated'));
            window.dispatchEvent(new CustomEvent('conceptualStatementsUpdated'));
            // Also clear analysis notes immediately in the UI
            try {
              window.dispatchEvent(new CustomEvent('analysisNotesUpdated', { detail: { notes: [] } }));
            } catch {}
          } catch (error) {
            console.error('Error clearing state:', error);
          }
        })();
      } else if (!(data.cancelled)) {
        console.error('❌ [App] Data purge failed:', data.error);
      }
    });

    // On workspace switch, show initial load and clear dataset state
    messageService.onMessage('workspace:switch:result', (data) => {
      if (data?.success) {
        setShowStudyWorkspaceSelector(false);
        stateService.clearAllState();
        try { sessionState.clearSession(); } catch {}
        setHasDataset(false);
        setDatasetInfo(null);
        // In study mode, do not show the InitialLoadScreen; show restoring spinner instead
        if (FeatureFlags.STUDY_MODE_ENABLED && hasActiveStudy) {
          setIsInitialLoad(false);
          setIsRestoringDataset(true);
        } else {
          setIsInitialLoad(true);
        }
      }
    });

    // Handler for dataset profile received (enhanced with KDE data)
    messageService.onMessage('dataset-profile', (data) => {
      try { console.log('[dataset-bug][webview] dataset-profile', { hasProfile: !!data?.profile, cols: data?.profile?.columns?.length, enhanced: data?.enhanced }); } catch {}
      if (data.profile) {
        // Backend now sends in frontend format, no transformation needed
        const profile: DatasetProfile = {
          enhanced: data.enhanced || true, // Assume enhanced if coming from dataset-profile message
          columns: data.profile.columns || [],
          quality: data.profile.dataQuality || data.profile.quality || {
            overall: 'good',
            overallScore: 0.8,
            completeness: 1,
            consistency: 1,
            duplicates: 0
          },
          relationships: data.profile.relationships || []
        };
        setDatasetProfile(profile);
      }
    });

    // Initialize webview and trigger restoration check
    try { console.log('[dataset-bug][webview] initialized', { ts: new Date().toISOString(), mode: import.meta?.env?.MODE }); } catch {}
    messageService.sendMessage('webview-initialized', {});

    // When framing results arrive, clear when framing-driven threshold is met (or promotion produced waypoints)
    messageService.onMessage('fetch-analet-data', (data: any) => {
      try {
        const list = Array.isArray(data?.analets) ? data.analets : [];
        const promoted = !!data?.promotedFromFraming;
        const framingCount = list.filter((a: any) => (a?.type === 'framing')).length;
        const totalCount = list.length;
        const FRAMING_READY_THRESHOLD = 30;
        if (promoted || framingCount >= FRAMING_READY_THRESHOLD || totalCount >= FRAMING_READY_THRESHOLD) {
          try { console.log('[framing][webview] Loader cleared: counts', { framingCount, totalCount, promoted }); } catch {}
          setIsLoadingFramingAnalets(false);
        }
      } catch {}
    });

    // Request hierarchy restore explicitly on init
    messageService.sendMessage('load-hierarchy-state');

    // // Ensure default UMAP implementation is umap-js on first load
    // try {
    //   const currentImpl = stateService.getUMAPImplementation();
    //   if (currentImpl !== 'umap-js') {
    //     console.log('⚙️ [App] Switching UMAP implementation to umap-js by default');
    //     stateService.setUMAPImplementation('umap-js');
    //     // Nudge consumers to re-project with new implementation
    //     window.dispatchEvent(new CustomEvent('umapConfigChanged', { detail: { reason: 'default-umap-js' } }));
    //   }
    // } catch {}

    // Set restoration timeout as safety net
    const restorationTimeout = setTimeout(() => {
      if (isRestoringDataset) {
        console.warn('⚠️ [App] Dataset restoration timeout - proceeding without restoration');
        setIsRestoringDataset(false);
        setRestorationComplete(true);
      }
    }, 5000); // 5 second timeout

    // Cleanup timeout and telemetry services on unmount
    return () => {
      clearTimeout(restorationTimeout);
      document.removeEventListener('mousedown', onDocClick);
      window.removeEventListener('showWorkspaceSelector' as any, onShowSelector);

      // Cleanup telemetry services
      try {
        telemetryService.dispose();
      } catch (error) {
        console.warn('Failed to dispose telemetry services:', error);
      }
    };
  }, [stateService]);

  // Safety: if we re-enter restoring state later (e.g., after stage switch), ensure we don't hang indefinitely
  useEffect(() => {
    if (!isRestoringDataset) return;
    const timeout = setTimeout(() => {
      console.warn('[testing-study-build][webview] Restoring timeout while waiting after stage/workspace switch; proceeding');
      setIsRestoringDataset(false);
      setRestorationComplete(true);
    }, 8000);
    return () => clearTimeout(timeout);
  }, [isRestoringDataset]);

  // RRWeb recording is now controlled via TelemetryService instrumentation toggle
  // No separate event listener needed

  // Respond to runtime toggle of grid layout and view mode
  useEffect(() => {
    const onGridLayoutToggle = (e: any) => {
      const enabled = !!e?.detail?.enabled;
      setGridLayoutEnabled(enabled);
    };

    const onViewModeChange = (e: any) => {
      const mode = e?.detail?.mode;
      if (mode) {
        setViewMode(mode);
      }
    };

    window.addEventListener('gridLayoutChanged' as any, onGridLayoutToggle);
    window.addEventListener('viewModeChanged' as any, onViewModeChange);

    return () => {
      window.removeEventListener('gridLayoutChanged' as any, onGridLayoutToggle);
      window.removeEventListener('viewModeChanged' as any, onViewModeChange);
    };
  }, []);

  // Persist selected folder name changes
  useEffect(() => {
    stateService.setSelectedFolderName(selectedFolderName);
  }, [selectedFolderName, stateService]);

  const handleDatasetLoaded = (dataset: DatasetInfo & { fileContent?: string }) => {
    // Record telemetry for dataset loading
    try {
      const telemetryService = TelemetryService.getInstance();
      telemetryService.recordUserAction('load', 'dataset', {
        datasetName: dataset.name,
        rowCount: dataset.rowCount,
        columnCount: dataset.columns?.length || 0,
        columns: dataset.columns,
        fileSize: dataset.fileContent?.length || 0,
        loadTime: Date.now()
      });
    } catch (error) {
      console.warn('Failed to record dataset load telemetry:', error);
    }

    // Extract file content for backend, but don't store it in state
    const { fileContent, ...datasetWithoutContent } = dataset;

    // Set dataset in state service (without file content to save memory)
    stateService.setDataset(datasetWithoutContent);
    setHasDataset(stateService.getHasDataset());
    setDatasetInfo(stateService.getDatasetInfo());

    // Persist to session state
    sessionState.setDatasetInfo(datasetWithoutContent, true);
    setIsInitialLoad(false);
    setIsLoadingFramingAnalets(true); // Start loading framing analets

    // Send dataset analysis request to backend with file content
    const messageService = MessageService.getInstance();
    messageService.sendMessage('analyze-dataset', {
      dataset: datasetWithoutContent,
      fileContent: fileContent || null // Send file content for backend saving
    });
  };

  const handleCheckpointLoaded = () => {
    setIsInitialLoad(false);
    // The checkpoint restoration will trigger the normal data restoration flow
  };


    const handleAnaletClick = (analet: Analet) => {
    // Record telemetry for analet click
    try {
      const telemetryService = TelemetryService.getInstance();
      telemetryService.recordAnaletClick(analet.id, analet.location || { x: 0, y: 0 });
      telemetryService.recordUserAction('click', 'analet', {
        analetId: analet.id,
        statement: analet.statement,
        source: analet.source,
        tags: analet.tags,
        hasNotebook: !!(analet.notebookFileName || analet.notebookCellMetadata)
      });
    } catch (error) {
      console.warn('Failed to record analet click telemetry:', error);
    }

    // Notebook opening is handled by the specific components (AnalysisMap, AnaletFolderList)
  };

    // MessagingBridge mounts messaging hooks and updates shared selection

  // Removed handleAddAnalets - functionality moved to AnaletFolderList empty state

  const handleAnaletDragEnd = useCallback((analet: Analet, newPosition: { x: number; y: number }) => {
    // Record telemetry for analet drag
    try {
      const telemetryService = TelemetryService.getInstance();
      const oldPosition = analet.location || { x: 0, y: 0 };
      telemetryService.recordAnaletMove(analet.id, oldPosition, newPosition);
      telemetryService.recordUserAction('drag', 'analet', {
        analetId: analet.id,
        oldPosition,
        newPosition,
        statement: analet.statement,
        dragDistance: Math.sqrt(Math.pow(newPosition.x - oldPosition.x, 2) + Math.pow(newPosition.y - oldPosition.y, 2))
      });
    } catch (error) {
      console.warn('Failed to record analet drag telemetry:', error);
    }

    // 1) Update local analet state (used by map/list)
    try {
      const analetState = AnaletStateService.getInstance();
      const updated: Analet = {
        ...analet,
        location: { ...(analet.location || {}), x: newPosition.x, y: newPosition.y },
        isFixed: true,
        fixedPosition: { x: newPosition.x, y: newPosition.y },
        constraintStrength: 1.0
      };
      analetState.updateAnalet(updated);
      window.dispatchEvent(new CustomEvent('analetsUpdated'));
    } catch (e) {
      console.warn('⚠️ [App] Failed to update local analet state after drag:', e);
    }

    // 2) Persist to backend workspace state
    try {
      const messageService = MessageService.getInstance();
      messageService.sendMessage('update-analet', {
        analetId: analet.id,
        updates: {
          location: { ...(analet.location || {}), x: newPosition.x, y: newPosition.y },
          isFixed: true,
          fixedPosition: { x: newPosition.x, y: newPosition.y },
          constraintStrength: 1.0
        }
      });
    } catch (e) {
      console.warn('⚠️ [App] Failed to send update-analet message:', e);
    }

    // 3) Force a re-projection by updating the state
    setForceProjectionUpdate(prev => prev + 1);
  }, []);

  const handleCreateFolderFromCluster = useCallback((analetIds: number[], folderName: string) => {
    void analetIds;
    void folderName;
    // Set loading state
    setClusterFolderState({ isLoading: true, progress: 'Creating folder...' });

    // TODO: Implement folder creation with new edges-based hierarchy
  }, []);

  // Note editing handlers
  const handleNoteEditingChange = useCallback((isEditing: boolean, targetAnalet: Analet | null, content: string) => {
    setIsEditingNote(isEditing);
    setNoteTargetAnalet(targetAnalet);
    setNoteContent(content);
  }, []);

  const handleNoteSave = useCallback(() => {
    setIsEditingNote(false);
    setNoteTargetAnalet(null);
    setNoteContent('');
  }, []);

  const handleNoteCancel = useCallback(() => {
    setIsEditingNote(false);
    setNoteTargetAnalet(null);
    setNoteContent('');
  }, []);

  // Study participant configuration handler (legacy)
  const handleParticipantConfigured = useCallback((_participantId: number) => {
    setShowStudyInterface(false);

    // TODO: Auto-load the first dataset for this participant
    const config = studyService.getConfiguration();
    if (config) {
      const firstDataset = studyService.getFirstDatasetForParticipant();
      if (firstDataset) {
        // TODO: Implement automatic dataset loading based on participant configuration
        // For now, show the regular initial load screen
        setIsInitialLoad(true);
      }
    }
  }, [studyService]);

  // New study application controller handlers
  const handleStudyInitialized = useCallback((_participantCode: string) => {
    setShowStudyParticipantInput(false);
    setHasActiveStudy(true);

    // The extension will automatically switch workspaces and send stage-changed events
    // which will be handled by the StudyProgressDisplay component
  }, []);

  const handleStudyFinished = useCallback(() => {
    // StudyProgressDisplay will handle the UI updates
  }, []);

  const handleStudyReset = useCallback(() => {
    setHasActiveStudy(false);
    setShowStudyParticipantInput(true);
  }, []);


  // Utility function to detect column type from data
  // const detectColumnType = (columnName: string, sampleData: any[]): 'string' | 'number' | 'boolean' => {
  //   if (!sampleData || sampleData.length === 0) return 'string';
  //
  //   let numberCount = 0;
  //   let booleanCount = 0;
  //   let totalNonNull = 0;
  //
  //   for (const row of sampleData.slice(0, 100)) { // Sample first 100 rows
  //     const value = row[columnName];
  //     if (value !== null && value !== undefined && value !== '') {
  //       totalNonNull++;
  //
  //       // Check if it's a boolean
  //       if (typeof value === 'boolean' ||
  //           (typeof value === 'string' && ['true', 'false', '1', '0', 'yes', 'no'].includes(value.toLowerCase()))) {
  //         booleanCount++;
  //       }
  //       // Check if it's a number
  //       else if (!isNaN(Number(value)) && !isNaN(parseFloat(value))) {
  //         numberCount++;
  //       }
  //     }
  //   }
  //
  //   if (totalNonNull === 0) return 'string';
  //
  //   // Use 70% threshold for type detection
  //   const threshold = 0.7;
  //   if (booleanCount / totalNonNull >= threshold) return 'boolean';
  //   if (numberCount / totalNonNull >= threshold) return 'number';
  //   return 'string';
  // };

  // Create enhanced variables from dataset info and StateService modifications
  // const createEnhancedVariables = () => {
  //   if (!datasetInfo || !Array.isArray(datasetInfo.columns) || datasetInfo.columns.length === 0) return [];
  //
  //   const variableModifications = stateService.getVariableModifications();
  //   console.log('🔍 [App] Creating enhanced variables with modifications:', Object.keys(variableModifications));
  //
  // const cols: string[] = Array.isArray(datasetInfo.columns) ? datasetInfo.columns : [];
  // return cols.map((col: string) => {
  //     const modification = variableModifications[col];
  //     const detectedType = detectColumnType(col, datasetInfo.data || []);
  //
  //     const variable = {
  //       name: col,
  //       displayName: modification?.displayName || col,
  //       type: detectedType, // Use detected type instead of hardcoded 'string'
  //       description: modification?.description,
  //       unit: modification?.unit
  //     };
  //
  //     console.log('🔍 [App] Created enhanced variable:', variable);
  //     return variable;
  //   });
  // };

  // Enhanced dataset data computation via hook
  // const datasetDataForStatements = useDatasetDataForStatements(datasetInfo, stateService);

  // Listen for state reload requests (e.g., after checkpoint restore)
  useEffect(() => {
    const messageService = MessageService.getInstance();

    const handleStateReload = () => {
      // Force page reload to refresh all data
      window.location.reload();
    };

    const unsubscribe = messageService.onMessage('state-reload-required', handleStateReload);
    return unsubscribe;
  }, []);

  // Purge handling moved to PurgeController component


  // UNIFIED ANALET STORE - Single source of truth for all analets
  // Flow: StateService → useAnaletLoader → App.tsx filtering → components
  // This ensures all analets (including newly synced ones) flow through the same pipeline
  const { projectedAnalets: allProjectedAnalets, isAnalysisLoading, loadingMessage, requestAnaletData } = useAnaletLoader({
    width: 900,
    height: 900,
    padding: 20
  });

  // Console.log all analets data for debugging
  useEffect(() => {
    if (allProjectedAnalets && allProjectedAnalets.length > 0) {
      // const analetsData = allProjectedAnalets.map(analet => ({
      //   id: analet.id,
      //   shortName: analet.shortName || analet.statement?.substring(0, 50) + '...' || 'No name',
      //   explanation: analet.explanation || 'No explanation',
      //   cellQL: analet.cellQL || 'No cellQL'
      // }));
    }
  }, [allProjectedAnalets]);

  // Central analysis components (analets + bearings)
  const { components: analysisComponents, visible: visibleComponents } = useAnalysisComponents();
  const filteredAnalysisComponents = useMemo(() => {
    const comps: any[] = analysisComponents || [];
    const analetComps = comps.filter((c) => c && c.kind === 'analet');
    const otherComps = comps.filter((c) => c && c.kind !== 'analet');
    let filteredAnaletComps = analetComps;
    try {
      if (hideUnexplored) {
        const mat = StateService.getInstance().getMaterializedAnaletIds();
        filteredAnaletComps = filteredAnaletComps.filter((c: any) => mat.has(c.entity?.id));
      }
    } catch {}
    const term = (filterText || '').trim().toLowerCase();
    if (term.length > 0) {
      filteredAnaletComps = filteredAnaletComps.filter((c: any) => {
        const a = c.entity || {};
        const s = (a.statement || a.explanation || '').toLowerCase();
        return s.includes(term);
      });
    }
    return [...filteredAnaletComps, ...otherComps];
  }, [analysisComponents, hideUnexplored, filterText]);

  // Extract bearings from analysis components
  const bearings = useMemo(() => {
    const comps: any[] = analysisComponents || [];
    return comps
      .filter((c) => c && c.kind === 'bearing')
      .map((c) => c.entity);
  }, [analysisComponents]);

  // CENTRALIZED ANALET FILTERING - Applied once here, used by all child components
  // Rule: display all non-framing analets. No source-based allowlist.
  const displayAnalets = useMemo(() => {
    // Early return for empty or undefined arrays to prevent unnecessary processing
    if (!allProjectedAnalets || allProjectedAnalets.length === 0) {
      return [];
    }
    let filtered = allProjectedAnalets.filter(analet => analet.type !== 'framing');
    try {
      const svc = StateService.getInstance();
      if (hideUnexplored) {
        const mat = svc.getMaterializedAnaletIds();
        filtered = filtered.filter(a => mat.has(a.id));
      }
    } catch {}
    const term = (filterText || '').trim().toLowerCase();
    if (term.length > 0) {
      filtered = filtered.filter(a => {
        const s = (a.statement || a.explanation || '').toLowerCase();
        return s.includes(term);
      });
    }
    return filtered;
  }, [allProjectedAnalets, hideUnexplored, filterText]);

  // One-time spatial ordering (Morton) for Analysis List
  const [frozenOrder, setFrozenOrder] = useState<Map<number, number> | null>(null);
  useEffect(() => {
    if (frozenOrder) return;
    if (!displayAnalets || displayAnalets.length === 0) return;
    const positioned = displayAnalets.filter(a => a.location && typeof a.location.x === 'number' && typeof a.location.y === 'number');
    if (positioned.length === 0) return;
    try {
      const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      // Compute bounds for debug
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const a of positioned) {
        const x = a.location!.x || 0;
        const y = a.location!.y || 0;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
      const order = computeMortonOrder(displayAnalets, (a) => a.location ? { x: a.location.x || 0, y: a.location.y || 0 } : undefined, 16);
      const t1 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      const ms = t1 - t0;
      // Sample first few after ordering for sanity
      const sample = sortAnaletsByOrder(displayAnalets, order).slice(0, 10).map(a => a.id);
      if (ms > 20) {
        console.warn('[MORTON] slow compute', { ms: Number(ms.toFixed(2)), sample });
      }
      if (order.size > 0) setFrozenOrder(order);
    } catch (e) {
      console.warn('[MORTON] compute failed', e);
    }
  }, [displayAnalets, frozenOrder]);

  const spatiallyOrderedAnalets = useMemo(() => {
    if (!frozenOrder) return displayAnalets;
    return sortAnaletsByOrder(displayAnalets, frozenOrder);
  }, [displayAnalets, frozenOrder]);

  // Gate interactivity on framing/generation readiness (analysis only), not projection
  const mapAndListIsLoading = (isLoadingFramingAnalets || isAnalysisLoading);

  // Poll every 5s while analysis/framing is loading to nudge refresh
  useEffect(() => {
    // In study mode, avoid polling auto-generation while loading
    if (FeatureFlags.STUDY_MODE_ENABLED && hasActiveStudy) return;
    if (!mapAndListIsLoading) return;
    const id = setInterval(() => {
      try {
        console.log('[framing][webview] Poll: requesting generate-analyses');
      } catch {}
      try {
        requestAnaletData(false);
      } catch (e) {
        console.error('❌ [App] Poll refresh failed:', e);
      }
    }, 5000);
    return () => clearInterval(id);
  }, [mapAndListIsLoading, requestAnaletData]);

  // Shared selection state for both map and folder list components
  const sharedSelection = useSharedSelection();

  // const handlePanToStatement = useCallback(async (statementText: string) => {
  //   try {
  //     // Find the analet that matches this statement text
  //     const allAnalets = stateService.getAvailableAnalets();
  //     const matchingAnalet = allAnalets.find((analet: Analet) =>
  //       analet.source === 'conceptual_statement' &&
  //       (analet.statement.includes(statementText) || (analet.explanation || '').includes(statementText))
  //     );

  //     if (matchingAnalet) {
  //       console.log('🎯 [App] Found matching analet for statement, selecting:', matchingAnalet.id);
  //       // Select the analet (this should make it visible on the map)
  //       sharedSelection.selectAnalet(matchingAnalet.id, false);
  //     } else {
  //       console.warn('⚠️ [App] No matching analet found for statement:', statementText);
  //     }
  //   } catch (error) {
  //     console.error('❌ [App] Error panning to statement:', error);
  //   }
  // }, [stateService, sharedSelection]);


  // Session hydration happens in the background - useAnaletData will check session state
  // No need for separate loading screen since existing flow handles it

  // Interstitial pages for study survey/review
  if (FeatureFlags.STUDY_MODE_ENABLED && hasActiveStudy && currentStudyStage && (currentStudyStage.stageType === 'survey')) {
    const participantId = currentStudyStage.participantId;
    const dataset = currentStudyStage.datasetSlug;
    const condition = currentStudyStage.conditionCode;
    const participantLabel = resultSafeParticipantLabel();
    return (
      <div className="relative h-full w-full">
        <div className="absolute right-3 top-3 z-[9999]"><SettingsButton /></div>
        <SurveyInterstitial participantId={participantId} participantLabel={participantLabel} dataset={dataset} condition={condition} stageIndex={currentStudyStage.stageIndex} totalStages={currentStudyStage.totalStages} />
      </div>
    );
  }
  if (FeatureFlags.STUDY_MODE_ENABLED && hasActiveStudy && currentStudyStage && (currentStudyStage.stageType === 'review')) {
    const participantId = currentStudyStage.participantId;
    const participantLabel = resultSafeParticipantLabel();
    return (
      <div className="relative h-full w-full">
        <div className="absolute right-3 top-3 z-[9999]"><SettingsButton /></div>
        <ReviewInterstitial participantId={participantId} participantLabel={participantLabel} stageIndex={currentStudyStage.stageIndex} totalStages={currentStudyStage.totalStages} />
      </div>
    );
  }

  // Post-study: allow selecting among past 3 workspaces
  if (FeatureFlags.STUDY_MODE_ENABLED && showStudyWorkspaceSelector) {
    return (
      <div className="relative h-full w-full">
        <div className="absolute right-3 top-3 z-[9999]"><SettingsButton /></div>
        <StudyWorkspaceSelector />
      </div>
    );
  }

  // In Study Mode with active study, avoid showing the InitialLoadScreen; show restoring view until dataset is present
  if (FeatureFlags.STUDY_MODE_ENABLED && hasActiveStudy && !hasDataset) {
    return (
      <div className="h-full w-full flex items-center justify-center text-[var(--vscode-foreground)] bg-[var(--vscode-editor-background)] relative">
        <div className="absolute right-3 top-3 z-[9999]"><SettingsButton /></div>
        <div className="flex flex-col items-center gap-2">
          <div className="animate-spin rounded-full h-4 w-4 border border-[var(--vscode-descriptionForeground)] border-t-transparent"></div>
          <div className="text-[var(--vscode-descriptionForeground)] text-base">Restoring study workspace…</div>
        </div>
      </div>
    );
  }

  // Helper: try to read participantLabel from last known config (via sessionStorage bridge)
  function resultSafeParticipantLabel(): string | null {
    // We rely on extension messaging for the label in stage payload in future;
    // for now, try to read it from the latest 'study:current-config:result' cache if available.
    try { return (window as any).__meridian_participant_label__ || null; } catch { return null; }
  }

  // Show new study participant input if needed (only if study mode is enabled)
  if (FeatureFlags.STUDY_MODE_ENABLED && showStudyParticipantInput && StudyParticipantInput) {
    return (
      <div className="relative h-full w-full">
        <div className="absolute right-3 top-3 z-[9999]"><SettingsButton /></div>
        <StudyParticipantInput onStudyInitialized={handleStudyInitialized} onCancel={() => setShowStudyParticipantInput(false)} />
      </div>
    );
  }

  // Show study interface if in study mode and not configured (legacy, only if study mode is enabled)
  if (FeatureFlags.STUDY_MODE_ENABLED && showStudyInterface) {
    return (
      <div className="relative h-full w-full">
        <div className="absolute right-3 top-3 z-[9999]"><SettingsButton /></div>
        <StudyParticipantInterface onParticipantConfigured={handleParticipantConfigured} />
      </div>
    );
  }

  // Show full sidebar skeleton during restoration loading state
  if (isRestoringDataset) {
    return (
      <div className="relative h-full w-full">
        <div className="absolute right-3 top-3 z-[9999]"><SettingsButton /></div>
        <SidebarSkeleton />
      </div>
    );
  }

  return (
    <div className="h-full w-full text-[var(--vscode-foreground)] bg-[var(--vscode-editor-background)] relative" style={{minWidth: '350px'}}>
      {/* Headless bridge for message subscriptions */}
      <MessagingBridge
        sharedSelection={sharedSelection}
      />

      {/* Purge Controller mounts purge listener and shows overlay during deletion */}
      <PurgeController />
      {FeatureFlags.STUDY_MODE_ENABLED && hasActiveStudy && showStudyProgress && StudyProgressDisplay && (
        <div ref={studyProgressRef} className="absolute right-3 top-3 z-[9999] bg-[var(--vscode-dropdown-background)] border border-[var(--vscode-dropdown-border)] rounded-md shadow-lg p-2 w-80">
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs text-[var(--vscode-descriptionForeground)]">Study Progress</div>
            <button
              onClick={() => setShowStudyProgress(false)}
              className="px-2 py-1 text-xs rounded bg-[var(--vscode-button-background)] text-[var(--vscode-button-foreground)] hover:bg-[var(--vscode-button-hoverBackground)]"
            >
              Cancel
            </button>
          </div>
          <StudyProgressDisplay onFinishCondition={handleStudyFinished} onResetStudy={handleStudyReset} />
        </div>
      )}

      {!hasDataset && isInitialLoad ? (
        /* Initial Load Screen - Dataset or Checkpoint Selection */
        <>
          {logRender('[testing-study-build][webview] Rendering: InitialLoadScreen (no dataset, initial load)')}
          <div className="relative">
            <div className="absolute right-3 top-3 z-[9999]"><SettingsButton /></div>
            <InitialLoadScreen
              onDatasetLoaded={handleDatasetLoaded}
              onCheckpointLoaded={handleCheckpointLoaded}
            />
          </div>
        </>
      ) : !hasDataset ? (
        /* Fallback Dataset Loading Interface */
        <>
          {logRender('[testing-study-build][webview] Rendering: DatasetLoader (no dataset, not initial load)')}
          <div className="relative">
            <div className="absolute right-3 top-3 z-[9999]"><SettingsButton /></div>
            <DatasetLoader onDatasetLoaded={handleDatasetLoaded} />
          </div>
        </>
      ) : (
        /* Main Analysis Interface */
        <div className="h-full w-full flex flex-col">
          {/* Dataset Header with Settings Button */}
          {datasetInfo && (
            <div className="bg-[var(--vscode-editor-background)] shadow-sm shadow-black/5">
              <DatasetViewer
                    dataset={datasetInfo}
                    profile={datasetProfile || undefined}
                    stateService={stateService}
                    settingsButton={
                      <div className="flex items-center gap-2">
                        {/* Sync button */}
                        <NotebookSyncButton variant="icon" />
                        {/* Study progress toggle */}
                        {FeatureFlags.STUDY_MODE_ENABLED && hasActiveStudy && (
                          <button
                            ref={studyProgressBtnRef}
                            onClick={() => setShowStudyProgress(prev => !prev)}
                            title="Study Progress"
                            className="p-2 rounded bg-[var(--vscode-button-background)] text-[var(--vscode-button-foreground)] hover:bg-[var(--vscode-button-hoverBackground)]"
                            aria-label="Study Progress"
                          >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M12 6v12" />
                              <path d="M12 6c-2.5-1.667-5.5-2-8-2v12c2.5 0 5.5.333 8 2" />
                              <path d="M12 6c2.5-1.667 5.5-2 8-2v12c-2.5 0-5.5.333-8 2" />
                            </svg>
                          </button>
                        )}
                        {FeatureFlags.STUDY_MODE_ENABLED && isStudyMode && hasActiveStudy && StudyFinishButton && (
                          <StudyFinishButton
                            condition={currentStudyStage?.conditionCode}
                            dataset={currentStudyStage?.datasetSlug}
                            onConditionFinished={() => {
                            try {
                              StudyConfigurationService.getInstance().startNewCondition();
                            } catch (e) {
                              console.error('Failed to trigger baseline rehydration', e);
                            }
                          }} />
                        )}
                        <SettingsButton />
                      </div>
                    }
                  />
            </div>
          )}


          {/* Removed large NotebookSyncButton section (icon now in header) */}

      <div className="flex-1 p-4 flex flex-col space-y-4">
        {mapAndListIsLoading && (
          <div className="w-full flex items-center justify-center">
            <div className="flex flex-col items-center text-center space-y-2">
              <div className="animate-spin rounded-full h-4 w-4 border border-[var(--vscode-descriptionForeground)] border-t-transparent"></div>
              <div className="text-[var(--vscode-descriptionForeground)] text-base">
                Preparing analysis
                <span className="inline-block align-baseline" style={{ minWidth: '3ch' }}>{dots}</span>
              </div>
              <div>
                <button
                  onClick={() => {
                    try {
                      console.log('[framing][webview] Overlay Refresh: requesting generate-analyses');
                      requestAnaletData(false);
                    } catch (e) {
                      console.error('❌ [App] Overlay refresh failed:', e);
                    }
                  }}
                  className="px-3 py-1 rounded bg-[var(--vscode-button-background)] text-[var(--vscode-button-foreground)] hover:bg-[var(--vscode-button-hoverBackground)] text-xs"
                >
                  Refresh
                </button>
              </div>
            </div>
          </div>
        )}

            {/* Study Progress Display moved to floating panel toggled from header */}

            {/* Global Filter Bar - temporarily disabled */}
            {false && viewMode === 'full' && (
              <div />
              /*
              <FilterBar
                filterText={filterText}
                onFilterTextChange={setFilterText}
                hideUnexplored={hideUnexplored}
                onToggleHideUnexplored={setHideUnexplored}
              />
              */
            )}

            {/* Analysis Map Section - shown in full, map, and canvas modes */}
            {(viewMode === 'full' || viewMode === 'map' || viewMode === 'canvas') && (
              <div className="flex-shrink-0">
                <div className="mb-2">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-[var(--vscode-descriptionForeground)] uppercase tracking-wide">
                      {gridLayoutEnabled ? 'Analysis Canvas' : 'Analysis Map'}
                    </h3>
                    {(!gridLayoutEnabled && FeatureFlags.STUDY_MODE_ENABLED && hasActiveStudy && currentStudyStage?.conditionCode === 'Map' && showAlphaRefresh) && (
                      <button
                        type="button"
                        title="Reset similarity mix to 0.5"
                        aria-label="Reset similarity mix to 0.5"
                        onClick={() => {
                          try {
                            localStorage.setItem('similarity_alpha', '0.5');
                            window.dispatchEvent(new CustomEvent('similarityConfigChanged', { detail: { alpha: 0.5 } }) as any);
                          } catch {}
                          setShowAlphaRefresh(false);
                          try { localStorage.setItem('alpha_refresh_dismissed', '1'); } catch {}
                        }}
                        className="p-1 rounded text-[var(--vscode-descriptionForeground)] hover:text-[var(--vscode-foreground)] bg-transparent"
                        style={{ lineHeight: 0 }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <path d="M20 12a8 8 0 1 1-2.343-5.657" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                          <path d="M20 5v4h-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
                <div style={{ height: viewMode === 'full' ? '300px' : '500px' }}>
                  {(() => {
                    return (
                      <AnalysisMapSection
                        projectedAnalets={displayAnalets}
                        analysisComponents={filteredAnalysisComponents}
                        visibleComponents={visibleComponents}
                        isLoading={false}
                        loadingMessage={loadingMessage}
                        onAnaletClick={handleAnaletClick}
                        sharedSelection={sharedSelection}
                        constraintService={constraintService}
                        onAnaletDragEnd={handleAnaletDragEnd}
                        selectedFolderName={selectedFolderName}
                        onCreateFolderFromCluster={handleCreateFolderFromCluster}
                        clusterFolderState={clusterFolderState}
                        stateService={stateService}
                        isTrackingEnabled={isTrackingEnabled}
                        onTrackingToggle={setIsTrackingEnabled}
                        onNoteEditingChange={handleNoteEditingChange}
                      />
                    );
                  })()}
                </div>
              </div>
            )}


            {/* Variable Dropdown - REMOVED per user request */}

            {/* Analet Organization - shown in full and tree modes */}
            {(viewMode === 'full' || viewMode === 'tree') && hasDataset && (
              <div className="flex-shrink-0">
                <div className="text-xs text-[var(--vscode-descriptionForeground)] mt-1">Analysis List</div>
                <div style={{ height: viewMode === 'tree' ? '600px' : '700px' }}>
                  <NewAnalysisList
                    analysisComponents={filteredAnalysisComponents}
                    analets={spatiallyOrderedAnalets}
                    bearings={bearings}
                    onAnaletClick={handleAnaletClick}
                    height={viewMode === 'tree' ? 600 : 700}
                    filterText={filterText}
                    sharedSelection={sharedSelection}
                    onFolderSelected={setSelectedFolderName}
                    stateService={stateService}
                    isLoading={false}
                    conceptualStatementsProps={{
                      variables: datasetInfo?.columns?.map(col => ({
                        name: col,
                        displayName: col,
                        type: 'string' // Default type, could be enhanced with actual type detection
                      })) || [],
                      groups: [],
                      onSendStatementToMap: () => {},
                      onPanToStatement: () => {},
                      stateService: stateService,
                      datasetData: datasetInfo?.data || [],
                      messageService: undefined,
                      onAnaletGenerated: () => {}
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Baseline system: no checkpoint manager modal */}

      {/* Note Editor - rendered outside all containers to avoid truncation */}
      <MapNoteEditor
        isVisible={isEditingNote}
        targetAnalet={noteTargetAnalet}
        initialContent={noteContent}
        onSave={handleNoteSave}
        onCancel={handleNoteCancel}
        variables={datasetInfo?.columns?.map(col => ({
          name: col,
          displayName: col,
          type: 'string'
        })) || []}
        groups={[]}
        datasetData={datasetInfo?.data || []}
      />
    </div>
  );
};

export default App;
