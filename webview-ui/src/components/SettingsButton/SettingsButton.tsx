import React, { useState, useRef, useEffect } from 'react';
import { MessageService } from '../../services/MessageService';
import { StateService } from '../../services/StateService';
import { ConstraintService } from '../../services/ConstraintService';
import { TelemetryService } from '../../services/TelemetryService';
import { useSettingsInstrumentation } from '../../hooks/useInstrumentation';
import { StudyConfigurationService } from '../../services/StudyConfigurationService';

export const SettingsButton: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [studyModeOverride, setStudyModeOverride] = useState<boolean>(() => {
    try { return localStorage.getItem('meridian.studyMode.override') === 'true'; } catch { return false; }
  });
  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const stateService = StateService.getInstance();
  const telemetryService = TelemetryService.getInstance();
  const { trackClick, trackUIStateChange } = useSettingsInstrumentation();
  
  const [umapImplementation, setUmapImplementation] = useState(stateService.getUMAPImplementation());
  const [instrumentationEnabled, setInstrumentationEnabled] = useState(telemetryService.isInstrumentationActive());
  const [gridLayoutEnabled, setGridLayoutEnabled] = useState(stateService.getGridLayoutEnabled());
  const [viewMode, setViewMode] = useState(stateService.getViewMode());
  const [similarityAlpha, setSimilarityAlpha] = useState(() => {
    try {
      const raw = window.localStorage.getItem('similarity_alpha');
      const val = raw ? parseFloat(raw) : 0.3;
      return Number.isNaN(val) ? 0.3 : Math.min(1, Math.max(0, val));
    } catch {
      return 0.3;
    }
  });
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [apiKeySaving, setApiKeySaving] = useState(false);
  const [apiKeySaved, setApiKeySaved] = useState<'idle' | 'success' | 'error'>('idle');
  const [apiKeyError, setApiKeyError] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [isRerunningUMAP, setIsRerunningUMAP] = useState(false);
  const isStudyMode = StudyConfigurationService.isStudyMode();
  const studyService = StudyConfigurationService.getInstance();
  const [activeDataset, setActiveDataset] = useState<"diamonds"|"cars"|"houses">(
    (studyService.getCurrentDatasetSlug() as any) || 'diamonds'
  );
  const participantId = studyService.getConfiguration()?.participantId;
  const [activeWorkspacePath, setActiveWorkspacePath] = useState<string | null>(null);
  const [workspaceQuickActions, setWorkspaceQuickActions] = useState<{
    csvPaths: string[];
    hasVehiclesFinal: boolean;
    baselineCheckpointPath?: string;
    checkpointFiles: string[];
  } | null>(null);
  const [showWorkspaceList, setShowWorkspaceList] = useState(false);
  const [studyDatasetStages, setStudyDatasetStages] = useState<Record<string, number>>({});
  const [currentStageIndex, setCurrentStageIndex] = useState<number | null>(null);
  const [totalStages, setTotalStages] = useState<number | null>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Listen for instrumentation status changes
  useEffect(() => {
    const messageService = MessageService.getInstance();
    
    const handleInstrumentationStatus = (data: { enabled: boolean }) => {
      setInstrumentationEnabled(data.enabled);
    };

    messageService.onMessage('instrumentation-status', handleInstrumentationStatus);
    messageService.onMessage('instrumentation-status-changed', handleInstrumentationStatus);

    return () => {
      messageService.offMessage('instrumentation-status', handleInstrumentationStatus);
      messageService.offMessage('instrumentation-status-changed', handleInstrumentationStatus);
    };
  }, []);

  // Hydrate current workspace info on mount
  useEffect(() => {
    const messageService = MessageService.getInstance();
    const handleInfo = (data: any) => {
      if (data?.success) {
        setActiveWorkspacePath(data.path || null);
        setWorkspaceQuickActions(data.quickActions || null);
        if (typeof data.analyticsEnabled === 'boolean') {
          setInstrumentationEnabled(!!data.analyticsEnabled);
        }
      }
    };
    messageService.onMessage('workspace:info:result', handleInfo);
    messageService.sendMessage('workspace:info');
    
    // Study progress/init
    const handleStageChanged = (data: any) => {
      try {
        const p = data?.progress;
        setCurrentStageIndex(typeof data?.stage?.stageIndex === 'number' ? data.stage.stageIndex : (typeof p?.currentStage === 'number' ? (p.currentStage - 1) : null));
        setTotalStages(typeof p?.totalStages === 'number' ? p.totalStages : (typeof data?.stage?.totalStages === 'number' ? data.stage.totalStages : null));
      } catch {}
    };
    const handleConfig = (data: any) => {
      if (data?.success) {
        const p = data.progress;
        setCurrentStageIndex(typeof data?.currentStage?.stageIndex === 'number' ? data.currentStage.stageIndex : (typeof p?.currentStage === 'number' ? (p.currentStage - 1) : null));
        setTotalStages(typeof p?.totalStages === 'number' ? p.totalStages : (typeof data?.currentStage?.totalStages === 'number' ? data.currentStage.totalStages : null));
      }
    };
    const unsubStage = messageService.onMessage('study:stage-changed', handleStageChanged);
    const unsubConfig = messageService.onMessage('study:current-config:result', handleConfig);
    messageService.sendMessage('study:get-current-config');
    return () => {
      messageService.offMessage('workspace:info:result', handleInfo);
      try { unsubStage?.(); } catch {}
      try { unsubConfig?.(); } catch {}
    };
  }, []);

  // Listen for view mode and grid layout changes from other components
  useEffect(() => {
    const handleViewModeChange = (event: CustomEvent) => {
      const { mode } = event.detail;
      setViewMode(mode);
    };

    const handleGridLayoutChange = (event: CustomEvent) => {
      const { enabled } = event.detail;
      setGridLayoutEnabled(enabled);
    };

    window.addEventListener('viewModeChanged', handleViewModeChange as EventListener);
    window.addEventListener('gridLayoutChanged', handleGridLayoutChange as EventListener);

    return () => {
      window.removeEventListener('viewModeChanged', handleViewModeChange as EventListener);
      window.removeEventListener('gridLayoutChanged', handleGridLayoutChange as EventListener);
    };
  }, []);

  const handlePurgeData = async () => {
    setIsOpen(false);
    
    try {
      const messageService = MessageService.getInstance();
      messageService.sendMessage('purge-data', {});
    } catch (error) {
      console.error('❌ [SettingsButton] Error sending purge data request:', error);
    }
  };

  const handleExportData = () => {
    setIsOpen(false);
    // TODO: Implement export functionality
  };

  const handleOpenPastWorkspaces = () => {
    setIsOpen(false);
    try {
      window.dispatchEvent(new CustomEvent('showWorkspaceSelector'));
    } catch (e) {
      console.error('❌ [SettingsButton] Failed to open past workspaces:', e);
    }
  };

  const handleChooseWorkspace = async () => {
    // Show a simple list of study task workspaces (vehicles, diamonds, listings)
    try {
      const next = !showWorkspaceList;
      setShowWorkspaceList(next);
      if (next) {
        const messageService = MessageService.getInstance();
        const unsubscribe = messageService.onMessage('study:current-config:result', (data: any) => {
          try {
            const cfg = data?.config;
            const stages: any[] = Array.isArray(cfg?.stages) ? cfg.stages : [];
            const mapping: Record<string, number> = {};
            stages.forEach((s, idx) => {
              if (!s) return;
              if (!s.stageType || s.stageType === 'task') {
                const slug = s.datasetSlug;
                if (slug && mapping[slug] === undefined) mapping[slug] = idx;
              }
            });
            setStudyDatasetStages(mapping);
          } catch {}
          try { unsubscribe(); } catch {}
        });
        messageService.sendMessage('study:get-current-config');
      }
    } catch (error) {
      console.error('❌ [SettingsButton] Error opening workspace selector:', error);
    }
  };

  const handleSaveApiKey = async () => {
    setApiKeySaving(true);
    setApiKeySaved('idle');
    setApiKeyError(null);
    try {
      const messageService = MessageService.getInstance();
      const result = await messageService.sendRequest<{ success: boolean; error?: string }>('save-openai-api-key', { apiKey: apiKeyInput }, 10000);
      if (result?.success) {
        setApiKeySaved('success');
      } else {
        setApiKeySaved('error');
        setApiKeyError(result?.error || 'Failed to save API key');
      }
    } catch (error) {
      setApiKeySaved('error');
      setApiKeyError(error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setApiKeySaving(false);
    }
  };

  const handleUMAPImplementationChange = (implementation: 'custom' | 'umap-js') => {
    stateService.setUMAPImplementation(implementation);
    setUmapImplementation(implementation);
    // Trigger UMAP re-projection by dispatching a custom event
    window.dispatchEvent(new CustomEvent('umapConfigChanged', {
      detail: { implementation }
    }));
  };

  const handleToggleInstrumentation = (enabled: boolean) => {
    trackClick('toggle_instrumentation', { enabled });
    telemetryService.toggleInstrumentation();
    setInstrumentationEnabled(enabled);
    trackUIStateChange('instrumentation_toggled', { enabled });
  };

  const handleToggleGridLayout = (enabled: boolean) => {
    stateService.setGridLayoutEnabled(enabled);
    setGridLayoutEnabled(enabled);
    // Dispatch custom event to notify components of grid layout change
    window.dispatchEvent(new CustomEvent('gridLayoutChanged', { detail: { enabled } }));
  };

  const handleViewModeChange = (mode: 'full' | 'map' | 'canvas' | 'tree') => {
    stateService.setViewMode(mode);
    setViewMode(mode);
    trackClick('change_view_mode', { mode });
    trackUIStateChange('view_mode_changed', { mode });
  };

  const handleRerunUMAP = async () => {
    setIsRerunningUMAP(true);
    setIsOpen(false);

    try {
      // Clear all constraints from the constraint service (frontend)
      const constraintService = ConstraintService.getInstance();
      constraintService.clearAllConstraints();

      // Clear constraints from backend storage as well
      const messageService = MessageService.getInstance();
      await messageService.sendMessage('save-analet-constraints', { constraints: [] });

      // Dispatch custom event to trigger UMAP unfreezing and re-projection
      window.dispatchEvent(new CustomEvent('rerunUMAP', {
        detail: { timestamp: Date.now() }
      }));
    } catch (error) {
      console.error('❌ [SettingsButton] Error during UMAP rerun:', error);
    } finally {
      // Reset the loading state after a short delay to show user feedback
      setTimeout(() => setIsRerunningUMAP(false), 1000);
    }
  };

  const handleGenerateRandomAnalets = async () => {
    setIsOpen(false);
    try {
      const messageService = MessageService.getInstance();
      await messageService.sendMessage('add-waypoint-analets', { count: 20 });
    } catch (error) {
      console.error('❌ [SettingsButton] Error generating random analets:', error);
    }
  };
  const handleOpenSyncConfig = () => {
    setIsOpen(false);
    // @ts-ignore custom event name
    window.dispatchEvent(new CustomEvent('openSyncConfig'));
  };

  const handleResetStudyUI = async () => {
    setIsOpen(false);
    try {
      const messageService = MessageService.getInstance();
      // Clear webview-side study config
      try { StudyConfigurationService.getInstance().resetConfiguration(); } catch {}
      // Ask extension to reset study and emit study:ended
      await messageService.sendMessage('study:reset');
    } catch (error) {
      console.error('❌ [SettingsButton] Error resetting study UI state:', error);
    }
  };

  const handleToggleStudyMode = async (enabled: boolean) => {
    setIsOpen(false);
    try {
      // Persist local override so webview FeatureFlags sees it
      if (enabled) {
        localStorage.setItem('meridian.studyMode.override', 'true');
      } else {
        localStorage.removeItem('meridian.studyMode.override');
      }
      setStudyModeOverride(enabled);
      // Ask extension to persist override and reload
      const messageService = MessageService.getInstance();
      await messageService.sendMessage('set-study-mode', { enabled, reload: true });
    } catch (e) {
      console.error('❌ [SettingsButton] Failed to toggle Study Mode:', e);
    }
  };

  return (
    <div className="relative">
      {/* Settings Button */}
      <button
        ref={buttonRef}
        onClick={() => setIsOpen(!isOpen)}
        className="
          p-2 rounded-md transition-colors duration-200
          text-[var(--vscode-foreground)]
          hover:bg-[var(--vscode-toolbar-hoverBackground)]
          focus:outline-none focus:ring-2 focus:ring-[var(--vscode-focusBorder)]
        "
        title="Settings"
      >
        <svg 
          width="16" 
          height="16" 
          viewBox="0 0 22 20" 
          fill="currentColor"
          className="transition-transform duration-200"
          style={{ transform: isOpen ? 'rotate(45deg)' : 'rotate(0deg)' }}
        >
          <path d="M8.2502 20L7.8502 16.8C7.63353 16.7167 7.42953 16.6167 7.2382 16.5C7.04686 16.3833 6.8592 16.2583 6.6752 16.125L3.7002 17.375L0.950195 12.625L3.5252 10.675C3.50853 10.5583 3.5002 10.446 3.5002 10.338V9.663C3.5002 9.55433 3.50853 9.44167 3.5252 9.325L0.950195 7.375L3.7002 2.625L6.6752 3.875C6.85853 3.74167 7.0502 3.61667 7.2502 3.5C7.4502 3.38333 7.6502 3.28333 7.8502 3.2L8.2502 0H13.7502L14.1502 3.2C14.3669 3.28333 14.5712 3.38333 14.7632 3.5C14.9552 3.61667 15.1425 3.74167 15.3252 3.875L18.3002 2.625L21.0502 7.375L18.4752 9.325C18.4919 9.44167 18.5002 9.55433 18.5002 9.663V10.337C18.5002 10.4457 18.4835 10.5583 18.4502 10.675L21.0252 12.625L18.2752 17.375L15.3252 16.125C15.1419 16.2583 14.9502 16.3833 14.7502 16.5C14.5502 16.6167 14.3502 16.7167 14.1502 16.8L13.7502 20H8.2502ZM11.0502 13.5C12.0169 13.5 12.8419 13.1583 13.5252 12.475C14.2085 11.7917 14.5502 10.9667 14.5502 10C14.5502 9.03333 14.2085 8.20833 13.5252 7.525C12.8419 6.84167 12.0169 6.5 11.0502 6.5C10.0669 6.5 9.23753 6.84167 8.5622 7.525C7.88686 8.20833 7.54953 9.03333 7.5502 10C7.55086 10.9667 7.88853 11.7917 8.5632 12.475C9.23786 13.1583 10.0669 13.5 11.0502 13.5Z" />
        </svg>
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div
          ref={dropdownRef}
          className="
            absolute right-0 top-full mt-1 w-48 z-[9999]
            bg-[var(--vscode-dropdown-background)]
            border border-[var(--vscode-dropdown-border)]
            rounded-md shadow-lg
            py-1
          "
        >
          {/* Workspace */}
          <div className="px-3 py-2 space-y-2">
            <div className="text-xs font-semibold text-[var(--vscode-descriptionForeground)] uppercase tracking-wide">
              Workspace
            </div>
            <div className="text-xs text-[var(--vscode-descriptionForeground)] break-all">
              {activeWorkspacePath ? activeWorkspacePath : 'Not selected'}
            </div>
            <div className="flex items-center space-x-2">
              <button
                onClick={handleChooseWorkspace}
                className="px-2 py-1 text-xs rounded text-[var(--vscode-button-foreground)] bg-[var(--vscode-button-background)] hover:bg-[var(--vscode-button-hoverBackground)]"
              >
                Change Workspace
              </button>
              {isStudyMode && (
                <>
                  <button
                    onClick={() => {
                      if (currentStageIndex == null) return;
                      const prev = currentStageIndex - 1;
                      if (prev < 0) return;
                      try {
                        const msg = MessageService.getInstance();
                        console.log('[StudyNext] settings back-click', { from: currentStageIndex, to: prev, total: totalStages });
                        msg.sendMessage('study:goto-stage', { index: prev });
                      } catch {}
                      setIsOpen(false);
                    }}
                    disabled={currentStageIndex == null || currentStageIndex <= 0}
                    className="px-2 py-1 text-xs rounded text-[var(--vscode-button-foreground)] bg-[var(--vscode-button-background)] hover:bg-[var(--vscode-button-hoverBackground)] disabled:opacity-50"
                    title="Go to previous stage"
                  >
                    Back
                  </button>
                  <button
                    onClick={() => {
                      if (currentStageIndex == null || totalStages == null) return;
                      const next = currentStageIndex + 1;
                      if (next >= totalStages) return;
                      try {
                        const msg = MessageService.getInstance();
                        console.log('[StudyNext] settings next-click', { from: currentStageIndex, to: next, total: totalStages });
                        msg.sendMessage('study:goto-stage', { index: next });
                      } catch {}
                      setIsOpen(false);
                    }}
                    disabled={currentStageIndex == null || totalStages == null || currentStageIndex >= (totalStages - 1)}
                    className="px-2 py-1 text-xs rounded text-[var(--vscode-button-foreground)] bg-[var(--vscode-button-background)] hover:bg-[var(--vscode-button-hoverBackground)] disabled:opacity-50"
                    title="Go to next stage"
                  >
                    Next
                  </button>
                </>
              )}
            </div>
            {showWorkspaceList && (
              <div className="mt-2 border border-[var(--vscode-widget-border)] rounded-md overflow-hidden">
                {(['vehicles','diamonds','listings'] as const).map(slug => {
                  const idx = studyDatasetStages[slug];
                  const available = typeof idx === 'number';
                  return (
                    <button
                      key={slug}
                      disabled={!available}
                      onClick={() => {
                        try {
                          const msg = MessageService.getInstance();
                          if (typeof idx === 'number') msg.sendMessage('study:goto-stage', { index: idx });
                        } catch {}
                        setIsOpen(false);
                        setShowWorkspaceList(false);
                      }}
                      className="w-full text-left px-3 py-2 hover:bg-[var(--vscode-list-hoverBackground)] disabled:opacity-50"
                      title={available ? `Go to ${slug}` : `${slug} not in current study config`}
                    >
                      <div className="flex items-center justify-between">
                        <span><span role="img" aria-label="folder">📁</span> {slug}</span>
                        <span className="text-xs text-[var(--vscode-descriptionForeground)]">{available ? `stage ${idx}` : 'unavailable'}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
            {workspaceQuickActions && (
              <div className="text-xs text-[var(--vscode-descriptionForeground)]">
                {workspaceQuickActions.hasVehiclesFinal && (
                  <div>Detected: vehicles_final.csv</div>
                )}
                {workspaceQuickActions.baselineCheckpointPath && (
                  <div>Baseline checkpoint detected</div>
                )}
              </div>
            )}
          </div>
          {/* OpenAI API Key */}
          <div className="px-3 py-2 space-y-2">
            <div className="text-xs font-semibold text-[var(--vscode-descriptionForeground)] uppercase tracking-wide">
              OpenAI API Key
            </div>
            <div className="flex items-center space-x-2">
              <input
                type={showKey ? 'text' : 'password'}
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                className="flex-1 px-2 py-1 rounded border border-[var(--vscode-input-border)] bg-[var(--vscode-input-background)] text-[var(--vscode-input-foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--vscode-focusBorder)]"
                placeholder="sk-..."
                aria-label="OpenAI API Key"
              />
              <button
                onClick={() => setShowKey(!showKey)}
                className="px-2 py-1 text-xs rounded border border-[var(--vscode-button-border)] text-[var(--vscode-button-foreground)] bg-[var(--vscode-button-secondaryBackground)] hover:bg-[var(--vscode-button-secondaryHoverBackground)]"
                aria-label={showKey ? 'Hide key' : 'Show key'}
              >
                {showKey ? 'Hide' : 'Show'}
              </button>
            </div>
            <div className="flex items-center space-x-2">
              <button
                onClick={handleSaveApiKey}
                disabled={!apiKeyInput || apiKeySaving}
                className="px-2 py-1 text-xs rounded text-[var(--vscode-button-foreground)] bg-[var(--vscode-button-background)] hover:bg-[var(--vscode-button-hoverBackground)] disabled:opacity-50"
              >
                {apiKeySaving ? 'Saving…' : 'Save Key'}
              </button>
              {apiKeySaved === 'success' && (
                <span className="text-xs text-[var(--vscode-testing-iconPassed)]">Saved</span>
              )}
              {apiKeySaved === 'error' && (
                <span className="text-xs text-[var(--vscode-errorForeground)]">{apiKeyError || 'Error'}</span>
              )}
            </div>
          </div>

          {/* Separator */}
          <div className="border-t border-[var(--vscode-dropdown-border)] my-1" />

          {/* Configure Sync */}
          <button
            onClick={handleOpenSyncConfig}
            className="
              w-full text-left px-3 py-2 text-sm
              text-[var(--vscode-dropdown-foreground)]
              hover:bg-[var(--vscode-list-hoverBackground)]
              transition-colors duration-150
              flex items-center space-x-2
            "
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <path d="M9.605 1.05a1 1 0 00-1.21 0l-.766.575a1 1 0 01-.727.17l-.927-.154a1 1 0 00-1.09.627l-.36.9a1 1 0 01-.54.56l-.89.38a1 1 0 00-.57 1.08l.155.927a1 1 0 01-.17.727l-.575.766a1 1 0 000 1.21l.575.766a1 1 0 01.17.727l-.155.927a1 1 0 00.57 1.08l.89.38a1 1 0 01.54.56l.36.9a1 1 0 001.09.627l.927-.154a1 1 0 01.727.17l.766.575a1 1 0 001.21 0l.766-.575a1 1 0 01.727-.17l.927.154a1 1 0 001.09-.627l.36-.9a1 1 0 01.54-.56l.89-.38a1 1 0 00.57-1.08l-.155-.927a1 1 0 01.17-.727l.575-.766a1 1 0 000-1.21l-.575-.766a1 1 0 01-.17-.727l.155-.927a1 1 0 00-.57-1.08l-.89-.38a1 1 0 01-.54-.56l-.36-.9a1 1 0 00-1.09-.627l-.927.154a1 1 0 01-.727-.17L9.605 1.05zM8 11a3 3 0 110-6 3 3 0 010 6z"/>
            </svg>
            <span>Configure Sync</span>
          </button>

          {/* Usage Analytics & Session Recording */}
          <div className="px-3 py-2">
            <div className="text-xs font-semibold text-[var(--vscode-descriptionForeground)] uppercase tracking-wide mb-2">
              Usage Analytics
            </div>
            <label className="flex items-center justify-between cursor-pointer mb-2">
              <div className="flex flex-col">
                <span className="text-sm text-[var(--vscode-dropdown-foreground)]">Enable Analytics</span>
                <span className="text-xs text-[var(--vscode-descriptionForeground)]">Records interactions & session replay</span>
              </div>
              <div className="flex items-center space-x-2">
                {instrumentationEnabled && (
                  <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" title="Recording active" />
                )}
                <input
                  type="checkbox"
                  checked={instrumentationEnabled}
                  onChange={(e) => handleToggleInstrumentation(e.target.checked)}
                  aria-label="Enable usage analytics and session recording"
                />
              </div>
            </label>
            {instrumentationEnabled && (
              <div className="text-xs text-[var(--vscode-descriptionForeground)] mt-1 p-2 bg-[var(--vscode-editorInfo-background)] rounded">
                📊 Recording interactions and session replay to /logs (and Firebase if enabled)
              </div>
            )}
          </div>

          {/* Study Mode Toggle */}
          <div className="px-3 py-2">
            <div className="text-xs font-semibold text-[var(--vscode-descriptionForeground)] uppercase tracking-wide mb-2">
              Study Mode
            </div>
            <label className="flex items-center justify-between cursor-pointer mb-1">
              <span className="text-sm text-[var(--vscode-dropdown-foreground)]">Enable Study Mode</span>
              <input
                type="checkbox"
                checked={studyModeOverride}
                onChange={(e) => handleToggleStudyMode(e.target.checked)}
                aria-label="Enable Study Mode (reload required)"
              />
            </label>
            <div className="text-xs text-[var(--vscode-descriptionForeground)] mt-1">
              Requires window reload to fully apply (handler registration).
            </div>
          </div>
          {/* Study Mode Controls */}
          {isStudyMode && (
            <div className="px-3 py-2">
              <div className="text-xs font-semibold text-[var(--vscode-descriptionForeground)] uppercase tracking-wide mb-2">
                Study Session
              </div>
              <div className="text-xs text-[var(--vscode-descriptionForeground)] mb-2">
                Participant ID: <span className="font-mono text-[var(--vscode-foreground)]">{participantId ?? '—'}</span>
              </div>
              <label className="block text-xs text-[var(--vscode-descriptionForeground)] mb-1">Dataset</label>
              <select
                className="w-full px-2 py-1 rounded border border-[var(--vscode-input-border)] bg-[var(--vscode-input-background)] text-[var(--vscode-input-foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--vscode-focusBorder)]"
                value={activeDataset}
                onChange={(e) => {
                  const next = e.target.value as "diamonds"|"cars"|"houses";
                  setActiveDataset(next);
                  studyService.setCurrentDatasetSlug(next);
                  try {
                    const messageService = MessageService.getInstance();
                    messageService.sendMessage('study-context-update', {
                      isStudyMode: true,
                      participantId,
                      datasetSlug: next,
                      conditionCode: studyService.getCurrentConditionCode()
                    });
                  } catch {}
                }}
              >
                <option value="diamonds">diamonds</option>
                <option value="cars">cars</option>
                <option value="houses">houses</option>
              </select>
            </div>
          )}
          {/* UMAP Implementation Settings */}
          <div className="px-3 py-2">
            <div className="text-xs font-semibold text-[var(--vscode-descriptionForeground)] uppercase tracking-wide mb-2">
              UMAP Implementation
            </div>
            <div className="space-y-1">
              <label className="flex items-center space-x-2 cursor-pointer">
                <input
                  type="radio"
                  name="umap-implementation"
                  value="custom"
                  checked={umapImplementation === 'custom'}
                  onChange={() => handleUMAPImplementationChange('custom')}
                  className="form-radio text-[var(--vscode-button-background)]"
                />
                <span className="text-sm text-[var(--vscode-dropdown-foreground)]">
                  Custom (default)
                </span>
              </label>
              <label className="flex items-center space-x-2 cursor-pointer">
                <input
                  type="radio"
                  name="umap-implementation"
                  value="umap-js"
                  checked={umapImplementation === 'umap-js'}
                  onChange={() => handleUMAPImplementationChange('umap-js')}
                  className="form-radio text-[var(--vscode-button-background)]"
                />
                <span className="text-sm text-[var(--vscode-dropdown-foreground)]">
                  UMAP-JS
                </span>
              </label>
            </div>
          </div>

          {/* Display Mode Settings */}
          <div className="px-3 py-2">
            <div className="text-xs font-semibold text-[var(--vscode-descriptionForeground)] uppercase tracking-wide mb-2">
              Display Mode
            </div>
            <div className="space-y-1">
              <label className="flex items-center space-x-2 cursor-pointer">
                <input
                  type="radio"
                  name="view-mode"
                  value="full"
                  checked={viewMode === 'full'}
                  onChange={() => handleViewModeChange('full')}
                  className="form-radio text-[var(--vscode-button-background)]"
                />
                <span className="text-sm text-[var(--vscode-dropdown-foreground)]">
                  Full Mode
                </span>
              </label>
              <label className="flex items-center space-x-2 cursor-pointer">
                <input
                  type="radio"
                  name="view-mode"
                  value="map"
                  checked={viewMode === 'map'}
                  onChange={() => handleViewModeChange('map')}
                  className="form-radio text-[var(--vscode-button-background)]"
                />
                <span className="text-sm text-[var(--vscode-dropdown-foreground)]">
                  Map Mode
                </span>
              </label>
              <label className="flex items-center space-x-2 cursor-pointer">
                <input
                  type="radio"
                  name="view-mode"
                  value="canvas"
                  checked={viewMode === 'canvas'}
                  onChange={() => handleViewModeChange('canvas')}
                  className="form-radio text-[var(--vscode-button-background)]"
                />
                <span className="text-sm text-[var(--vscode-dropdown-foreground)]">
                  Canvas Mode
                </span>
              </label>
              <label className="flex items-center space-x-2 cursor-pointer">
                <input
                  type="radio"
                  name="view-mode"
                  value="tree"
                  checked={viewMode === 'tree'}
                  onChange={() => handleViewModeChange('tree')}
                  className="form-radio text-[var(--vscode-button-background)]"
                />
                <span className="text-sm text-[var(--vscode-dropdown-foreground)]">
                  Tree Mode
                </span>
              </label>
            </div>
            <div className="text-xs text-[var(--vscode-descriptionForeground)] mt-2">
              {viewMode === 'full' && 'Shows everything: filter bar, analysis map/canvas, and tree'}
              {viewMode === 'map' && 'Shows only the analysis map with variable dropdown'}
              {viewMode === 'canvas' && 'Shows analysis map with grid layout enabled'}
              {viewMode === 'tree' && 'Shows only the analysis tree/list'}
            </div>
          </div>

          {/* UI Layout Settings */}
          <div className="px-3 py-2">
            <div className="text-xs font-semibold text-[var(--vscode-descriptionForeground)] uppercase tracking-wide mb-2">
              UI Layout
            </div>
            <label className="flex items-center justify-between cursor-pointer">
              <span className="text-sm text-[var(--vscode-dropdown-foreground)]">Grid Layout</span>
              <input
                type="checkbox"
                checked={gridLayoutEnabled}
                onChange={(e) => handleToggleGridLayout(e.target.checked)}
                aria-label="Enable grid layout for analysis canvas"
                disabled={true}
              />
            </label>
            <div className="text-xs text-[var(--vscode-descriptionForeground)] mt-1">
              {gridLayoutEnabled ? 'Analysis Canvas mode: items arranged in alphabetical grid' : 'Analysis Map mode: items positioned by similarity'}
              <br />
              <em>Grid layout is now controlled by Display Mode above</em>
            </div>
          </div>

          {/* Similarity Weighting */}
          <div className="px-3 py-2">
            <div className="text-xs font-semibold text-[var(--vscode-descriptionForeground)] uppercase tracking-wide mb-2">
              Similarity Weighting
            </div>
            <label className="block text-xs text-[var(--vscode-descriptionForeground)] mb-1">
              Text vs Variables (α is text weight)
            </label>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={similarityAlpha}
              onChange={(e) => {
                const next = parseFloat(e.target.value);
                setSimilarityAlpha(next);
                try { window.localStorage.setItem('similarity_alpha', String(next)); } catch {}
                try {
                  const dbg = localStorage.getItem('debug_similarity') === '1' || localStorage.getItem('debug_umap') === '1';
                  if (dbg) {
                    console.info('[similarity][ui] slider changed: alpha(text)=', next.toFixed(2), 'varWeight=', (1 - next).toFixed(2));
                  }
                } catch {}
                // Notify any listeners that similarity config changed
                window.dispatchEvent(new CustomEvent('similarityConfigChanged', { detail: { alpha: next } }));
              }}
              className="w-full"
              aria-label="Text vs Variables similarity (alpha is text weight)"
            />
            <div className="flex justify-between text-xs text-[var(--vscode-descriptionForeground)]">
              <span>Variables</span>
              <span>α(text) = {similarityAlpha.toFixed(2)}</span>
              <span>CellQL</span>
            </div>
          </div>

          {/* Separator */}
          <div className="border-t border-[var(--vscode-dropdown-border)] my-1" />

          {/* Rerun UMAP */}
          <button
            onClick={handleRerunUMAP}
            disabled={isRerunningUMAP}
            className="
              w-full text-left px-3 py-2 text-sm
              text-[var(--vscode-dropdown-foreground)]
              hover:bg-[var(--vscode-list-hoverBackground)]
              disabled:opacity-50 disabled:cursor-not-allowed
              transition-colors duration-150
              flex items-center space-x-2
            "
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2v1z"/>
              <path d="M8 4.466V.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384L8.41 4.658A.25.25 0 0 1 8 4.466z"/>
            </svg>
            <span>{isRerunningUMAP ? 'Rerunning UMAP...' : 'Rerun UMAP'}</span>
          </button>

          {/* Generate Random Analets */}
          <button
            onClick={handleGenerateRandomAnalets}
            className="
              w-full text-left px-3 py-2 text-sm
              text-[var(--vscode-dropdown-foreground)]
              hover:bg-[var(--vscode-list-hoverBackground)]
              transition-colors duration-150
              flex items-center space-x-2
            "
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <path d="M2 2h2l2 4 2-4h2l2 4 2-4h2l-3 6 3 6h-2l-2-4-2 4h-2l-2-4-2 4H2l3-6L2 2z" />
            </svg>
            <span>Generate Random Analets</span>
          </button>

          {/* Separator */}
          <div className="border-t border-[var(--vscode-dropdown-border)] my-1" />

          {/* Export Data */}
          <button
            onClick={handleExportData}
            className="
              w-full text-left px-3 py-2 text-sm
              text-[var(--vscode-dropdown-foreground)]
              hover:bg-[var(--vscode-list-hoverBackground)]
              transition-colors duration-150
              flex items-center space-x-2
            "
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <path d="M.5 9.9a.5.5 0 0 1 .5.5v2.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2.5a.5.5 0 0 1 1 0v2.5a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2v-2.5a.5.5 0 0 1 .5-.5z"/>
              <path d="M7.646 1.146a.5.5 0 0 1 .708 0l3 3a.5.5 0 0 1-.708.708L8.5 2.707V11.5a.5.5 0 0 1-1 0V2.707L5.354 4.854a.5.5 0 1 1-.708-.708l3-3z"/>
            </svg>
            <span>Export Data</span>
          </button>

          {/* Open Past Study Workspaces */}
          <button
            onClick={handleOpenPastWorkspaces}
            className="
              w-full text-left px-3 py-2 text-sm
              text-[var(--vscode-dropdown-foreground)]
              hover:bg-[var(--vscode-list-hoverBackground)]
              transition-colors duration-150
              flex items-center space-x-2
            "
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <path d="M10.5 7a.5.5 0 0 1 .5.5V9h3.5a.5.5 0 0 1 0 1H11v1.5a.5.5 0 0 1-1 0V10H6.5a.5.5 0 0 1 0-1H10V7.5a.5.5 0 0 1 .5-.5z"/>
              <path d="M2 2h12a2 2 0 0 1 2 2v3h-1V4a1 1 0 0 0-1-1H2a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h6v1H2a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z"/>
            </svg>
            <span>Open Past Study Workspaces</span>
          </button>

          {/* Separator */}
          <div className="border-t border-[var(--vscode-dropdown-border)] my-1" />

          {/* Reset Study UI State */}
          {isStudyMode && (
            <button
              onClick={handleResetStudyUI}
              className="
                w-full text-left px-3 py-2 text-sm
                text-[var(--vscode-dropdown-foreground)]
                hover:bg-[var(--vscode-list-hoverBackground)]
                transition-colors duration-150
                flex items-center space-x-2
              "
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                <path d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2v1z"/>
                <path d="M8 4.466V.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384L8.41 4.658A.25.25 0 0 1 8 4.466z"/>
              </svg>
              <span>Reset Study UI State</span>
            </button>
          )}

          {/* Purge Data */}
          <button
            onClick={handlePurgeData}
            className="
              w-full text-left px-3 py-2 text-sm
              text-[var(--vscode-errorForeground)]
              hover:bg-[var(--vscode-list-errorForeground)]
              hover:bg-opacity-10
              transition-colors duration-150
              flex items-center space-x-2
            "
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z"/>
              <path fillRule="evenodd" d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"/>
            </svg>
            <span>Purge All Data</span>
          </button>
        </div>
      )}
    </div>
  );
}; 
