import React from "react";

export const ConceptualStatementsSkeleton: React.FC = () => {
  return (
    <div className="bg-[var(--vscode-editor-background)] border-b border-[var(--vscode-panel-border)] p-4">
      <div className="space-y-4">
        {/* Header skeleton */}
        <div className="flex items-center justify-between">
          <div className="h-4 bg-[var(--vscode-descriptionForeground)] opacity-20 rounded w-48 animate-pulse"></div>
          <div className="h-6 bg-[var(--vscode-button-background)] opacity-20 rounded w-20 animate-pulse"></div>
        </div>

        {/* Variable cards skeleton */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <div 
              key={index}
              className="border border-[var(--vscode-widget-border)] rounded-lg p-3 space-y-2 animate-pulse"
            >
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-[var(--vscode-charts-blue)] opacity-20 rounded-full"></div>
                <div className="h-3 bg-[var(--vscode-foreground)] opacity-15 rounded w-20"></div>
                <div className="h-3 bg-[var(--vscode-descriptionForeground)] opacity-10 rounded w-12 ml-auto"></div>
              </div>
              <div className="h-2 bg-[var(--vscode-descriptionForeground)] opacity-10 rounded w-full"></div>
              <div className="h-2 bg-[var(--vscode-descriptionForeground)] opacity-5 rounded w-3/4"></div>
            </div>
          ))}
        </div>

        {/* Statement input skeleton */}
        <div className="space-y-3">
          <div className="h-3 bg-[var(--vscode-descriptionForeground)] opacity-20 rounded w-40 animate-pulse"></div>
          <div className="h-10 bg-[var(--vscode-input-background)] border border-[var(--vscode-widget-border)] rounded opacity-50"></div>
        </div>

        {/* Existing statements skeleton */}
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, index) => (
            <div 
              key={index}
              className="flex items-center justify-between p-2 border border-[var(--vscode-widget-border)] rounded opacity-30"
            >
              <div className="h-3 bg-[var(--vscode-foreground)] opacity-20 rounded animate-pulse" style={{ width: `${120 + Math.random() * 100}px` }}></div>
              <div className="flex items-center gap-2">
                <div className="h-5 bg-[var(--vscode-button-background)] opacity-20 rounded w-12 animate-pulse"></div>
                <div className="h-5 bg-[var(--vscode-button-background)] opacity-20 rounded w-8 animate-pulse"></div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};