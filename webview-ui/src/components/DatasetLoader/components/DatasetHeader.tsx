import { useState } from "react";
import { DatasetInfo } from "../hooks/useDatasetLoader";

export interface DatasetHeaderProps {
  dataset: DatasetInfo;
  onChangeDataset: () => void;
}

export const DatasetHeader = ({ dataset, onChangeDataset }: DatasetHeaderProps) => {
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied'>('idle');

  const handleCopyPath = async () => {
    try {
      await navigator.clipboard.writeText(dataset.name);
      setCopyStatus('copied');
      setTimeout(() => setCopyStatus('idle'), 2000);
    } catch (error) {
      console.error('Failed to copy to clipboard:', error);
    }
  };
  return (
    <div className="flex items-center justify-between p-3 bg-[var(--vscode-editor-background)] border-b border-[var(--vscode-widget-border)]">
      <div className="flex items-center space-x-3">
        <div className="flex items-center space-x-2">
          <svg className="w-5 h-5 text-[var(--vscode-foreground)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <span className="font-medium text-[var(--vscode-foreground)]">
            {dataset.name}
          </span>
          <button
            onClick={handleCopyPath}
            className="p-1 hover:bg-[var(--vscode-button-hoverBackground)] rounded transition-colors"
            title="Copy dataset path to clipboard"
          >
            {copyStatus === 'copied' ? (
              <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
              </svg>
            ) : (
              <svg className="w-4 h-4 text-[var(--vscode-descriptionForeground)] hover:text-[var(--vscode-foreground)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            )}
          </button>
        </div>
        <div className="flex items-center space-x-4 text-xs text-[var(--vscode-descriptionForeground)]">
          <span>{dataset.rowCount.toLocaleString()} rows</span>
          <span>{dataset.columnCount} columns</span>
        </div>
      </div>
      
      <button
        onClick={onChangeDataset}
        className="px-3 py-1 text-xs font-medium text-[var(--vscode-button-foreground)] bg-[var(--vscode-button-background)] hover:bg-[var(--vscode-button-hoverBackground)] rounded transition-colors"
      >
        Change Dataset
      </button>
    </div>
  );
}; 