import React from "react";
import { MessageService } from "../../services/MessageService";
import { StudyConfigurationService } from "../../services/StudyConfigurationService";

export const SidebarSkeleton: React.FC = () => {
  const handleResetStudyUI = () => {
    try {
      StudyConfigurationService.getInstance().resetConfiguration();
    } catch {}
    try {
      const messageService = MessageService.getInstance();
      messageService.sendMessage('study:reset');
    } catch {}
  };

  return (
    <div className="h-full w-full text-[var(--vscode-foreground)] bg-[var(--vscode-editor-background)] flex flex-col" style={{minWidth: '350px'}}>
      
      {/* Dataset Header Skeleton */}
      <div className="bg-[var(--vscode-editor-background)] shadow-sm shadow-black/5 p-4 border-b border-[var(--vscode-panel-border)]">
        <div className="flex items-center justify-between mb-3">
          <div className="h-5 bg-[var(--vscode-foreground)] opacity-20 rounded w-48 animate-pulse"></div>
          <div className="flex items-center gap-2">
            <div className="h-8 bg-[var(--vscode-button-background)] opacity-20 rounded w-8 animate-pulse"></div>
            <div className="h-8 bg-[var(--vscode-button-background)] opacity-20 rounded w-8 animate-pulse"></div>
          </div>
        </div>
        
        {/* Dataset info skeleton */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <div className="h-3 bg-[var(--vscode-descriptionForeground)] opacity-15 rounded w-16 animate-pulse"></div>
            <div className="h-3 bg-[var(--vscode-descriptionForeground)] opacity-10 rounded w-24 animate-pulse"></div>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-3 bg-[var(--vscode-descriptionForeground)] opacity-15 rounded w-20 animate-pulse"></div>
            <div className="h-3 bg-[var(--vscode-descriptionForeground)] opacity-10 rounded w-16 animate-pulse"></div>
          </div>
        </div>
        
        {/* Profile cards skeleton */}
        <div className="mt-4 grid grid-cols-2 gap-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="p-2 border border-[var(--vscode-widget-border)] rounded opacity-30">
              <div className="h-3 bg-[var(--vscode-foreground)] opacity-20 rounded w-16 mb-1 animate-pulse"></div>
              <div className="h-2 bg-[var(--vscode-descriptionForeground)] opacity-15 rounded w-full animate-pulse"></div>
            </div>
          ))}
        </div>
      </div>

      {/* Conceptual Statements Skeleton */}
      <div className="bg-[var(--vscode-editor-background)] shadow-sm shadow-black/5 p-4 border-b border-[var(--vscode-panel-border)]">
        <div className="space-y-4">
          {/* Header skeleton */}
          <div className="flex items-center justify-between">
            <div className="h-4 bg-[var(--vscode-descriptionForeground)] opacity-20 rounded w-48 animate-pulse"></div>
            <div className="h-6 bg-[var(--vscode-button-background)] opacity-20 rounded w-20 animate-pulse"></div>
          </div>

          {/* Single variables skeleton - only shown when dataset is expanded */}
          <div className="space-y-2">
            <div className="h-3 bg-[var(--vscode-descriptionForeground)] opacity-15 rounded w-24 animate-pulse"></div>
            <div className="space-y-1">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="flex items-center gap-2 py-1">
                  <div className="w-2 h-2 bg-[var(--vscode-charts-blue)] opacity-20 rounded-full animate-pulse"></div>
                  <div className="h-3 bg-[var(--vscode-foreground)] opacity-15 rounded w-20 animate-pulse"></div>
                  <div className="h-3 bg-[var(--vscode-descriptionForeground)] opacity-10 rounded w-12 ml-auto animate-pulse"></div>
                </div>
              ))}
            </div>
          </div>

          {/* Statement input skeleton */}
          <div className="space-y-3">
            <div className="h-3 bg-[var(--vscode-descriptionForeground)] opacity-20 rounded w-40 animate-pulse"></div>
            <div className="h-10 bg-[var(--vscode-input-background)] border border-[var(--vscode-widget-border)] rounded opacity-30"></div>
          </div>
        </div>
      </div>

      {/* Notebook Sync Button Skeleton */}
      <div className="bg-[var(--vscode-editor-background)] shadow-sm shadow-black/5 px-4 py-2 border-b border-[var(--vscode-panel-border)]">
        <div className="h-8 bg-[var(--vscode-button-background)] opacity-20 rounded w-32 animate-pulse"></div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 p-4 flex flex-col space-y-4">
        
        {/* Analysis Map Section Skeleton */}
        <div className="flex-shrink-0">
          <div className="mb-2">
            <div className="h-4 bg-[var(--vscode-descriptionForeground)] opacity-20 rounded w-32 animate-pulse"></div>
          </div>
          
          <div 
            className="bg-[var(--vscode-editor-background)] rounded-lg overflow-hidden shadow-lg shadow-black/10 border border-[var(--vscode-panel-border)] flex items-center justify-center"
            style={{ height: '300px' }}
          >
            <div className="text-center space-y-4">
              <div className="w-16 h-16 bg-[var(--vscode-descriptionForeground)] opacity-10 rounded-full animate-pulse mx-auto"></div>
              <div className="space-y-2">
                <div className="h-4 bg-[var(--vscode-descriptionForeground)] opacity-20 rounded w-48 mx-auto animate-pulse"></div>
                <div className="h-3 bg-[var(--vscode-descriptionForeground)] opacity-15 rounded w-32 mx-auto animate-pulse"></div>
              </div>
              
              {/* Simulated node positions */}
              <div className="relative w-64 h-32 mx-auto">
                {Array.from({ length: 6 }).map((_, index) => (
                  <div
                    key={index}
                    className="absolute w-3 h-3 bg-[var(--vscode-charts-blue)] opacity-20 rounded-full animate-pulse"
                    style={{
                      left: `${Math.random() * 85}%`,
                      top: `${Math.random() * 75}%`,
                      animationDelay: `${index * 200}ms`
                    }}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Analet Organization Skeleton */}
        <div className="flex-shrink-0">
          <div 
            className="flex flex-col bg-[var(--vscode-editor-background)] rounded-lg overflow-hidden shadow-lg shadow-black/10"
            style={{ height: '700px' }}
          >
            {/* Header skeleton */}
            <div className="flex items-center justify-between p-2 border-b border-[var(--vscode-panel-border)]">
              <div className="flex items-center gap-3">
                <div className="h-3 bg-[var(--vscode-descriptionForeground)] opacity-20 rounded w-20 animate-pulse"></div>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-6 bg-[var(--vscode-button-background)] opacity-20 rounded w-12 animate-pulse"></div>
                <div className="h-6 bg-[var(--vscode-button-background)] opacity-20 rounded w-16 animate-pulse"></div>
                <div className="h-6 bg-[var(--vscode-button-background)] opacity-20 rounded w-20 animate-pulse"></div>
              </div>
            </div>

            {/* Content area skeleton */}
            <div className="flex-1 overflow-y-auto p-2">
              <div className="space-y-1">
                {Array.from({ length: 12 }).map((_, index) => (
                  <div key={index} className="flex items-center gap-2 px-2 py-1 rounded">
                    {/* Expand button skeleton */}
                    <div className="w-3 h-3 bg-[var(--vscode-icon-foreground)] opacity-10 rounded animate-pulse"></div>
                    
                    {/* Icon skeleton */}
                    <div className="w-2.5 h-2.5 bg-blue-500 opacity-20 rounded-full animate-pulse"></div>
                    
                    {/* Text skeleton */}
                    <div 
                      className="h-3 bg-[var(--vscode-foreground)] opacity-10 rounded animate-pulse"
                      style={{ width: `${Math.floor(Math.random() * 120) + 100}px` }}
                    ></div>
                    
                    {/* ID badge skeleton */}
                    <div className="ml-auto">
                      <div className="h-4 bg-[var(--vscode-badge-background)] opacity-20 rounded w-8 animate-pulse"></div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Footer skeleton */}
            <div className="px-3 py-2 border-t border-[var(--vscode-panel-border)]">
              <div className="flex justify-between items-center">
                <div className="h-3 bg-[var(--vscode-descriptionForeground)] opacity-20 rounded w-48 animate-pulse"></div>
                <div className="h-3 bg-[var(--vscode-descriptionForeground)] opacity-15 rounded w-64 animate-pulse"></div>
              </div>
            </div>
          </div>
        </div>
      </div>
      
      {/* Loading indicator overlay */}
      <div className="absolute inset-0 bg-[var(--vscode-editor-background)] bg-opacity-50 flex items-center justify-center">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 border-2 border-[var(--vscode-progressBar-background)] border-t-[var(--vscode-button-background)] rounded-full animate-spin mx-auto"></div>
          <div className="text-sm text-[var(--vscode-descriptionForeground)]">
            Checking for existing workspace...
          </div>
          <div>
            <button
              onClick={handleResetStudyUI}
              className="mt-2 px-3 py-1 text-xs rounded bg-[var(--vscode-button-background)] text-[var(--vscode-button-foreground)] hover:bg-[var(--vscode-button-hoverBackground)]"
            >
              Reset Study UI State
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
