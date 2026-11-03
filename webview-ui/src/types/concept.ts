export interface ConceptAxis {
  id: string;
  name: string;
  description?: string;
  dataConcepts: string[];
  order: number;
  isAIGenerated?: boolean; // Flag to track if this was originally AI-generated
  lastModified?: string; // Timestamp of last modification
}

export interface ConceptAxisState {
  conceptAxes: ConceptAxis[];
  isLoading: boolean;
  error: string | null;
} 