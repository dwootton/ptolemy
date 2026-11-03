export interface LoadingProgressProps {
  progress?: number; // Progress percentage (0-100)
  message?: string;
}

export const LoadingProgress = ({ progress = 0, message = "Loading dataset..." }: LoadingProgressProps) => {
  return (
    <div className="w-full max-w-md mx-auto">
      <div className="space-y-4">
        {/* Loading Icon */}
        <div className="flex justify-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
        </div>

        {/* Progress Bar */}
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div
            className="bg-blue-600 h-2 rounded-full transition-all duration-300 ease-out"
            style={{width: `${progress}%`}}
          ></div>
        </div>

        {/* Progress Text */}
        <div className="text-center space-y-2">
          <p className="text-sm font-medium text-[var(--vscode-foreground)]">
            {message}
          </p>
          <p className="text-xs text-[var(--vscode-descriptionForeground)]">
            {progress}% complete
          </p>
        </div>
      </div>
    </div>
  );
}; 