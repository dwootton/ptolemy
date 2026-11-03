import { useState } from "react";
import Papa from "papaparse";

export interface DatasetInfo {
  name: string;
  rowCount: number;
  columnCount: number;
  columns: string[];
  data: Record<string, any>[];
  firstTwoRows: Record<string, any>[];
  filePath?: string;
  fileSize?: number;
}

export const useDatasetLoader = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);

  const loadDataset = async (file: File): Promise<DatasetInfo & { fileContent: string }> => {
    setIsLoading(true);
    setError(null);
    setProgress(0);

    try {
      // Read file content
      setProgress(10);
      const fileContent = await readFileContent(file);
      
      // Parse CSV
      setProgress(30);
      const parseResult = await parseCSV(fileContent);
      
      if (parseResult.errors.length > 0) {
        console.warn('CSV parsing warnings:', parseResult.errors);
      }

      setProgress(60);
      const data = parseResult.data as Record<string, any>[];
      
      if (data.length === 0) {
        throw new Error('CSV file appears to be empty');
      }

      const columns = Object.keys(data[0] || {});
      const firstTwoRows = data.slice(0, 2);
      
      // Console log as requested
      setProgress(90);
      
      const datasetInfo: DatasetInfo & { fileContent: string } = {
        name: file.name.replace('.csv', ''),
        rowCount: data.length,
        columnCount: columns.length,
        columns,
        data,
        firstTwoRows,
        filePath: file.name, // Include file name for backend reference
        fileSize: file.size,
        fileContent // Include file content for backend saving
      };

      setProgress(100);
      setIsLoading(false);
      
      return datasetInfo;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to load dataset';
      setError(errorMessage);
      setIsLoading(false);
      throw err;
    }
  };

  const readFileContent = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        resolve(e.target?.result as string);
      };
      reader.onerror = () => {
        reject(new Error('Failed to read file'));
      };
      reader.readAsText(file);
    });
  };

  const parseCSV = (content: string): Promise<Papa.ParseResult<any>> => {
    return new Promise((resolve, reject) => {
      try {
        const result = Papa.parse(content, {
          header: true,
          dynamicTyping: true,
          skipEmptyLines: true,
          delimitersToGuess: [',', '\t', '|', ';'],
          transformHeader: (header: string) => header.trim()
        });
        
        if (result.errors.length > 0) {
          console.warn('CSV parsing warnings:', result.errors);
        }
        
        resolve(result);
      } catch (error) {
        reject(new Error(`CSV parsing error: ${error instanceof Error ? error.message : 'Unknown error'}`));
      }
    });
  };

  return {
    isLoading,
    error,
    progress,
    loadDataset
  };
}; 