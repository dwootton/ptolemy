import React, { useState, useCallback, useEffect } from 'react';
import { OverlaysIcon } from '../../Icons/OverlaysIcon';
import { AutoTrackIcon } from '../../Icons/AutoTrackIcon';
import { AddNoteIcon } from '../../Icons/AddNoteIcon';
import { EmbeddingCursorIcon } from '../../Icons/EmbeddingCursorIcon';

interface MapOverlayPanelProps {
  isTrackingEnabled: boolean;
  isEmbeddingCursorEnabled: boolean;
  onTrackingToggle: (enabled: boolean) => void;
  onEmbeddingCursorToggle: (enabled: boolean) => void;
  onGenerateRandomAnalets: () => void;
}

export const MapOverlayPanel: React.FC<MapOverlayPanelProps> = ({
  isTrackingEnabled,
  isEmbeddingCursorEnabled,
  onTrackingToggle,
  onEmbeddingCursorToggle,
  // onGenerateRandomAnalets
}) => {
  

  // Hierarchy cursor toggle removed from map overlay per design

  const [isCollapsed, setIsCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem('mapOverlayCollapsed') === '1'; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem('mapOverlayCollapsed', isCollapsed ? '1' : '0'); } catch {}
  }, [isCollapsed]);

  // const handleHierarchyToggle = useCallback(() => {}, []);

  const handleAddNoteAtCenter = useCallback(() => {
    try { window.dispatchEvent(new CustomEvent('addMapNoteAtCenter')); } catch {}
  }, []);

  return (
    <div className="absolute top-4 right-4 z-50">
      {isCollapsed ? (
        <button
          className="p-2 rounded-md bg-[var(--vscode-editor-background)] border border-[var(--vscode-widget-border)] shadow"
          onClick={() => setIsCollapsed(false)}
          title="Show overlays"
          aria-label="Show overlays"
        >
          <OverlaysIcon className="w-4 h-4" />
        </button>
      ) : (
        <div className="bg-[var(--vscode-editor-background)] border border-[var(--vscode-widget-border)] rounded-lg shadow-lg p-2" style={{ backdropFilter: 'blur(8px)' }}>
          <div className="flex items-center justify-between mb-1">
            {/* <span className="text-xs font-semibold text-[var(--vscode-descriptionForeground)] uppercase tracking-wide">Overlays</span> */}
            <button
              className="p-1 rounded hover:bg-[var(--vscode-list-hoverBackground)]"
              onClick={() => setIsCollapsed(true)}
              title="Hide overlays"
              aria-label="Hide overlays"
            >
              <svg width="12" height="12" viewBox="0 0 20 20" fill="currentColor"><path d="M5 8l5 5 5-5H5z"/></svg>
            </button>
          </div>
          <div className="flex flex-col gap-2">
            <button
              className={`w-8 h-8 flex items-center justify-center rounded-md transition-all duration-200 ${isTrackingEnabled ? 'bg-[var(--vscode-button-background)] text-[var(--vscode-button-foreground)]' : 'bg-[var(--vscode-button-background)] text-[var(--vscode-button-secondaryForeground)] hover:bg-[var(--vscode-list-hoverBackground)]'}`}
              onClick={() => onTrackingToggle(!isTrackingEnabled)}
              title="Toggle auto track"
              aria-label="Toggle auto track"
            >
              <AutoTrackIcon enabled={isTrackingEnabled} />
            </button>
            <button
              className={`w-8 h-8 flex items-center justify-center rounded-md transition-all duration-200 ${isEmbeddingCursorEnabled ? 'bg-[var(--vscode-button-background)] text-[var(--vscode-button-foreground)]' : 'bg-[var(--vscode-button-background)] text-[var(--vscode-button-secondaryForeground)] hover:bg-[var(--vscode-list-hoverBackground)]'}`}
              onClick={() => onEmbeddingCursorToggle(!isEmbeddingCursorEnabled)}
              title="Toggle embedding cursor"
              aria-label="Toggle embedding cursor"
            >
              <EmbeddingCursorIcon />
            </button>
            <button
              className="w-8 h-8 flex items-center justify-center rounded-md transition-all duration-200 bg-[var(--vscode-button-background)] text-[var(--vscode-button-foreground)] hover:bg-[var(--vscode-button-hoverBackground)]"
              onClick={handleAddNoteAtCenter}
              title="Add note at map center"
              aria-label="Add note at map center"
            >
              <AddNoteIcon />
            </button>
            {/* Generate random analets removed from map overlay */}
          </div>
        </div>
      )}
    </div>
  );
}; 