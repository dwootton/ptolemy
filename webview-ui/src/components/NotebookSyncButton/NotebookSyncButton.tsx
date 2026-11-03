import React, { useState, useEffect } from 'react';
import { MessageService } from '../../services/MessageService';
import { useNotebookSyncConfig } from '../../hooks/useNotebookSyncConfig';
import { NotebookSyncModal } from '../NotebookSyncModal';
import './NotebookSyncButton.css';

interface NotebookSyncButtonProps {
  className?: string;
  variant?: 'full' | 'icon';
}

interface SyncStatus {
  isScanning: boolean;
  lastSync: string | null;
  changedCells: number;
  newAnalets: number;
  updatedAnalets: number;
}

export const NotebookSyncButton: React.FC<NotebookSyncButtonProps> = (props) => {
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({
    isScanning: false,
    lastSync: null,
    changedCells: 0,
    newAnalets: 0,
    updatedAnalets: 0
  });

  const [showDetails, setShowDetails] = useState(false);

  // Use sync config hook
  const {
    syncStats,
    isModalOpen,
    openSyncModal,
    closeSyncModal,
    getSyncSummary,
    hasSyncConfig,
    getSyncEfficiency
  } = useNotebookSyncConfig();

  useEffect(() => {
    const messageService = MessageService.getInstance();
    
    // Listen for sync status updates
    const unsubscribe1 = messageService.onMessage('notebook-sync-status', (data: any) => {
      setSyncStatus(prev => ({ ...prev, ...data }));
    });

    // Listen for sync completion
    const unsubscribe2 = messageService.onMessage('notebook-sync-complete', (data: any) => {
      setSyncStatus(prev => ({
        ...prev,
        isScanning: false,
        lastSync: new Date().toLocaleTimeString(),
        changedCells: data.changedCells || 0,
        newAnalets: data.newAnalets || 0,
        updatedAnalets: data.updatedAnalets || 0
      }));
      
      // Auto-hide details after 3 seconds
      setShowDetails(true);
      setTimeout(() => setShowDetails(false), 3000);
    });

    return () => {
      unsubscribe1();
      unsubscribe2();
    };
  }, []);

  const handleSync = async () => {
    if (syncStatus.isScanning) return;
    setSyncStatus(prev => ({
      ...prev,
      isScanning: true,
      changedCells: 0,
      newAnalets: 0,
      updatedAnalets: 0
    }));

    try {
      const messageService = MessageService.getInstance();
      await messageService.sendMessage('sync-configured-cells', {
        timestamp: Date.now()
      });
    } catch (error) {
      console.error('❌ [NotebookSyncButton] Sync failed:', error);
      setSyncStatus(prev => ({ ...prev, isScanning: false }));
    }
  };

  const toggleDetails = () => {
    setShowDetails(!showDetails);
  };

  const handleConfigureSync = () => {
    openSyncModal();
  };

  // Allow opening sync config from Settings menu
  useEffect(() => {
    const handler = () => openSyncModal();
    // @ts-ignore custom event name
    window.addEventListener('openSyncConfig', handler as any);
    return () => {
      // @ts-ignore custom event name
      window.removeEventListener('openSyncConfig', handler as any);
    };
  }, [openSyncModal]);

  // Tooltip with last sync results and config info
  const tooltip = syncStatus.isScanning
    ? 'Sync in progress...'
    : (syncStatus.lastSync
        ? `Last sync ${syncStatus.lastSync}: ${syncStatus.changedCells} changed, ${syncStatus.newAnalets} new, ${syncStatus.updatedAnalets} updated. ${getSyncSummary()}`
        : `Sync notebooks. ${getSyncSummary()}`);

  // Icon-only variant for toolbar
  if ((props.variant || 'full') === 'icon') {
    return (
      <div className={`sync-icon-container ${props.className || ''}`}>
        <button
          onClick={handleSync}
          disabled={syncStatus.isScanning}
          title={tooltip}
          className="p-2 rounded bg-[var(--vscode-button-background)] text-[var(--vscode-button-foreground)] hover:bg-[var(--vscode-button-hoverBackground)] transition-colors sync-main-button"
          aria-label="Sync notebooks"
        >
          <svg
            className={`w-4 h-4 ${syncStatus.isScanning ? 'sync-icon-spinning' : ''}`}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="23 4 23 10 17 10" />
            <polyline points="1 20 1 14 7 14" />
            <path d="M3.51 9a9 9 0 0114.13-3.36L23 10M1 14l5.36 4.36A9 9 0 0020.49 15" />
          </svg>
          {hasSyncConfig() && (
            <div className="sync-config-indicator" title={getSyncSummary()} />
          )}
        </button>
        {/* Configure Sync moved to Settings menu */}

        <NotebookSyncModal 
          isOpen={isModalOpen}
          onClose={closeSyncModal}
        />
      </div>
    );
  }

  return (
    <div className={`notebook-sync-container ${props.className || ''}`}>
      <div className="notebook-sync-header">
        <button 
          className={`notebook-sync-button ${syncStatus.isScanning ? 'syncing' : ''}`}
          onClick={handleSync}
          disabled={syncStatus.isScanning}
          title={tooltip}
        >
          <div className="sync-icon">
            {syncStatus.isScanning ? (
              <span className="sync-icon-spinning">⟲</span>
            ) : (
              <span className="sync-icon-static">⟲</span>
            )}
          </div>
          <span className="sync-text">
            {syncStatus.isScanning ? 'Syncing...' : 'SYNC Notebooks'}
          </span>
        </button>

        <div className="sync-header-actions">
          <button
            className="sync-configure-button"
            onClick={handleConfigureSync}
            disabled={syncStatus.isScanning}
            title="Configure which cells to sync"
          >
            ⚙️
          </button>

          {syncStatus.lastSync && !syncStatus.isScanning && (
            <button 
              className="sync-details-toggle"
              onClick={toggleDetails}
              title="Show sync details"
            >
              <span className="sync-time">
                Last: {syncStatus.lastSync}
              </span>
              <span className="details-arrow">
                {showDetails ? '▼' : '▶'}
              </span>
            </button>
          )}
        </div>
      </div>

      {showDetails && syncStatus.lastSync && (
        <div className="sync-details">
          <div className="sync-stats">
            <div className="sync-stat">
              <span className="stat-label">Changed Cells:</span>
              <span className="stat-value">{syncStatus.changedCells}</span>
            </div>
            <div className="sync-stat">
              <span className="stat-label">New Analets:</span>
              <span className="stat-value new">{syncStatus.newAnalets}</span>
            </div>
            <div className="sync-stat">
              <span className="stat-label">Updated:</span>
              <span className="stat-value updated">{syncStatus.updatedAnalets}</span>
            </div>
          </div>
          
          {syncStats && (
            <div className="sync-config-info">
              <div className="config-summary">
                <span className="config-label">Configuration:</span>
                <span className="config-value">{getSyncSummary()}</span>
              </div>
              <div className="config-efficiency">
                <span className="efficiency-label">Efficiency:</span>
                <span className="efficiency-value">{getSyncEfficiency()}%</span>
              </div>
            </div>
          )}
        </div>
      )}

      {syncStatus.isScanning && (
        <div className="sync-progress">
          <div className="progress-bar">
            <div className="progress-fill"></div>
          </div>
          <span className="progress-text">
            Scanning notebooks for changes...
          </span>
        </div>
      )}

      <NotebookSyncModal 
        isOpen={isModalOpen}
        onClose={closeSyncModal}
      />
    </div>
  );
};
