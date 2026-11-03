import React, { useEffect, useState } from 'react';
import { useFilterInstrumentation } from '../../hooks/useInstrumentation';

interface FilterBarProps {
  filterText: string;
  onFilterTextChange: (text: string) => void;
  hideUnexplored: boolean;
  onToggleHideUnexplored: (value: boolean) => void;
}

export const FilterBar: React.FC<FilterBarProps> = ({
  filterText,
  onFilterTextChange,
  hideUnexplored,
  onToggleHideUnexplored,
}) => {
  const { trackInputChange, trackClick, trackFocus } = useFilterInstrumentation();
  const [localText, setLocalText] = useState<string>(filterText || '');

  useEffect(() => {
    setLocalText(filterText || '');
  }, [filterText]);

  useEffect(() => {
    const t = setTimeout(() => {
      if (localText !== filterText) {
        // Track filter application
        trackInputChange('filter_text', localText, {
          previousText: filterText,
          textLength: localText.length,
          hasQuery: localText.trim().length > 0
        });
        onFilterTextChange(localText);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [localText, filterText, onFilterTextChange, trackInputChange]);

  return (
    <div className="flex items-center justify-between gap-2 px-2 py-2 border-b border-[var(--vscode-panel-border)] bg-[var(--vscode-editor-background)] rounded">
      <input
        value={localText}
        onChange={(e) => setLocalText(e.target.value)}
        onFocus={() => trackFocus('filter_input')}
        placeholder="Filter analyses..."
        className="flex-1 text-xs px-2 py-1 rounded bg-[var(--vscode-input-background)] text-[var(--vscode-input-foreground)] placeholder-[var(--vscode-input-placeholderForeground)] border border-[var(--vscode-input-border)] focus:outline-none focus:ring-1 focus:ring-[var(--vscode-focusBorder)]"
        aria-label="Filter analyses"
      />
      <div className="flex items-center gap-2">
        <button
          onClick={() => {
            trackClick('toggle_hide_unexplored', { 
              newValue: !hideUnexplored,
              previousValue: hideUnexplored
            });
            onToggleHideUnexplored(!hideUnexplored);
          }}
          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
            hideUnexplored
              ? 'bg-[var(--vscode-button-background)]'
              : 'bg-[var(--vscode-panel-border)]'
          }`}
          title="Toggle to hide non-materialized analets"
          aria-pressed={hideUnexplored}
        >
          <span
            className={`inline-block h-3.5 w-3.5 transform rounded-full bg-[var(--vscode-button-foreground)] shadow transition-transform ${
              hideUnexplored ? 'translate-x-5' : 'translate-x-1'
            }`}
          />
        </button>
        <span className="text-[10px] text-[var(--vscode-descriptionForeground)] opacity-70">
          {hideUnexplored ? 'Show Unexplored' : 'Hide Unexplored'}
        </span>
      </div>
    </div>
  );
};



