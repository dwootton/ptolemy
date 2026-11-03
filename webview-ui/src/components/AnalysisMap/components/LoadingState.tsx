import React from "react";

interface LoadingStateProps {
  isLoading: boolean;
  message?: string;
}

export const LoadingState: React.FC<LoadingStateProps> = (props) => {
  return (
    <div 
      className={`absolute inset-0 flex items-center justify-center transition-opacity duration-300 ${
        props.isLoading ? "opacity-100" : "opacity-0 pointer-events-none"
      }`}
      style={{
        background: "var(--vscode-editor-background)",
        backgroundColor: "rgba(0, 0, 0, 0.15)"
      }}
    >
      <div 
        className="rounded-lg p-4 flex flex-col items-center"
        style={{
          background: "var(--vscode-editor-background)",
          border: "1px solid var(--vscode-panel-border)"
        }}
      >
        {/* Dark theme circle spinner */}
        <div className="relative">
          <svg width="32" height="32" className="animate-spin">
            <circle
              cx="16"
              cy="16"
              r="12"
              fill="none"
              stroke="#4A4A4A"
              strokeWidth="3"
              strokeDasharray="18,6"
              strokeLinecap="round"
              opacity="0.7"
            />
          </svg>
        </div>
        
        {/* Dark theme pulsing text */}
        <p 
          className="mt-4 text-sm animate-pulse-glow"
          style={{
            color: "var(--vscode-foreground)",
            textShadow: "0 0 6px rgba(74, 74, 74, 0.5)"
          }}
        >
          {props.message || "Loading..."}
        </p>
      </div>
      
      {/* CSS Animation for dark theme pulsing glow */}
      <style>{`
        @keyframes pulse-glow {
          0% {
            opacity: 0.7;
            text-shadow: 0 0 6px rgba(74, 74, 74, 0.3);
          }
          50% {
            opacity: 1;
            text-shadow: 0 0 12px rgba(74, 74, 74, 0.8);
          }
          100% {
            opacity: 0.7;
            text-shadow: 0 0 6px rgba(74, 74, 74, 0.3);
          }
        }
        
        .animate-pulse-glow {
          animation: pulse-glow 2.5s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
}; 