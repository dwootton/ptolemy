import React, { useState } from 'react';
import { DetectedCluster } from '../../utilities/clusterDetection';

interface ClusterAcceptDialogProps {
  cluster: DetectedCluster | null;
  onAccept: (cluster: DetectedCluster, folderName: string) => void;
  onCancel: () => void;
  isLoading?: boolean;
  loadingProgress?: string | null;
}

export const ClusterAcceptDialog: React.FC<ClusterAcceptDialogProps> = ({
  cluster,
  onAccept,
  onCancel,
  isLoading = false,
  loadingProgress = null
}) => {
  const [customName, setCustomName] = useState('');
  
  if (!cluster) return null;
  
  const finalName = customName.trim() || cluster.suggestedName || 'Analysis Cluster';
  
  return (
    <div 
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
      onClick={onCancel}
    >
      <div 
        className="bg-[var(--vscode-editor-background)] border border-[var(--vscode-panel-border)] rounded-lg p-6 max-w-md w-full mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4">
          <h3 className="text-lg font-semibold text-[var(--vscode-foreground)] mb-2">
            Create Folder from Cluster
          </h3>
          <p className="text-sm text-[var(--vscode-descriptionForeground)]">
            We detected a cluster of {cluster.points.length} related analets. 
            Would you like to create a folder for them?
          </p>
        </div>
        
        <div className="mb-4">
          <label className="block text-sm font-medium text-[var(--vscode-foreground)] mb-2">
            Folder Name
          </label>
          <input
            type="text"
            value={customName}
            onChange={(e) => setCustomName(e.target.value)}
            placeholder={cluster.suggestedName || 'Analysis Cluster'}
            className="w-full px-3 py-2 bg-[var(--vscode-input-background)] border border-[var(--vscode-input-border)] rounded text-[var(--vscode-input-foreground)] text-sm focus:outline-none focus:border-[var(--vscode-focusBorder)]"
            autoFocus
          />
        </div>
        
        <div className="mb-4">
          <div className="text-xs text-[var(--vscode-descriptionForeground)] mb-2">
            Analets in this cluster:
          </div>
          <div className="max-h-32 overflow-y-auto bg-[var(--vscode-textCodeBlock-background)] rounded p-2">
            {cluster.points.map((point, index) => (
              <div key={point.analet.id} className="text-xs text-[var(--vscode-foreground)] mb-1">
                {index + 1}. {(point.analet.shortName || point.analet.statement).substring(0, 60)}
                {(point.analet.shortName || point.analet.statement).length > 60 && '...'}
              </div>
            ))}
          </div>
        </div>
        
        {/* Loading progress */}
        {isLoading && (
          <div className="mb-4 p-3 bg-[var(--vscode-textCodeBlock-background)] rounded">
            <div className="flex items-center gap-2 text-sm text-[var(--vscode-foreground)]">
              <div className="animate-spin rounded-full h-4 w-4 border-2 border-[var(--vscode-charts-blue)] border-t-transparent"></div>
              <span>{loadingProgress || 'Creating folder...'}</span>
            </div>
          </div>
        )}
        
        <div className="flex gap-3 justify-end">
          <button
            onClick={onCancel}
            disabled={isLoading}
            className="px-4 py-2 text-sm bg-[var(--vscode-button-background)] text-[var(--vscode-button-secondaryForeground)] hover:bg-[var(--vscode-button-secondaryHoverBackground)] disabled:opacity-50 disabled:cursor-not-allowed rounded"
          >
            Cancel
          </button>
          <button
            onClick={() => onAccept(cluster, finalName)}
            disabled={isLoading}
            className="px-4 py-2 text-sm bg-[var(--vscode-button-background)] text-[var(--vscode-button-foreground)] hover:bg-[var(--vscode-button-hoverBackground)] disabled:opacity-50 disabled:cursor-not-allowed rounded flex items-center gap-2"
          >
            {isLoading ? (
              <>
                <div className="animate-spin rounded-full h-3 w-3 border-2 border-[var(--vscode-button-foreground)] border-t-transparent"></div>
                Creating...
              </>
            ) : (
              'Create Folder'
            )}
          </button>
        </div>
      </div>
    </div>
  );
};