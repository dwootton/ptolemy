import React, { useState, useEffect, useCallback } from 'react';
import { MessageService } from '../../services/MessageService';
import './NotebookSyncModal.css';

interface CellData {
  cellId: string;
  cellIndex: number;
  cellType: 'code' | 'markdown' | 'raw';
  isSynced: boolean;
  syncType: 'auto' | 'manual';
  analetId?: number;
  preview?: string; // First few lines of cell content
}

interface NotebookData {
  path: string;
  name: string;
  totalCells: number;
  cellsWithAnalets: number;
  syncedCellCount: number;
  cells: CellData[];
}

interface SyncStats {
  totalNotebooks: number;
  totalCells: number;
  syncedCells: number;
  autoCells: number;
  manualCells: number;
}

interface HierarchyData {
  notebooks: NotebookData[];
  totalCells: number;
}

interface NotebookSyncModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const NotebookSyncModal: React.FC<NotebookSyncModalProps> = ({
  isOpen,
  onClose
}) => {
  // State
  const [isLoading, setIsLoading] = useState(true);
  const [hierarchy, setHierarchy] = useState<HierarchyData | null>(null);
  const [syncStats, setSyncStats] = useState<SyncStats | null>(null);
  const [expandedNotebooks, setExpandedNotebooks] = useState<Set<string>>(new Set());
  const [pendingChanges, setPendingChanges] = useState<Map<string, CellData>>(new Map());
  const [isSaving, setIsSaving] = useState(false);
  const [refreshingCells, setRefreshingCells] = useState<Set<string>>(new Set());
  const [lastRefreshResults, setLastRefreshResults] = useState<Map<string, { status: 'success' | 'nochange' | 'error'; message?: string }>>(new Map());

  // Services
  const messageService = MessageService.getInstance();

  // Load data when modal opens
  useEffect(() => {
    if (isOpen) {
      loadSyncModalData();
    } else {
      // Reset state when modal closes
      setHierarchy(null);
      setSyncStats(null);
      setExpandedNotebooks(new Set());
      setPendingChanges(new Map());
    }
  }, [isOpen]);

  // Message listeners
  useEffect(() => {
    const unsubscribe1 = messageService.onMessage('sync-modal-loaded', (data: any) => {
      if (data.success) {
        setHierarchy(data.hierarchy);
        setSyncStats(data.syncStats);
        setIsLoading(false);
      } else {
        console.error('Failed to load sync modal data:', data.error);
        setIsLoading(false);
      }
    });

    const unsubscribe2 = messageService.onMessage('sync-config-saved', (data: any) => {
      setIsSaving(false);
      if (data.success) {
        setPendingChanges(new Map()); // Clear pending changes
        setSyncStats(data.syncStats); // Update stats
        onClose(); // Close modal on successful save
      } else {
        console.error('Failed to save sync configuration:', data.message);
      }
    });

    const unsubscribe3 = messageService.onMessage('cell-sync-toggled', (data: any) => {
      if (data.success) {
        // Update local state immediately for responsive UI
        updateCellSyncState(data.notebookPath, data.cellId, data.isEnabled, data.syncType);
      }
    });

    const unsubscribe4 = messageService.onMessage('sync-single-cell-result', (data: any) => {
      const key = `${data.notebookPath}:${data.cellId}`;
      // Clear spinner
      setRefreshingCells(prev => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });

      if (!data.success) {
        console.error('[NotebookSyncModal] Single-cell refresh failed:', data.error || data);
        setLastRefreshResults(prev => {
          const next = new Map(prev);
          next.set(key, { status: 'error', message: data.error || 'Refresh failed' });
          return next;
        });
        return;
      }

      // Update analet badge inline if present
      if (hierarchy && typeof data.analetId === 'number') {
        setHierarchy(prev => {
          if (!prev) return prev;
          const updated = {
            ...prev,
            notebooks: prev.notebooks.map(n => {
              if (n.path !== data.notebookPath) return n;
              const newCells = n.cells.map((c: any) => c.cellId === data.cellId ? { ...c, analetId: data.analetId } : c);
              return { ...n, cells: newCells };
            })
          } as any;
          return updated;
        });
      }

      // Summarize result for quick visual feedback
      const status: 'success' | 'nochange' = (data.created || data.updated) ? 'success' : 'nochange';
      const message = data.message || (status === 'success' ? 'Analet updated' : 'No changes');
      setLastRefreshResults(prev => {
        const next = new Map(prev);
        next.set(key, { status, message });
        return next;
      });

      if (status === 'nochange' && Array.isArray(data.hypotheses)) {
        console.log('[NotebookSyncModal] No change hypotheses:', data.hypotheses);
      }
    });

    return () => {
      unsubscribe1();
      unsubscribe2();
      unsubscribe3();
      unsubscribe4();
    };
  }, [onClose]);

  const loadSyncModalData = async () => {
    setIsLoading(true);
    try {
      await messageService.sendMessage('load-sync-modal', {
        timestamp: Date.now()
      });
    } catch (error) {
      console.error('Failed to load sync modal data:', error);
      setIsLoading(false);
    }
  };

  const updateCellSyncState = useCallback((
    notebookPath: string, 
    cellId: string, 
    isEnabled: boolean, 
    syncType: 'auto' | 'manual'
  ) => {
    if (!hierarchy) return;

    const updatedHierarchy = {
      ...hierarchy,
      notebooks: hierarchy.notebooks.map(notebook => {
        if (notebook.path === notebookPath) {
          const updatedCells = notebook.cells.map(cell => {
            if (cell.cellId === cellId) {
              return { ...cell, isSynced: isEnabled, syncType };
            }
            return cell;
          });
          
          return {
            ...notebook,
            cells: updatedCells,
            syncedCellCount: updatedCells.filter(c => c.isSynced).length
          };
        }
        return notebook;
      })
    };

    setHierarchy(updatedHierarchy);
  }, [hierarchy]);

  const toggleNotebookExpansion = useCallback((notebookPath: string) => {
    setExpandedNotebooks(prev => {
      const newSet = new Set(prev);
      if (newSet.has(notebookPath)) {
        newSet.delete(notebookPath);
      } else {
        newSet.add(notebookPath);
      }
      return newSet;
    });
  }, []);

  const toggleCellSync = useCallback(async (
    notebookPath: string,
    cellId: string,
    cellIndex: number,
    currentState: boolean
  ) => {
    // Update UI immediately
    const newState = !currentState;
    updateCellSyncState(notebookPath, cellId, newState, 'manual');

    // Track pending change
    const cellKey = `${notebookPath}:${cellId}`;
    const cellData = hierarchy?.notebooks
      .find(n => n.path === notebookPath)?.cells
      .find(c => c.cellId === cellId);
    
    if (cellData) {
      setPendingChanges(prev => {
        const newMap = new Map(prev);
        newMap.set(cellKey, { ...cellData, isSynced: newState, syncType: 'manual' });
        return newMap;
      });
    }

    // Send message to backend
    try {
      await messageService.sendMessage('toggle-cell-sync', {
        notebookPath,
        cellId,
        cellIndex
      });
    } catch (error) {
      console.error('Failed to toggle cell sync:', error);
      // Revert UI state on error
      updateCellSyncState(notebookPath, cellId, currentState, 'manual');
    }
  }, [hierarchy, updateCellSyncState]);

  const refreshSingleCell = useCallback(async (
    notebookPath: string,
    cellId: string,
    cellIndex: number
  ) => {
    const key = `${notebookPath}:${cellId}`;
    // Optimistic spinner
    setRefreshingCells(prev => new Set(prev).add(key));
    setLastRefreshResults(prev => {
      const next = new Map(prev);
      next.delete(key);
      return next;
    });
    try {
      console.log('[NotebookSyncModal] Requesting single-cell refresh', { notebookPath, cellId, cellIndex });
      await messageService.sendMessage('sync-single-cell', { notebookPath, cellId, cellIndex, timestamp: Date.now() });
    } catch (e) {
      console.error('[NotebookSyncModal] Failed to request single-cell refresh', e);
      setRefreshingCells(prev => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
      setLastRefreshResults(prev => {
        const next = new Map(prev);
        next.set(key, { status: 'error', message: 'Request failed' });
        return next;
      });
    }
  }, [messageService]);

  const handleSave = useCallback(async () => {
    if (pendingChanges.size === 0) {
      onClose();
      return;
    }

    setIsSaving(true);

    // Convert pending changes to config array
    const configs = Array.from(pendingChanges.entries()).map(([cellKey, cellData]) => {
      const [notebookPath] = cellKey.split(':');
      return {
        notebookPath,
        cellId: cellData.cellId,
        cellIndex: cellData.cellIndex,
        isEnabled: cellData.isSynced,
        syncType: cellData.syncType
      };
    });

    try {
      await messageService.sendMessage('save-sync-config', {
        configs,
        timestamp: Date.now()
      });
    } catch (error) {
      console.error('Failed to save sync configuration:', error);
      setIsSaving(false);
    }
  }, [pendingChanges, onClose]);

  const handleCancel = useCallback(() => {
    setPendingChanges(new Map());
    onClose();
  }, [onClose]);

  // Don't render if not open
  if (!isOpen) {
    return null;
  }

  return (
    <div className="notebook-sync-modal-overlay">
      <div className="notebook-sync-modal">
        {/* Header */}
        <div className="modal-header">
          <h2>Configure Notebook Cell Sync</h2>
          <button 
            className="modal-close-button"
            onClick={handleCancel}
            aria-label="Close modal"
          >
            ✕
          </button>
        </div>

        {/* Stats Summary */}
        {syncStats && (
          <div className="sync-stats-summary">
            <div className="stat-item">
              <span className="stat-value">{syncStats.syncedCells}</span>
              <span className="stat-label">Synced Cells</span>
            </div>
            <div className="stat-item">
              <span className="stat-value">{syncStats.totalNotebooks}</span>
              <span className="stat-label">Notebooks</span>
            </div>
            <div className="stat-item">
              <span className="stat-value">{syncStats.autoCells}</span>
              <span className="stat-label">Auto-sync</span>
            </div>
            <div className="stat-item">
              <span className="stat-value">{syncStats.manualCells}</span>
              <span className="stat-label">Manual</span>
            </div>
          </div>
        )}

        {/* Content */}
        <div className="modal-content">
          {isLoading ? (
            <div className="loading-state">
              <div className="loading-spinner"></div>
              <span>Loading notebook hierarchy...</span>
            </div>
          ) : hierarchy?.notebooks.length === 0 ? (
            <div className="empty-state">
              <p>No notebooks found in the workspace.</p>
              <p className="empty-state-hint">
                Create some Jupyter notebooks (.ipynb files) to get started with sync.
              </p>
            </div>
          ) : (
            <div className="notebooks-tree">
              {hierarchy?.notebooks.map(notebook => {
                const isExpanded = expandedNotebooks.has(notebook.path);
                const codeCells = notebook.cells.filter(cell => cell.cellType === 'code');
                
                return (
                  <div key={notebook.path} className="notebook-item">
                    {/* Notebook Header */}
                    <div 
                      className="notebook-header"
                      onClick={() => toggleNotebookExpansion(notebook.path)}
                    >
                      <div className="notebook-expand">
                        <span className={`expand-icon ${isExpanded ? 'expanded' : ''}`}>
                          ▶
                        </span>
                      </div>
                      
                      <div className="notebook-info">
                        <div className="notebook-name">{notebook.name}</div>
                        <div className="notebook-meta">
                          {codeCells.length} code cells • {notebook.syncedCellCount} synced
                        </div>
                      </div>

                      <div className="notebook-actions">
                        <button
                          className={`bulk-toggle-button ${notebook.syncedCellCount === codeCells.length ? 'all-synced' : ''}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            // TODO: Implement bulk toggle for all cells in notebook
                          }}
                          title={notebook.syncedCellCount === codeCells.length ? 'Disable all' : 'Enable all'}
                        >
                          {notebook.syncedCellCount === codeCells.length ? '☑' : '☐'} All
                        </button>
                      </div>
                    </div>

                    {/* Cells List */}
                    {isExpanded && (
                      <div className="cells-list">
                        {codeCells.map((cell) => (
                          <div 
                            key={cell.cellId} 
                            className="cell-item"
                            onClick={() => {
                              try {
                                messageService.sendMessage('open-notebook-cell', {
                                  notebookPath: notebook.path,
                                  cellId: cell.cellId,
                                  cellIndex: cell.cellIndex
                                });
                              } catch (e) {
                                console.error('Failed to request open-notebook-cell', e);
                              }
                            }}
                          >
                            <div className="cell-checkbox">
                              <input
                                type="checkbox"
                                checked={cell.isSynced}
                                onChange={() => toggleCellSync(
                                  notebook.path,
                                  cell.cellId,
                                  cell.cellIndex,
                                  cell.isSynced
                                )}
                              />
                            </div>
                            
                            <div className="cell-info">
                              <div className="cell-identifier">
                                Cell {cell.cellIndex + 1}
                                {cell.analetId && (
                                  <span className="analet-badge">
                                    Analet #{cell.analetId}
                                  </span>
                                )}
                                <span className={`sync-type-badge ${cell.syncType}`}>
                                  {cell.syncType}
                                </span>
                                <button
                                  className="ml-2 text-xs px-2 py-0.5 rounded bg-[var(--vscode-button-background)] text-[var(--vscode-button-foreground)] hover:bg-[var(--vscode-button-hoverBackground)]"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    refreshSingleCell(notebook.path, cell.cellId, cell.cellIndex);
                                  }}
                                  disabled={refreshingCells.has(`${notebook.path}:${cell.cellId}`)}
                                  title="Refresh just this cell"
                                >
                                  {refreshingCells.has(`${notebook.path}:${cell.cellId}`) ? 'Refreshing…' : 'Refresh'}
                                </button>
                              </div>
                              
                              {cell.preview && (
                                <div className="cell-preview">
                                  {cell.preview}
                                </div>
                              )}
                              {(() => {
                                const key = `${notebook.path}:${cell.cellId}`;
                                const res = lastRefreshResults.get(key);
                                if (!res) return null;
                                return (
                                  <div className="text-xs mt-1"
                                    style={{ color: res.status === 'success' ? 'var(--vscode-testing-iconPassed)' : (res.status === 'nochange' ? 'var(--vscode-descriptionForeground)' : 'var(--vscode-errorForeground)') }}
                                  >
                                    {res.message}
                                  </div>
                                );
                              })()}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="modal-footer">
          <div className="footer-info">
            {pendingChanges.size > 0 && (
              <span className="pending-changes">
                {pendingChanges.size} pending change{pendingChanges.size !== 1 ? 's' : ''}
              </span>
            )}
          </div>
          
          <div className="footer-actions">
            <button
              className="cancel-button"
              onClick={handleCancel}
              disabled={isSaving}
            >
              Cancel
            </button>
            
            <button
              className="save-button"
              onClick={handleSave}
              disabled={isSaving}
            >
              {isSaving ? 'Saving...' : 'Save Configuration'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
