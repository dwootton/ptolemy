import { useState, useRef } from "react";

export interface FileDropZoneProps {
  onFileSelected: (file: File) => void;
  accept?: string;
  maxFileSize?: number;
}

export const FileDropZone = ({ onFileSelected, accept, maxFileSize }: FileDropZoneProps) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const validateFile = (file: File): string | null => {
    // Check file type
    if (accept && !file.name.toLowerCase().endsWith('.csv')) {
      return 'Please select a CSV file';
    }

    // Check file size
    if (maxFileSize && file.size > maxFileSize) {
      const maxSizeMB = Math.round(maxFileSize / (1024 * 1024));
      return `File size must be less than ${maxSizeMB}MB`;
    }

    return null;
  };

  const handleFileSelection = (file: File) => {
    const validationError = validateFile(file);
    if (validationError) {
      setError(validationError);
      return;
    }

    setError(null);
    onFileSelected(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    
    const files = e.dataTransfer?.files;
    if (files && files.length > 0) {
      handleFileSelection(files[0]);
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      handleFileSelection(files[0]);
    }
  };

  const openFileDialog = () => {
    fileInputRef.current?.click();
  };

  return (
    <div className="space-y-4">
      {/* Drop Zone */}
      <div
        className={`
          border-2 border-dashed rounded-lg p-8 text-center cursor-pointer
          transition-all duration-200 ease-in-out
          ${isDragOver 
            ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20' 
            : 'border-gray-300 hover:border-gray-400 dark:border-gray-600 dark:hover:border-gray-500'
          }
        `}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={openFileDialog}
      >
        <div className="space-y-4">
          {/* Upload Icon */}
          <div className="flex justify-center">
            <svg 
              className="w-12 h-12 text-gray-400" 
              fill="none" 
              stroke="currentColor" 
              viewBox="0 0 24 24"
            >
              <path 
                strokeLinecap="round" 
                strokeLinejoin="round" 
                strokeWidth="2" 
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
              />
            </svg>
          </div>

          {/* Text */}
          <div className="space-y-2">
            <p className="text-lg font-medium text-[var(--vscode-foreground)]">
              {isDragOver ? 'Drop CSV file here' : 'Drop CSV file here or click to select'}
            </p>
            <p className="text-sm text-[var(--vscode-descriptionForeground)]">
              Supports CSV files up to {maxFileSize ? Math.round(maxFileSize / (1024 * 1024)) : 10}MB
            </p>
          </div>

          {/* Browse Button */}
          <button
            className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-blue-400 hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-300"
            onClick={(e) => {
              e.stopPropagation();
              openFileDialog();
            }}
          >
            Browse Files
          </button>
        </div>
      </div>

      {/* Hidden File Input */}
      <input
        ref={fileInputRef}
        type="file"
        accept={accept || ".csv"}
        onChange={handleFileInputChange}
        className="hidden"
      />

      {/* Error Display */}
      {error && (
        <div className="bg-white/10 border border-white/40 text-white px-4 py-3 rounded">
          <p className="text-sm">{error}</p>
        </div>
      )}
    </div>
  );
}; 