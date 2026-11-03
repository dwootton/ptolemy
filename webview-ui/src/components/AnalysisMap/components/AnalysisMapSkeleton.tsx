import React from "react";

interface AnalysisMapSkeletonProps {
  height?: number;
}

export const AnalysisMapSkeleton: React.FC<AnalysisMapSkeletonProps> = ({ height = 300 }) => {
  return (
    <div 
      className="bg-[var(--vscode-editor-background)] rounded-lg overflow-hidden shadow-lg shadow-black/10 border border-[var(--vscode-panel-border)] flex items-center justify-center"
      style={{ height }}
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
  );
};