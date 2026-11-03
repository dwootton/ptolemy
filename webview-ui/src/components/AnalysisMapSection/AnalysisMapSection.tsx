import React from "react";
import { AnalysisMap } from "../AnalysisMap";
import { Analet, AnalysisComponent, Bearing } from "../../types/analet";
import { ConstraintService } from "../../services/ConstraintService";
import { StateService } from "../../services/StateService";
import { useAnimatedDots } from "../../hooks/useAnimatedDots";
import { MessageService } from "../../services/MessageService";

interface SharedSelection {
  selectionState: { selectedAnaletIds: Set<number>; selectedBearingIds: Set<number>; lastSelectedId?: number; lastSelectedType?: 'analet' | 'bearing'; hoveredAnaletId?: number; hoveredBearingId?: number };
  selectAnalet: (analetId: number, multiSelect?: boolean, rangeSelect?: boolean, analetList?: Analet[]) => void;
  selectBearing: (bearingId: number, multiSelect?: boolean, rangeSelect?: boolean, bearingList?: Bearing[]) => void;
  clearSelection: () => void;
  isAnaletSelected: (analetId: number) => boolean;
  isBearingSelected: (bearingId: number) => boolean;
  getSelectedCount: () => number;
  getSelectedAnalets: (analets: Analet[]) => Analet[];
  getSelectedBearings: (bearings: Bearing[]) => Bearing[];
  setHoveredAnalet: (analetId: number | undefined) => void;
  setHoveredBearing: (bearingId: number | undefined) => void;
  getHoveredAnaletId: () => number | undefined;
  getHoveredBearingId: () => number | undefined;
}

interface AnalysisMapSectionProps {
  projectedAnalets?: Analet[];
  analysisComponents?: AnalysisComponent[];
  visibleComponents?: AnalysisComponent[];
  isLoading?: boolean;
  loadingMessage?: string;
  padding?: number;
  onAnaletClick?: (analet: Analet) => void;
  sharedSelection?: SharedSelection;
  constraintService?: ConstraintService;
  onAnaletDragEnd?: (analet: Analet, newPosition: { x: number; y: number }) => void;
  selectedFolderName?: string | null;
  onCreateFolderFromCluster?: (analetIds: number[], folderName: string) => void;
  clusterFolderState?: {
    isLoading: boolean;
    progress: string | null;
  };
  stateService?: StateService;
  // Auto-tracking props
  isTrackingEnabled?: boolean;
  onTrackingToggle?: (enabled: boolean) => void;
  // Note editing callback
  onNoteEditingChange?: (isEditing: boolean, targetAnalet: Analet | null, content: string) => void;
}

export const AnalysisMapSection: React.FC<AnalysisMapSectionProps> = ({
  projectedAnalets = [],
  analysisComponents,
  visibleComponents,
  isLoading = false,
  // retain prop for API compatibility, not displayed in simplified loader
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  loadingMessage: _loadingMessage = "",
  padding = 20,
  onAnaletClick,
  sharedSelection,
  constraintService,
  onAnaletDragEnd,
  selectedFolderName,
  onCreateFolderFromCluster,
  clusterFolderState,
  stateService,
  isTrackingEnabled,
  onTrackingToggle,
  onNoteEditingChange
}) => {
  const handleAnaletClick = (analet: Analet) => {
    if (onAnaletClick) {
      onAnaletClick(analet);
    }
  };

  const dots = useAnimatedDots(400, 3);
  const handleRefresh = () => {
    try {
      console.log('[framing][webview] Refresh clicked: requesting generate-analyses');
      const msg = MessageService.getInstance();
      msg.sendMessage('generate-analyses', { forceGenerate: false });
    } catch (e) {
      console.error('❌ [AnalysisMapSection] Failed to refresh analyses:', e);
    }
  };

  return (
    <div 
      className="w-full h-full min-w-0 border border-gray-300 rounded-lg overflow-hidden bg-white flex flex-col"
    >
      <div className="w-full h-full min-w-0 flex-1 flex flex-col">
          {isLoading ? (
            <div 
              className="flex flex-col items-center justify-center w-full h-full bg-[var(--vscode-editor-background)] text-center space-y-2"
            >
              <div className="animate-spin rounded-full h-4 w-4 border border-[var(--vscode-descriptionForeground)] border-t-transparent" />
              <div className="text-[var(--vscode-descriptionForeground)]">
                <span className="text-sm">
                  Preparing analysis
                  <span className="inline-block align-baseline" style={{ minWidth: '3ch' }}>{dots}</span>
                </span>
              </div>
              <div>
                <button
                  onClick={handleRefresh}
                  className="px-2 py-1 rounded bg-[var(--vscode-button-background)] text-[var(--vscode-button-foreground)] hover:bg-[var(--vscode-button-hoverBackground)] text-xs"
                >
                  Refresh
                </button>
              </div>
            </div>
          ) : (
            <AnalysisMap
              projectedAnalets={projectedAnalets}
              analysisComponents={analysisComponents || visibleComponents}
              padding={padding}
              onAnaletClick={handleAnaletClick}
              sharedSelection={sharedSelection}
              constraintService={constraintService}
              onAnaletDragEnd={onAnaletDragEnd}
              selectedFolderName={selectedFolderName}
              onCreateFolderFromCluster={onCreateFolderFromCluster}
              clusterFolderState={clusterFolderState}
              stateService={stateService}
              isTrackingEnabled={isTrackingEnabled}
              onTrackingToggle={onTrackingToggle}
              onNoteEditingChange={onNoteEditingChange}
            />
          )}
        </div>
      </div>
  );
};
