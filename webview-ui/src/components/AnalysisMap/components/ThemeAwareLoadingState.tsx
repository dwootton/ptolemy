import React from 'react';

interface ThemeAwareLoadingStateProps {
  loadingMessage?: string;
}

export const ThemeAwareLoadingState: React.FC<ThemeAwareLoadingStateProps> = ({
  loadingMessage = 'Generating analysis...'
}) => {
  return (
    <div className="w-full h-full flex items-center justify-center bg-[var(--vscode-editor-background)] border border-[var(--vscode-widget-border)] rounded relative">
      {/* Subtle background pattern that adapts to theme */}
      <div className="absolute inset-0 opacity-10">
        <div className="w-full h-full bg-gradient-to-br from-[var(--vscode-foreground)] to-[var(--vscode-descriptionForeground)]"></div>
      </div>
      
      <div className="text-center relative z-10">
        <div className="mb-4">
          {/* Single glowing dot that grows and shrinks */}
          <div className="w-16 h-16 mx-auto flex items-center justify-center">
            <div 
              className="w-3 h-3 rounded-full"
              style={{
                backgroundColor: 'var(--vscode-charts-blue)',
                boxShadow: `0 0 20px var(--vscode-charts-blue)`,
                animation: 'pulse-glow 2s ease-in-out infinite'
              }}
            ></div>
          </div>
        </div>
        <div className="text-sm text-[var(--vscode-foreground)] font-medium mb-1">
          Analysis Map
        </div>
        <div className="text-xs text-[var(--vscode-descriptionForeground)]">
          {loadingMessage}
        </div>
      </div>
      
      {/* CSS animation for the glowing dot */}
      <style>
        {`
          @keyframes pulse-glow {
            0%, 100% {
              transform: scale(1);
              opacity: 0.8;
            }
            50% {
              transform: scale(1.5);
              opacity: 1;
            }
          }
        `}
      </style>
    </div>
  );
};