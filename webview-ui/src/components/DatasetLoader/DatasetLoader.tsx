import { FileDropZone } from "./components/FileDropZone";
import { LoadingProgress } from "./components/LoadingProgress";
import { useDatasetLoader } from "./hooks/useDatasetLoader";

export interface DatasetLoaderProps {
  onDatasetLoaded: (dataset: any) => void;
}

export const DatasetLoader = ({ onDatasetLoaded }: DatasetLoaderProps) => {
  const {
    isLoading,
    error,
    loadDataset,
    progress
  } = useDatasetLoader();

  const handleFileSelected = async (file: File) => {
    try {
      const dataset = await loadDataset(file);
      onDatasetLoaded(dataset);
    } catch (err) {
      console.error('Failed to load dataset:', err);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center h-full w-full p-8 bg-[var(--vscode-editor-background)]">
      <div className="max-w-md w-full space-y-6">
        {/* Header */}
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-bold text-[var(--vscode-foreground)]">
            Load Dataset
          </h1>
          <p className="text-sm text-[var(--vscode-descriptionForeground)]">
            Select a CSV file to begin your analysis
          </p>
        </div>

        {/* Loading State */}
        {isLoading && (
          <LoadingProgress progress={progress} />
        )}

        {/* File Selector */}
        {!isLoading && (
          <FileDropZone
            onFileSelected={handleFileSelected}
            accept=".csv"
            maxFileSize={10 * 1024 * 1024} // 10MB limit
          />
        )}

        {/* Error Display */}
        {error && (
          <div className="bg-white/10 border border-white/40 text-white px-4 py-3 rounded">
            <p className="text-sm">{error}</p>
          </div>
        )}

        {/* Instructions */}
        {!isLoading && !error && (
          <div className="text-center space-y-2">
            <p className="text-xs text-[var(--vscode-descriptionForeground)]">
              Supported formats: CSV files (max 10MB)
            </p>
            <p className="text-xs text-[var(--vscode-descriptionForeground)]">
              AI features send selected data context to OpenAI.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
