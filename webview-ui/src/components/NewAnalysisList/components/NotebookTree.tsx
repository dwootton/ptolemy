import React, { useState, useEffect, useCallback } from 'react';
import { NotebookHierarchyService, NotebookFileNode } from '../../../services/NotebookHierarchyService';
import { Analet } from '../../../types/analet';
import { NotebookItem } from './NotebookItem';
import { NotebookFolderItem } from './NotebookFolderIcon';
import { FileIcon } from './FileIcon';
import { formatFileDate } from '../../../utilities/dateFormatting';

interface NotebookTreeProps {
  onAnaletClick?: (analet: Analet) => void;
  onNotebookOpen?: (path: string) => void;
}

export const NotebookTree: React.FC<NotebookTreeProps> = ({
  onAnaletClick,
  onNotebookOpen
}) => {
  const [hierarchy, setHierarchy] = useState<NotebookFileNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const hierarchyService = NotebookHierarchyService.getInstance();

  // Load hierarchy data on mount
  useEffect(() => {
    let isMounted = true;

    const loadData = async () => {
      try {
        setLoading(true);
        setError(null);
        
        // Load the initial hierarchy
        await hierarchyService.loadHierarchy();
        
        // Set initial data if we have it
        if (isMounted) {
          setHierarchy(hierarchyService.getHierarchy());
        }
      } catch (err) {
        if (isMounted) {
          setError(err instanceof Error ? err.message : 'Failed to load notebook hierarchy');
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    loadData();

    return () => {
      isMounted = false;
    };
  }, [hierarchyService]);

  // Subscribe to hierarchy changes
  useEffect(() => {
    const unsubscribe = hierarchyService.onHierarchyChanged((newHierarchy) => {
      setHierarchy(newHierarchy);
      setLoading(false);
    });

    return unsubscribe;
  }, [hierarchyService]);

  const handleToggleExpansion = useCallback((nodeId: string) => {
    hierarchyService.toggleExpansion(nodeId);
  }, [hierarchyService]);

  const handleNotebookClick = useCallback(async (node: NotebookFileNode) => {
    if (node.type === 'notebook') {
      // Load analets for this notebook if not already loaded
      if (!node.analets) {
        await hierarchyService.loadNotebookAnalets(node.path);
        // Auto-expand after loading
        hierarchyService.toggleExpansion(node.id, true);
      }
    }
  }, [hierarchyService]);

  const handleNotebookOpen = useCallback(async (node: NotebookFileNode) => {
    if (node.type === 'notebook') {
      // Open the notebook file
      await hierarchyService.openItem(node.path);
      
      // Also trigger onNotebookOpen callback if provided
      if (onNotebookOpen) {
        onNotebookOpen(node.path);
      }
    }
  }, [hierarchyService, onNotebookOpen]);

  const handleItemOpen = useCallback(async (node: NotebookFileNode) => {
    await hierarchyService.openItem(node.path);
  }, [hierarchyService]);

  const handleItemDelete = useCallback(async (node: NotebookFileNode) => {
    // Note: VS Code webviews don't support confirm() modals
    // TODO: Consider implementing a custom confirmation modal within the webview
    await hierarchyService.deleteItem(node.path);
  }, [hierarchyService]);

  const handleItemRename = useCallback(async (node: NotebookFileNode, newName: string) => {
    await hierarchyService.renameItem(node.path, newName);
  }, [hierarchyService]);

  const renderNode = (node: NotebookFileNode, level: number = 0): React.ReactNode => {
    const isExpanded = node.isExpanded || false;

    if (node.type === 'folder') {
      return (
        <div key={node.id}>
          <NotebookFolderItem
            node={node}
            level={level}
            isExpanded={isExpanded}
            onToggle={() => handleToggleExpansion(node.id)}
            onRename={(newName) => handleItemRename(node, newName)}
            onDelete={() => handleItemDelete(node)}
            onClick={() => handleToggleExpansion(node.id)}
          />
          
          {/* Render children if expanded */}
          {isExpanded && node.children && (
            <div className="ml-4">
              {node.children.map(child => renderNode(child, level + 1))}
            </div>
          )}
        </div>
      );
    } else if (node.type === 'notebook') {
      return (
        <NotebookItem
          key={node.id}
          node={node}
          level={level}
          isExpanded={isExpanded}
          onToggle={() => handleToggleExpansion(node.id)}
          onRename={(newName) => handleItemRename(node, newName)}
          // onDelete={() => handleItemDelete(node)}
          onClick={() => handleNotebookClick(node)}
          onOpen={() => handleNotebookOpen(node)}
          onAnaletClick={onAnaletClick}
        />
      );
    } else {
      // Regular file (including CSV files)
      return (
        <div
          key={node.id}
          className="flex items-center gap-2 py-1 px-2 text-sm hover:bg-[var(--vscode-list-hoverBackground)] cursor-pointer rounded"
          style={{ paddingLeft: `${level * 16 + 8}px` }}
          onClick={() => handleItemOpen(node)}
        >
          {/* No expansion toggle space for files */}
          <div className="w-4" />
          
          {/* File type icon */}
          <FileIcon fileName={node.name} />
          
          <span className="flex-1 truncate" title={node.path}>
            {node.name}
          </span>
          
          {/* Last modified date/time */}
          {node.lastModified && (
            <span className="text-xs text-[var(--vscode-descriptionForeground)] opacity-60">
              {formatFileDate(node.lastModified)}
            </span>
          )}
        </div>
      );
    }
  };

  if (loading) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center p-6">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-[var(--vscode-button-background)] border-t-transparent mb-3"></div>
        <div className="text-sm text-[var(--vscode-descriptionForeground)]">Loading notebooks...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center p-6">
        <div className="text-[var(--vscode-errorForeground)] mb-4">
          <svg className="w-12 h-12 mx-auto mb-3" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
          Error loading notebooks
        </div>
        <div className="text-xs text-[var(--vscode-descriptionForeground)] mb-4">
          {error}
        </div>
        <button
          onClick={() => hierarchyService.loadHierarchy()}
          className="px-3 py-1 bg-[var(--vscode-button-background)] text-[var(--vscode-button-foreground)] hover:bg-[var(--vscode-button-hoverBackground)] rounded text-sm"
        >
          Retry
        </button>
      </div>
    );
  }

  if (hierarchy.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center p-6">
        <div className="text-[var(--vscode-descriptionForeground)] mb-4">
          <svg className="w-12 h-12 mx-auto mb-3 opacity-50" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z" clipRule="evenodd" />
          </svg>
          No notebooks found
        </div>
        <div className="text-xs text-[var(--vscode-descriptionForeground)] opacity-75 mb-4">
          Create your first notebook to get started
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {hierarchy.map(node => renderNode(node, 0))}
    </div>
  );
};