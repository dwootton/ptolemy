/**
 * Context menus for AnalysisMap
 */

// React import not needed for JSX in modern React
import { ContextMenuState, StatementContextMenuState, EmptySpaceContextMenuState } from "../hooks/useMapState";

interface MapContextMenusProps {
  contextMenu: ContextMenuState | null;
  statementContextMenu: StatementContextMenuState | null;
  emptySpaceContextMenu: EmptySpaceContextMenuState | null;
  onTightCluster: () => void;
  onGenerateFromStatement: () => void;
  onAddNote: (analets: any[]) => void;
  onAddNoteToAnalet: (analet: any) => void;
  onAddNoteToMap: (position: { x: number; y: number }) => void;
  onCloseContextMenu: () => void;
  onCloseStatementMenu: () => void;
  onCloseEmptySpaceMenu: () => void;
}

export function MapContextMenus({
  contextMenu,
  statementContextMenu,
  emptySpaceContextMenu,
  onTightCluster,
  onGenerateFromStatement,
  onAddNote,
  onAddNoteToAnalet,
  onAddNoteToMap,
  onCloseContextMenu,
  onCloseStatementMenu,
  onCloseEmptySpaceMenu,
}: MapContextMenusProps) {
  return (
    <>
      {/* Regular context menu for selected analets */}
      {contextMenu && (
        <div
          className="fixed z-50 bg-[var(--vscode-menu-background)] border border-[var(--vscode-menu-border)] rounded-md shadow-lg py-1 min-w-[120px]"
          style={{
            left: contextMenu.x,
            top: contextMenu.y,
          }}
          onMouseLeave={onCloseContextMenu}
        >
          <button
            className="w-full px-3 py-2 text-left text-sm text-[var(--vscode-menu-foreground)] hover:bg-[var(--vscode-menu-selectionBackground)] hover:text-[var(--vscode-menu-selectionForeground)]"
            onClick={onTightCluster}
          >
            🔗 Tight Cluster ({contextMenu.analets.length})
          </button>
          <button
            className="w-full px-3 py-2 text-left text-sm text-[var(--vscode-menu-foreground)] hover:bg-[var(--vscode-menu-selectionBackground)] hover:text-[var(--vscode-menu-selectionForeground)]"
            onClick={() => onAddNote(contextMenu.analets)}
          >
            📝 Add Note {contextMenu.analets.length > 1 ? `(${contextMenu.analets.length} selected)` : ''}
          </button>
        </div>
      )}

      {/* Statement context menu */}
      {statementContextMenu && (
        <div
          className="fixed z-50 bg-[var(--vscode-menu-background)] border border-[var(--vscode-menu-border)] rounded-md shadow-lg py-1 min-w-[160px]"
          style={{
            left: statementContextMenu.x,
            top: statementContextMenu.y,
          }}
          onMouseLeave={onCloseStatementMenu}
        >
          <div className="px-3 py-1 text-xs text-[var(--vscode-descriptionForeground)] border-b border-[var(--vscode-menu-separatorBackground)] mb-1">
            {(statementContextMenu.analet.shortName || statementContextMenu.analet.statement)?.slice(0, 50)}
            {((statementContextMenu.analet.shortName || statementContextMenu.analet.statement)?.length || 0) > 50 ? '...' : ''}
          </div>
          <button
            className="w-full px-3 py-2 text-left text-sm text-[var(--vscode-menu-foreground)] hover:bg-[var(--vscode-menu-selectionBackground)] hover:text-[var(--vscode-menu-selectionForeground)]"
            onClick={onGenerateFromStatement}
          >
            ✨ Generate Analets from Statement
          </button>
          <button
            className="w-full px-3 py-2 text-left text-sm text-[var(--vscode-menu-foreground)] hover:bg-[var(--vscode-menu-selectionBackground)] hover:text-[var(--vscode-menu-selectionForeground)]"
            onClick={() => onAddNoteToAnalet(statementContextMenu.analet)}
          >
            📝 Add Note to Analet
          </button>
        </div>
      )}

      {/* Empty space context menu */}
      {emptySpaceContextMenu && (
        <div
          className="fixed z-50 bg-[var(--vscode-menu-background)] border border-[var(--vscode-menu-border)] rounded-md shadow-lg py-1 min-w-[120px]"
          style={{
            left: emptySpaceContextMenu.x,
            top: emptySpaceContextMenu.y,
          }}
          onMouseLeave={onCloseEmptySpaceMenu}
        >
          <button
            className="w-full px-3 py-2 text-left text-sm text-[var(--vscode-menu-foreground)] hover:bg-[var(--vscode-menu-selectionBackground)] hover:text-[var(--vscode-menu-selectionForeground)]"
            onClick={() => {
              onAddNoteToMap(emptySpaceContextMenu.mapPosition);
            }}
          >
            📝 Add Note
          </button>
        </div>
      )}
    </>
  );
}