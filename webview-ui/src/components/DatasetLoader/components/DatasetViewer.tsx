import { useState, useEffect, useCallback, useRef } from "react";
import { DatasetInfo } from "../hooks/useDatasetLoader";
import { MessageService } from "../../../services/MessageService";
import { ExportSemanticLayerButton } from "./ExportSemanticLayerButton";
import { ValueComment } from "../../../types/analet";
import { useDatasetDictionaryInstrumentation } from '../../../hooks/useInstrumentation';

interface SavedComment {
  id: number;
  text: string;
  timestamp: string;
}

// Enhanced dataset profile interface (from DatasetSummarizerService)
export interface DatasetProfile {
  enhanced: boolean;
  columns: Array<{
    name: string;
    dataType: 'string' | 'number' | 'boolean' | 'date' | 'mixed';
    semanticType: 'categorical' | 'numerical' | 'ordinal' | 'temporal' | 'identifier' | 'text' | 'binary';
    cardinality: 'low' | 'medium' | 'high' | 'unique';
    uniqueCount: number;
    nullCount: number;
    completeness: number;
    topValues?: Array<{ value: any; count: number; percentage: number }>;
    numericStats?: {
      min: number;
      max: number;
      mean: number;
      median: number;
      std: number;
      q25: number;
      q75: number;
    };
    kdeData?: {
      points: Array<{ x: number; y: number }>;
      outliers: {
        low: { count: number; threshold: number };
        high: { count: number; threshold: number };
      };
    };
    patterns?: Array<{ pattern: string; count: number; examples: string[] }>;
    // Enhanced ConceptExplorer fields
    displayName?: string;
    unit?: string;
    description?: string;
    comments?: SavedComment[];
    currentComment?: string;
    isDescriptionAIGenerated?: boolean;
    isDescriptionHumanEdited?: boolean;
    isUnitAIGenerated?: boolean;
    isUnitHumanEdited?: boolean;
    // Value annotations for categorical columns
    valueAnnotations?: {
      [rawValue: string]: {
        annotation: string;
        isAIGenerated: boolean;
        isHumanEdited: boolean;
        description?: string;
        createdAt: string;
        lastModified: string;
      };
    };
  }>;
  quality: {
    overall: 'excellent' | 'good' | 'fair' | 'poor';
    overallScore: number;
    completeness: number;
    consistency: number;
    duplicates: number;
  };
  relationships?: Array<{
    column1: string;
    column2: string;
    correlation: number;
    strength: 'weak' | 'moderate' | 'strong';
  }>;
}

export interface DatasetViewerProps {
  dataset: DatasetInfo;
  profile?: DatasetProfile;
  stateService?: any;
  settingsButton?: React.ReactNode;
}

// Enhanced type detection utility
const detectColumnType = (columnName: string, sampleData: any[]): 'string' | 'number' | 'boolean' | 'mixed' => {
  if (!sampleData || sampleData.length === 0) return 'string';
  
  const sampleValues = sampleData.map(row => row[columnName]).filter(v => v != null && v !== '' && v !== undefined);
  if (sampleValues.length === 0) return 'string';
  
  let numericCount = 0;
  let booleanCount = 0;
  
  for (const value of sampleValues) {
    // Check if it's a number
    if (typeof value === 'number' && !isNaN(value)) {
      numericCount++;
    } else if (typeof value === 'string') {
      // Try to parse as number
      const numericValue = parseFloat(value);
      if (!isNaN(numericValue) && isFinite(numericValue) && value.trim() === numericValue.toString()) {
        numericCount++;
      } else if (value.toLowerCase() === 'true' || value.toLowerCase() === 'false') {
        booleanCount++;
      }
    } else if (typeof value === 'boolean') {
      booleanCount++;
    }
  }
  
  const numericRatio = numericCount / sampleValues.length;
  const booleanRatio = booleanCount / sampleValues.length;
  
  if (numericRatio >= 0.7) {
    return 'number';
  } else if (booleanRatio >= 0.7) {
    return 'boolean';
  } else {
    return 'string';
  }
};

// Fallback descriptions for when LLM is unavailable
const generateFallbackDescription = (columnName: string, type: string): string => {
  const cleanName = columnName.replace(/[_-]/g, ' ').toLowerCase();
  
  if (type === 'number') {
    if (cleanName.includes('age')) return `Age measurement or time-related numeric value`;
    if (cleanName.includes('price') || cleanName.includes('cost')) return `Monetary value or pricing information`;
    if (cleanName.includes('weight')) return `Weight measurement in appropriate units`;
    if (cleanName.includes('height')) return `Height or vertical measurement`;
    if (cleanName.includes('count') || cleanName.includes('num')) return `Count or quantity measurement`;
    if (cleanName.includes('score') || cleanName.includes('rating')) return `Score or rating value`;
    if (cleanName.includes('percent') || cleanName.includes('rate')) return `Percentage or rate value`;
    return `Numeric measurement or calculated value`;
  } else if (type === 'boolean') {
    return `Binary indicator or true/false condition`;
  } else {
    if (cleanName.includes('name') || cleanName.includes('title')) return `Text identifier or descriptive name`;
    if (cleanName.includes('id') || cleanName.includes('code')) return `Unique identifier or classification code`;
    if (cleanName.includes('category') || cleanName.includes('type')) return `Categorical classification or grouping`;
    if (cleanName.includes('address') || cleanName.includes('location')) return `Location or address information`;
    if (cleanName.includes('email') || cleanName.includes('phone')) return `Contact information`;
    if (cleanName.includes('description') || cleanName.includes('comment')) return `Descriptive text or notes`;
    return `Text-based information or categorical data`;
  }
};

// Get sample values for a column
const getSampleValues = (columnName: string, sampleData: any[], maxSamples: number = 5): any[] => {
  if (!sampleData || sampleData.length === 0) return [];
  return sampleData
    .map(row => row[columnName])
    .filter(v => v != null && v !== '')
    .slice(0, maxSamples);
};

export const DatasetViewer = ({ dataset, profile, stateService, settingsButton }: DatasetViewerProps) => {
  const { trackClick, trackUIStateChange } = useDatasetDictionaryInstrumentation();
  
  // Always start collapsed - only expand when user manually clicks
  const [isExpanded, setIsExpanded] = useState(false);
  
  // Remove auto-expand behavior - let user control expansion manually
  const [enhancedColumns, setEnhancedColumns] = useState<DatasetProfile['columns']>([]);
  const [isGeneratingDefinitions, setIsGeneratingDefinitions] = useState(false);
  const [hasBeenExpanded, setHasBeenExpanded] = useState(false);
  
  // Value commenting state
  const [valueComments, setValueComments] = useState<{[columnName: string]: {[rawValue: string]: ValueComment[]}}>({});
  const [editingValueComment, setEditingValueComment] = useState<{columnName: string, rawValue: string} | null>(null);
  const [newValueCommentText, setNewValueCommentText] = useState('');

  // Dedupe guard to avoid multiple background generations per dataset
  const fetchedDatasetsRef = useRef<Set<string>>(new Set());

  // Generate enhanced column definitions only when first expanded
  useEffect(() => {
    if (dataset && dataset.columns.length > 0 && hasBeenExpanded && enhancedColumns.length === 0) {
      // Add a small delay to allow StateService to load semantic layer first
      const timer = setTimeout(() => {
        generateEnhancedColumnDefinitions();
      }, 500); // 500ms delay to allow semantic layer to load
      
      return () => clearTimeout(timer);
    }
  }, [dataset, hasBeenExpanded, enhancedColumns.length]); // Only run when expanded and no enhanced columns exist

  const generateEnhancedColumnDefinitions = async () => {
    if (!dataset) return;

    // If we already have enhanced columns for this dataset, don't regenerate
    if (enhancedColumns.length === dataset.columns.length && !isGeneratingDefinitions) {
      return;
    }

    setIsGeneratingDefinitions(true);
    try {
      console.log('[dataset-bug][webview] generateEnhancedColumnDefinitions:start', {
        dataset: dataset?.name,
        cols: dataset?.columns?.length,
        hasData: Array.isArray(dataset?.data) && (dataset?.data?.length || 0) > 0,
        dataRows: dataset?.data?.length || 0,
        hasProfile: !!profile,
        profileCols: (profile as any)?.columns?.length
      });
    } catch {}
    
    try {
      // First, check for existing variable modifications from session storage
      const existingModifications = stateService?.getVariableModifications() || {};
      // Prepare column data for LLM analysis with better type detection
      const columnsForAnalysis = dataset.columns.map(col => {
        const detectedType = detectColumnType(col, dataset.data || []);
        const sampleValues = getSampleValues(col, dataset.data || []);
        
        return {
          name: col,
          type: detectedType,
          sampleValues: sampleValues
        };
      });

      // Determine which columns need AI generation (don't have existing descriptions/units)
      const columnsNeedingAI = columnsForAnalysis.filter(col => {
        const existing = existingModifications[col.name];
        return !existing || (!existing.description && !existing.unit);
      });
      try {
        const existingKeys = Object.keys(existingModifications || {});
        const excluded = dataset.columns.filter(name => !columnsNeedingAI.find(c => c.name === name));
        console.log('[dataset-bug][webview] defs: columns summary', {
          totalColumns: dataset.columns.length,
          existingMods: existingKeys.length,
          firstExisting: existingKeys.slice(0, 10),
          needingAI: columnsNeedingAI.length,
          needingPreview: columnsNeedingAI.slice(0, 10).map(c => c.name),
          excludedCount: excluded.length,
          excludedPreview: excluded.slice(0, 10)
        });
      } catch {}
      // Create dataset context
      const datasetContext = `Dataset: "${dataset.name}"
Columns: ${dataset.columns.length}
Sample Data Available: ${dataset.data ? 'Yes' : 'No'}
Total Samples: ${dataset.data?.length || 0}`;

      // Request AI-generated descriptions and units (only for columns that need them)
      const messageService = MessageService.getInstance();
      let aiDescriptions: Array<{name: string, description: string, unit: string}> = [];
      
      if (columnsNeedingAI.length > 0) {
        try {
          // Always request backend AI descriptions; backend reads CSV via summarizer even if dataset.data is empty
          messageService.sendMessage('generate-column-definitions', {
            columns: columnsNeedingAI,
            datasetContext: datasetContext
          });
          try { console.log('[dataset-bug][webview] sent generate-column-definitions', { count: columnsNeedingAI.length }); } catch {}

          // Wait for response with timeout
          const response = await new Promise<any>((resolve, reject) => {
            const timeout = setTimeout(() => {
              messageService.offMessage('column-definitions-response', handleResponse);
              reject(new Error('Timeout waiting for AI definitions'));
            }, 45000);

            const handleResponse = (data: any) => {
              clearTimeout(timeout);
              messageService.offMessage('column-definitions-response', handleResponse);
              try { console.log('[dataset-bug][webview] column-definitions-response', { ok: data?.success, hasCols: Array.isArray(data?.definitions?.columns), count: data?.definitions?.columns?.length }); } catch {}
              resolve(data);
            };

            messageService.onMessage('column-definitions-response', handleResponse);
          });

          if (response.success && response.definitions) {
            if (Array.isArray(response.definitions.columns)) {
              aiDescriptions = response.definitions.columns.map((col: any) => ({
                name: col.name,
                description: col.description,
                unit: col.unit || '–'
              }));
              try {
                const returned = aiDescriptions.map(d => d.name);
                const requested = columnsNeedingAI.map(c => c.name);
                const missing = requested.filter(n => !returned.includes(n));
                console.log('[dataset-bug][webview] defs coverage', {
                  requested: requested.length,
                  returned: returned.length,
                  missingCount: missing.length,
                  missingPreview: missing.slice(0, 10)
                });
              } catch {}
            } else {
              aiDescriptions = [];
            }
          } else {
            throw new Error(response.error || 'Failed to generate AI descriptions');
          }
        } catch (error) {
          console.warn('⚠️ [DatasetViewer] AI description generation failed, using fallbacks:', error);
          aiDescriptions = columnsNeedingAI.map(col => ({
            name: col.name,
            description: generateFallbackDescription(col.name, col.type),
            unit: '–'
          }));
        }
      } else {  
        console.log('🔍 [DatasetViewer] No columns needing AI generation');
        aiDescriptions = [];
      }

      // Debug profile data to identify issues
      // Create enhanced column definitions by merging profile data, existing modifications, and AI descriptions
      const enhanced = dataset.columns.map((colName) => {
        const detectedType = detectColumnType(colName, dataset.data || []);
        const profileColumn = (profile?.columns && Array.isArray(profile.columns)) 
          ? profile.columns.find((c: any) => c && c.name === colName) 
          : undefined;
        const aiDesc = Array.isArray(aiDescriptions) ? aiDescriptions.find(desc => desc.name === colName) : undefined;
        const existingMod = existingModifications[colName];
        
        // Priority: existing modifications > AI descriptions > fallback
        const finalDescription = existingMod?.description || aiDesc?.description || generateFallbackDescription(colName, detectedType);
        const finalUnit = existingMod?.unit || aiDesc?.unit || '–';
        const finalDisplayName = existingMod?.displayName || colName;
        const finalComments = existingMod?.comments || [];
        
        return {
          // Use profile data if available, otherwise use basic detection
          name: colName,
          dataType: profileColumn?.dataType || detectedType,
          semanticType: profileColumn?.semanticType || (detectedType === 'number' ? 'numerical' as const : 'text' as const),
          cardinality: profileColumn?.cardinality || 'medium' as const,
          uniqueCount: profileColumn?.uniqueCount || 0,
          nullCount: profileColumn?.nullCount || 0,
          completeness: profileColumn?.completeness || 1,
          topValues: profileColumn?.topValues,
          numericStats: profileColumn?.numericStats,
          kdeData: profileColumn?.kdeData,
          patterns: profileColumn?.patterns,
          displayName: finalDisplayName,
          unit: finalUnit,
          description: finalDescription,
          comments: finalComments,
          currentComment: '',
          // Preserve existing modification states
          isDescriptionAIGenerated: existingMod?.isDescriptionAIGenerated ?? !!aiDesc,
          isDescriptionHumanEdited: existingMod?.isDescriptionHumanEdited ?? false,
          isUnitAIGenerated: existingMod?.isUnitAIGenerated ?? !!(aiDesc && aiDesc.unit && aiDesc.unit !== '–'),
          isUnitHumanEdited: existingMod?.isUnitHumanEdited ?? false,
          valueAnnotations: existingMod?.valueAnnotations || profileColumn?.valueAnnotations
        };
      });
      
      setEnhancedColumns(enhanced);
      
      // Persist results to StateService in a single batch so other views (e.g., brainstorm) have them immediately
      if (stateService && typeof stateService.setVariableModifications === 'function') {
        const modificationsBatch: { [variableName: string]: any } = {};
        for (const col of enhanced) {
          modificationsBatch[col.name] = {
            name: col.name,
            displayName: col.displayName,
            description: col.description,
            unit: col.unit,
            comments: col.comments || [],
            isDescriptionAIGenerated: !!col.isDescriptionAIGenerated,
            isDescriptionHumanEdited: !!col.isDescriptionHumanEdited,
            isUnitAIGenerated: !!col.isUnitAIGenerated,
            isUnitHumanEdited: !!col.isUnitHumanEdited,
            valueAnnotations: col.valueAnnotations
          };
        }
        try {
          stateService.setVariableModifications(modificationsBatch, true);
        } catch (e) {
          console.warn('⚠️ [DatasetViewer] Failed to persist variable modifications batch:', e);
        }
      }
      // Auto-generate value annotations for low cardinality categorical columns
      await generateAutoValueAnnotations(enhanced);
      
    } catch (error) {
      console.error('❌ [DatasetViewer] Error generating column definitions:', error);
      
      // Generate basic enhanced columns if everything fails
      const basicEnhanced = dataset.columns.map((colName) => {
        const detectedType = detectColumnType(colName, dataset.data || []);
        const profileColumn = (profile?.columns && Array.isArray(profile.columns)) 
          ? profile.columns.find((c: any) => c && c.name === colName) 
          : undefined;
        
        return {
          name: colName,
          dataType: profileColumn?.dataType || detectedType,
          semanticType: profileColumn?.semanticType || (detectedType === 'number' ? 'numerical' as const : 'text' as const),
          cardinality: profileColumn?.cardinality || 'medium' as const,
          uniqueCount: profileColumn?.uniqueCount || 0,
          nullCount: profileColumn?.nullCount || 0,
          completeness: profileColumn?.completeness || 1,
          topValues: profileColumn?.topValues,
          numericStats: profileColumn?.numericStats,
          kdeData: profileColumn?.kdeData,
          patterns: profileColumn?.patterns,
          displayName: colName,
          unit: '–',
          description: `Dataset column: ${colName}`,
          comments: [] as SavedComment[],
          currentComment: '',
          isDescriptionAIGenerated: false,
          isDescriptionHumanEdited: false,
          isUnitAIGenerated: false,
          isUnitHumanEdited: false
        };
      });
      
      setEnhancedColumns(basicEnhanced);
      
      // Also persist the basic set so other parts of the app still get useful defaults
      if (stateService && typeof stateService.setVariableModifications === 'function') {
        const modificationsBatch: { [variableName: string]: any } = {};
        for (const col of basicEnhanced) {
          modificationsBatch[col.name] = {
            name: col.name,
            displayName: col.displayName,
            description: col.description,
            unit: col.unit,
            comments: col.comments || [],
            isDescriptionAIGenerated: false,
            isDescriptionHumanEdited: false,
            isUnitAIGenerated: false,
            isUnitHumanEdited: false
          };
        }
        try {
          stateService.setVariableModifications(modificationsBatch, true);
        } catch (e) {
          console.warn('⚠️ [DatasetViewer] Failed to persist basic variable modifications batch:', e);
        }
      }
    } finally {
      setIsGeneratingDefinitions(false);
    }
  };

  // Background generation on dataset load, deduped per dataset and skipped if we already have modifications for all columns
  useEffect(() => {
    if (!dataset || !dataset.columns || dataset.columns.length === 0) return;
    const datasetKey = dataset.name;
    try {
      const existing = stateService?.getVariableModifications ? stateService.getVariableModifications() : {};
      const haveAllMods = dataset.columns.every((col: string) => {
        const m = existing[col];
        return !!(m && (m.description || m.unit));
      });
      if (haveAllMods) {
        // If we have all modifications and no enhanced columns yet, synthesize enhanced columns from existing + profile
        if (enhancedColumns.length === 0) {
          const synthesized = dataset.columns.map((colName: string) => {
            const detectedType = detectColumnType(colName, dataset.data || []);
            const profileColumn = (profile?.columns && Array.isArray(profile.columns)) 
              ? profile.columns.find(c => c && c.name === colName) 
              : undefined;
            const existingMod = existing[colName] || {};
            return {
              name: colName,
              dataType: profileColumn?.dataType || detectedType,
              semanticType: profileColumn?.semanticType || (detectedType === 'number' ? 'numerical' as const : 'text' as const),
              cardinality: profileColumn?.cardinality || 'medium' as const,
              uniqueCount: profileColumn?.uniqueCount || 0,
              nullCount: profileColumn?.nullCount || 0,
              completeness: profileColumn?.completeness || 1,
              topValues: profileColumn?.topValues,
              numericStats: profileColumn?.numericStats,
              kdeData: profileColumn?.kdeData,
              patterns: profileColumn?.patterns,
              displayName: existingMod.displayName || colName,
              unit: existingMod.unit || '–',
              description: existingMod.description || `Dataset column: ${colName}`,
              comments: existingMod.comments || [],
              currentComment: '',
              isDescriptionAIGenerated: !!existingMod.isDescriptionAIGenerated,
              isDescriptionHumanEdited: !!existingMod.isDescriptionHumanEdited,
              isUnitAIGenerated: !!existingMod.isUnitAIGenerated,
              isUnitHumanEdited: !!existingMod.isUnitHumanEdited,
              valueAnnotations: existingMod.valueAnnotations
            };
          });
          setEnhancedColumns(synthesized as any);
        }
        return; // No background generation needed
      }
      if (!fetchedDatasetsRef.current.has(datasetKey)) {
        fetchedDatasetsRef.current.add(datasetKey);
        // Kick off background generation; UI expand no longer required
        generateEnhancedColumnDefinitions();
      }
    } catch (e) {
      console.warn('⚠️ [DatasetViewer] Background generation check failed:', e);
    }
  }, [dataset, profile, stateService, enhancedColumns.length]);

  const updateColumnField = useCallback((colIndex: number, field: string, value: any) => {
    setEnhancedColumns(prev => prev.map((col, i) => {
      if (i === colIndex) {
        const updated = { ...col, [field]: value };
        // If description is updated by user, mark as human edited but not yet saved
        if (field === 'description') {
          updated.isDescriptionAIGenerated = false;
          updated.isDescriptionHumanEdited = false; // Will show save button
        }
        // If unit is updated by user, mark as human edited but not yet saved
        if (field === 'unit') {
          updated.isUnitAIGenerated = false;
          updated.isUnitHumanEdited = false; // Will show save button
        }
        
        // Save to StateService for persistence
        if (stateService) {
          stateService.updateVariableField(col.name, field, value);
        }
        
        return updated;
      }
      return col;
    }));
  }, [stateService]);

  const handleSaveDescription = useCallback((colIndex: number) => {
    setEnhancedColumns(prev => prev.map((col, i) => {
      if (i === colIndex) {
        return { ...col, isDescriptionHumanEdited: true };
      }
      return col;
    }));
  }, []);

  const handleSaveUnit = useCallback((colIndex: number) => {
    setEnhancedColumns(prev => prev.map((col, i) => {
      if (i === colIndex) {
        return { ...col, isUnitHumanEdited: true };
      }
      return col;
    }));
  }, []);

  const handleAcceptAIDescription = useCallback((colIndex: number) => {
    setEnhancedColumns(prev => prev.map((col, i) => {
      if (i === colIndex) {
        const updated = { 
          ...col, 
          isDescriptionAIGenerated: false,
          isDescriptionHumanEdited: true 
        };
        
        // Save to StateService for persistence
        if (stateService) {
          stateService.updateVariableField(col.name, 'description', col.description);
          stateService.updateVariableField(col.name, 'isDescriptionAIGenerated', false);
          stateService.updateVariableField(col.name, 'isDescriptionHumanEdited', true);
        }
        
        return updated;
      }
      return col;
    }));
  }, [stateService]);

  const handleAcceptAIUnit = useCallback((colIndex: number) => {
    setEnhancedColumns(prev => prev.map((col, i) => {
      if (i === colIndex) {
        const updated = { 
          ...col, 
          isUnitAIGenerated: false,
          isUnitHumanEdited: true 
        };
        
        // Save to StateService for persistence
        if (stateService) {
          stateService.updateVariableField(col.name, 'unit', col.unit);
          stateService.updateVariableField(col.name, 'isUnitAIGenerated', false);
          stateService.updateVariableField(col.name, 'isUnitHumanEdited', true);
        }
        
        return updated;
      }
      return col;
    }));
  }, [stateService]);

  const addComment = useCallback((colIndex: number) => {
    setEnhancedColumns(prev => prev.map((col, i) => {
      if (i === colIndex && col.currentComment?.trim()) {
        const newComment: SavedComment = {
          id: Date.now(),
          text: col.currentComment.trim(),
          timestamp: new Date().toLocaleString()
        };
        return {
          ...col,
          comments: [newComment, ...(col.comments || [])],
          currentComment: ''
        };
      }
      return col;
    }));
  }, []);

  const editComment = useCallback((colIndex: number, commentId: number) => {
    setEnhancedColumns(prev => prev.map((col, i) => {
      if (i === colIndex) {
        const comment = col.comments?.find(c => c.id === commentId);
        if (comment) {
          return {
            ...col,
            currentComment: comment.text,
            comments: col.comments?.filter(c => c.id !== commentId) || []
          };
        }
      }
      return col;
    }));
  }, []);

  // Auto-generate value annotations for low cardinality categorical columns
  const generateAutoValueAnnotations = useCallback(async (enhancedColumnsData: any[]) => {
    const messageService = MessageService.getInstance();
    
    // Find columns that need value annotations
    const columnsNeedingAnnotations = enhancedColumnsData.filter(col => 
      col.cardinality === 'low' && 
      col.semanticType === 'categorical' &&
      col.topValues && 
      col.topValues.length > 0 &&
      (!col.valueAnnotations || Object.keys(col.valueAnnotations).length === 0)
    );
    for (const column of columnsNeedingAnnotations) {
      try {
        // Send message to generate value annotations
        // Send column and sample values (topValues) to backend for annotation
        messageService.sendMessage('generate-value-annotations', {
          column: column.name,
          values: (column.topValues || []).map((tv: any) => tv?.value).filter((v: any) => v !== undefined && v !== null)
        });

        // Wait for response
        const response = await new Promise<any>((resolve, reject) => {
          const timeout = setTimeout(() => {
            messageService.offMessage('value-annotations-generated', handleResponse);
            messageService.offMessage('value-annotations-error', handleError);
            reject(new Error('Timeout waiting for value annotations'));
          }, 15000); // 15 second timeout

          const handleResponse = (data: any) => {
            if (data.columnName === column.name) {
              clearTimeout(timeout);
              messageService.offMessage('value-annotations-generated', handleResponse);
              messageService.offMessage('value-annotations-error', handleError);
              resolve(data);
            }
          };

          const handleError = (data: any) => {
            if (data.columnName === column.name) {
              clearTimeout(timeout);
              messageService.offMessage('value-annotations-generated', handleResponse);
              messageService.offMessage('value-annotations-error', handleError);
              reject(new Error(data.error || 'Value annotation generation failed'));
            }
          };

          messageService.onMessage('value-annotations-generated', handleResponse);
          messageService.onMessage('value-annotations-error', handleError);
        });

        if (response.success && response.annotations) {
          // Update the column with AI-generated annotations
          setEnhancedColumns(prev => prev.map(col => {
            if (col.name === column.name) {
              return {
                ...col,
                valueAnnotations: response.annotations
              };
            }
            return col;
          }));
        }
      } catch (error) {
        console.warn(`⚠️ [DatasetViewer] Failed to auto-generate annotations for ${column.name}:`, error);
      }
    }
  }, [dataset.name]);

  // Value annotation management
  const generateValueAnnotations = useCallback(async (columnName: string) => {
    setIsGeneratingDefinitions(true);
    
    try {
      const response = await fetch('/api/generate-value-annotations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          columnName,
          datasetName: dataset.name
        })
      });
      
      if (response.ok) {
        const result = await response.json();
        // Update the column with new annotations
        setEnhancedColumns(prev => prev.map(col => {
          if (col.name === columnName) {
            return {
              ...col,
              valueAnnotations: result.annotations
            };
          }
          return col;
        }));
      }
    } catch (error) {
      console.error('❌ [DatasetViewer] Error generating value annotations:', error);
    } finally {
      setIsGeneratingDefinitions(false);
    }
  }, [dataset.name]);

  // Value comment management
  const addValueComment = useCallback((columnName: string, rawValue: string, commentText: string) => {
    const newComment: ValueComment = {
      id: Date.now() + Math.random(),
      text: commentText,
      createdAt: new Date().toISOString(),
      isFromConceptualStatement: false,
      variableName: columnName,
      rawValue: rawValue
    };

    setValueComments(prev => ({
      ...prev,
      [columnName]: {
        ...prev[columnName],
        [rawValue]: [...(prev[columnName]?.[rawValue] || []), newComment]
      }
    }));

    // Save to state service if available
    if (stateService) {
      const existingComments = stateService.getValueComments(columnName, rawValue) || [];
      stateService.saveValueComments(columnName, rawValue, [...existingComments, newComment]);
    }
  }, [stateService]);

  const deleteValueComment = useCallback((columnName: string, rawValue: string, commentId: number) => {
    setValueComments(prev => ({
      ...prev,
      [columnName]: {
        ...prev[columnName],
        [rawValue]: prev[columnName]?.[rawValue]?.filter(c => c.id !== commentId) || []
      }
    }));

    // Update state service
    if (stateService) {
      const updatedComments = (stateService.getValueComments(columnName, rawValue) || [])
        .filter((c: ValueComment) => c.id !== commentId);
      stateService.saveValueComments(columnName, rawValue, updatedComments);
    }
  }, [stateService]);

  // Conceptual statement linking temporarily disabled
  // useEffect(() => {
  //   if (stateService && enhancedColumns.length > 0) {
  //     const conceptualStatements = stateService.getConceptualStatements() || [];
  //     const variableNames = enhancedColumns.map(col => col.name);
  //     
  //     // TODO: Re-enable conceptual statement linking
  //     // const linkedData = linkConceptualStatementsToVariables(conceptualStatements, variableNames);
  //     
  //     // Update value comments with conceptual statement references
  //     // const newValueComments: {[columnName: string]: {[rawValue: string]: ValueComment[]}} = {};
  //     
  //     // Object.entries(linkedData).forEach(([varName, data]) => {
  //     //   newValueComments[varName] = { ...data.valueComments };
  //     //   
  //     //   // Add general comments to a special '*' key for variable-level comments
  //     //   if (data.generalComments.length > 0) {
  //     //     newValueComments[varName]['*'] = data.generalComments;
  //     //   }
  //     // });
  //     
  //     // setValueComments(prev => {
  //     //   // Merge with existing user comments
  //     //   const merged = { ...prev };
  //     //   Object.entries(newValueComments).forEach(([colName, colComments]) => {
  //     //     merged[colName] = { ...merged[colName], ...colComments };
  //     //   });
  //     //   return merged;
  //     // });
  //   }
  // }, [stateService, enhancedColumns]);

  const updateValueAnnotation = useCallback((columnName: string, rawValue: string, annotation: string) => {
    setEnhancedColumns(prev => prev.map(col => {
      if (col.name === columnName) {
        const newAnnotations = {
          ...col.valueAnnotations,
          [rawValue]: {
            annotation,
            isAIGenerated: false,
            isHumanEdited: true,
            createdAt: new Date().toISOString(),
            lastModified: new Date().toISOString()
          }
        };
        
        // Save to StateService
        if (stateService) {
          stateService.updateVariableField(columnName, 'valueAnnotations', newAnnotations);
        }
        
        return { ...col, valueAnnotations: newAnnotations };
      }
      return col;
    }));
  }, [stateService]);

  // Early return if dataset is not available
  if (!dataset || !dataset.columns || dataset.columns.length === 0) {
    return (
      <div className="flex items-center justify-center h-full bg-[var(--vscode-editor-background)]">
        <div className="text-center text-[var(--vscode-descriptionForeground)]">
          <div className="text-lg mb-2">No dataset available</div>
          <div className="text-sm">Please load a dataset to view its contents</div>
        </div>
      </div>
    );
  }

  const renderDataTypeIcon = (dataType: string, semanticType?: string) => {
    const getColorClass = () => {
      switch (dataType) {
        case 'number': return 'text-blue-400 bg-blue-500/20 opacity-70';
        case 'string': return 'text-green-400 bg-green-500/20 opacity-70';
        case 'boolean': return 'text-purple-400 bg-purple-500/20 opacity-70';
        case 'date': return 'text-orange-400 bg-orange-500/20 opacity-70';
        default: return 'text-gray-400 bg-gray-500/20 opacity-70';
      }
    };

    const getIndicator = () => {
      switch (dataType) {
        case 'number': return 'NUM';
        case 'string': return 'TXT';
        case 'boolean': return 'BOOL';
        case 'date': return 'DATE';
        default: return 'MIX';
      }
    };

    return (
      <span 
        className={`text-xs px-1.5 py-0.5 rounded font-medium mr-2 ${getColorClass()}`}
        title={`${dataType}${semanticType ? ` (${semanticType})` : ''}`}
      >
        {getIndicator()}
      </span>
    );
  };

  // Render charts for expanded columns
  const renderNumericKDEPlot = (column: any) => {
    if (column.dataType !== 'number') return null;
    
    // Check if we have pre-calculated KDE data (from enhanced backend)
    const kdeData = ('kdeData' in column) ? column.kdeData : null;
    const stats = ('numericStats' in column) ? column.numericStats : null;
    
    // If no stats available, try to calculate basic stats from sample data
    let calculatedStats = stats;
    if (!calculatedStats && dataset.data && Array.isArray(dataset.data) && dataset.data.length > 0) {
      const values = dataset.data
        .map(row => row[column.name])
        .filter(v => v != null && !isNaN(Number(v)))
        .map(v => Number(v))
        .sort((a, b) => a - b);
      
      if (values.length > 0) {
        const min = values[0];
        const max = values[values.length - 1];
        const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
        const median = values.length % 2 === 0 
          ? (values[Math.floor(values.length / 2) - 1] + values[Math.floor(values.length / 2)]) / 2
          : values[Math.floor(values.length / 2)];
        const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
        const std = Math.sqrt(variance);
        const q25 = values[Math.floor(values.length * 0.25)];
        const q75 = values[Math.floor(values.length * 0.75)];
        
        calculatedStats = { min, max, mean, median, std, q25, q75 };
      }
    }
    
    if (!calculatedStats) {
      return (
        <div className="mt-2 text-xs text-[var(--vscode-descriptionForeground)]">
          No statistics available for visualization
        </div>
      );
    }
    
    // Use pre-calculated KDE points if available, otherwise generate fallback KDE
    let kdePoints: Array<{x: number, y: number}>;
    
    if (kdeData && kdeData.points && kdeData.points.length > 0) {
      // Use backend-provided KDE data
      kdePoints = kdeData.points;
    } else {
      // Generate fallback KDE approximation
      const iqr = calculatedStats.q75 - calculatedStats.q25;
      const lowerOutlierThreshold = calculatedStats.q25 - 1.5 * iqr;
      const upperOutlierThreshold = calculatedStats.q75 + 1.5 * iqr;
      
      // Simple KDE approximation using FULL range
      kdePoints = [];
      const numPoints = 60;
      const kdeMin = calculatedStats.min;
      const kdeMax = calculatedStats.max;
      const range = kdeMax - kdeMin;
      
      if (range > 0) {
        for (let i = 0; i < numPoints; i++) {
          const x = kdeMin + (i / (numPoints - 1)) * range;
          
          // Multi-modal KDE: stronger peak around median, weaker tails for outliers
          const distanceFromMedian = Math.abs(x - calculatedStats.median) / calculatedStats.std;
          let y;
          
          if (x < lowerOutlierThreshold || x > upperOutlierThreshold) {
            // Outlier regions: lower density
            y = Math.exp(-0.5 * distanceFromMedian * distanceFromMedian) * 0.3;
          } else {
            // Main distribution: normal density
            y = Math.exp(-0.5 * distanceFromMedian * distanceFromMedian);
          }
          
          kdePoints.push({ x, y });
        }
      }
    }
    
    if (kdePoints.length === 0) {
      return (
        <div className="mt-2 text-xs text-[var(--vscode-descriptionForeground)]">
          Unable to generate distribution visualization
        </div>
      );
    }
    
    const { min, max } = calculatedStats;
    
    // Check if we have valid numeric statistics
    if (min == null || max == null) {
      return (
        <div className="mt-2 text-xs text-[var(--vscode-descriptionForeground)]">
          No valid statistics for this numeric column
        </div>
      );
    }
    
    // Calculate max KDE Y for scaling
    const maxKDEY = Math.max(...kdePoints.map((p: any) => p.y));
    
    const svgWidth = 320;
    const svgHeight = 60;
    const padding = 10;
    const plotWidth = svgWidth - 2 * padding;
    const plotHeight = svgHeight - padding;
    
    // Create SVG path for KDE curve
    const createKDEPath = () => {
      if (kdePoints.length === 0) return '';
      
      const xScale = (value: number) => padding + ((value - min) / (max - min)) * plotWidth;
      const yScale = (value: number) => svgHeight - padding - (value / maxKDEY) * (plotHeight - 20);
      
      let path = `M ${xScale(kdePoints[0].x)} ${yScale(kdePoints[0].y)}`;
      
      for (let i = 1; i < kdePoints.length; i++) {
        path += ` L ${xScale(kdePoints[i].x)} ${yScale(kdePoints[i].y)}`;
      }
      
      // Close the area under the curve
      path += ` L ${xScale(kdePoints[kdePoints.length - 1].x)} ${svgHeight - padding}`;
      path += ` L ${xScale(kdePoints[0].x)} ${svgHeight - padding} Z`;
      
      return path;
    };
    
    return (
      <div className="mt-2">
        <div className="text-xs font-medium text-[var(--vscode-descriptionForeground)] mb-1">
          Distribution:
        </div>
        <svg width={svgWidth} height={svgHeight} className="w-full">
          {/* KDE curve including full distribution */}
          <path
            d={createKDEPath()}
            fill="rgba(59, 130, 246, 0.3)"
            stroke="rgb(59, 130, 246)"
            strokeWidth="1.5"
          />
          
          {/* Axis labels */}
          <text
            x={padding}
            y={svgHeight - 2}
            fontSize="10"
            fill="var(--vscode-descriptionForeground)"
            textAnchor="start"
          >
            {min.toFixed(2)}
          </text>
          <text
            x={svgWidth - padding}
            y={svgHeight - 2}
            fontSize="10"
            fill="var(--vscode-descriptionForeground)"
            textAnchor="end"
          >
            {max.toFixed(2)}
          </text>
        </svg>
      </div>
    );
  };

  const renderCategoricalChart = (column: any, valueComments?: {[columnName: string]: {[rawValue: string]: ValueComment[]}}, setEditingValueComment?: (value: {columnName: string, rawValue: string} | null) => void) => {
    if (!column.topValues || column.topValues.length === 0 || column.dataType === 'number') return null;
    
    // Filter out invalid values and calculate maxCount safely
    const validValues = column.topValues.filter((v: any) => v && typeof v.count === 'number' && v.count >= 0);
    if (validValues.length === 0) return null;
    
    const maxCount = Math.max(...validValues.map((v: any) => v.count));
    if (!maxCount || maxCount <= 0) return null;
    
    return (
      <div className="mt-2">
        <div className="text-xs font-medium text-[var(--vscode-descriptionForeground)] mb-1">
          Value Distribution:
        </div>
        <div className="max-h-32 overflow-y-auto border border-[var(--vscode-widget-border)] rounded">
          <table className="w-full text-xs">
            <thead className="bg-[var(--vscode-editorGroupHeader-tabsBackground)] sticky top-0">
              <tr>
                <th className="text-left p-1 border-b border-[var(--vscode-widget-border)] text-[var(--vscode-descriptionForeground)]">Value</th>
                <th className="text-right p-1 border-b border-[var(--vscode-widget-border)] text-[var(--vscode-descriptionForeground)]">Count</th>
                <th className="text-right p-1 border-b border-[var(--vscode-widget-border)] text-[var(--vscode-descriptionForeground)]">%</th>
              </tr>
            </thead>
            <tbody>
              {validValues.map((value: any, index: number) => {
                const valueStr = typeof value.value === 'object' && value.value !== null 
                  ? JSON.stringify(value.value) 
                  : String(value.value || 'N/A');
                const rawValue = String(value.value);
                const annotation = column.valueAnnotations?.[rawValue];
                const valueCommentsForThisValue = valueComments?.[column.name]?.[rawValue] || [];
                
                return (
                  <tr 
                    key={index} 
                    className="group hover:bg-[var(--vscode-list-hoverBackground)]"

                  >
                    <td className="p-1 border-b border-[var(--vscode-widget-border)]/30 max-w-[120px] relative">
                      <div className="flex items-center gap-1">
                        <div 
                          className="truncate flex-1" 
                          title={valueStr.length > 20 ? valueStr : undefined}
                        >
                          {valueStr}
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            trackClick('annotate_value_button', {
                              columnName: column.name,
                              value: valueStr,
                              hasExistingAnnotation: !!annotation
                            });
                            setEditingValueComment?.({ columnName: column.name, rawValue });
                          }}
                          className="opacity-0 group-hover:opacity-100 text-xs px-1 py-0.5 rounded bg-[var(--vscode-button-background)] text-[var(--vscode-button-foreground)] hover:bg-[var(--vscode-button-hoverBackground)] transition-opacity"
                          title="Annotate this value"
                        >
                          📝
                        </button>
                      </div>
                      {/* Show annotation if exists */}
                      {annotation && (
                        <div className={`text-xs mt-1 px-1 py-0.5 rounded ${
                          annotation.isAIGenerated && !annotation.isHumanEdited 
                            ? 'italic bg-blue-500/10 text-blue-400 border border-blue-500/30' 
                            : 'bg-green-500/10 text-green-400 border border-green-500/30'
                        }`}>
                          {annotation.annotation}
                        </div>
                      )}
                      {/* Show comment count if exists */}
                      {valueCommentsForThisValue.length > 0 && (
                        <div className="text-xs text-[var(--vscode-descriptionForeground)] mt-1">
                          💬 {valueCommentsForThisValue.length}
                        </div>
                      )}
                    </td>
                    <td className="p-1 border-b border-[var(--vscode-widget-border)]/30 text-right text-[var(--vscode-descriptionForeground)]">
                      {value.count?.toLocaleString() || '0'}
                    </td>
                    <td className="p-1 border-b border-[var(--vscode-widget-border)]/30 text-right text-[var(--vscode-descriptionForeground)]">
                      {value.percentage != null ? value.percentage.toFixed(1) : '0.0'}%
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  const columnsToUse = enhancedColumns.length > 0 ? enhancedColumns : ((profile?.columns && Array.isArray(profile.columns)) ? profile.columns : dataset.columns.map(name => ({
    name, 
    dataType: 'mixed' as const,
    semanticType: 'text' as const,
    cardinality: 'medium' as const,
    uniqueCount: 0,
    nullCount: 0,
    completeness: 1
  })));

  return (
    <div className="flex flex-col bg-[var(--vscode-editor-background)] flex-1">
      {/* Collapsible Dataset Header */}
      <div className="flex items-center justify-between p-3 bg-[var(--vscode-editor-background)]">
        <div 
          onClick={() => {
            const newExpanded = !isExpanded;
            trackClick('dataset_expand_toggle', {
              action: newExpanded ? 'expand' : 'collapse',
              datasetName: dataset?.name,
              columnCount: dataset?.columns?.length || 0,
              hasBeenExpanded
            });
            setIsExpanded(newExpanded);
            if (newExpanded && !hasBeenExpanded) {
              setHasBeenExpanded(true);
              trackUIStateChange('dataset_first_expansion', {
                datasetName: dataset?.name
              });
            }
          }}
          className="flex items-center space-x-3 cursor-pointer hover:bg-[var(--vscode-list-hoverBackground)] rounded px-2 py-1 transition-colors flex-1"
        >
          <div className="flex items-center space-x-2">
            {/* Expand/Collapse Icon */}
            <svg 
              className={`w-3 h-3 text-[var(--vscode-icon-foreground)] transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`}
              viewBox="0 0 16 16" 
              fill="currentColor"
            >
              <path d="M6 12L10 8L6 4" stroke="currentColor" strokeWidth="2" fill="none"/>
            </svg>
            
            {/* File Icon */}
            <svg className="w-5 h-5 text-[var(--vscode-foreground)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            
            <span className="font-medium text-[var(--vscode-foreground)]">
              {dataset.name}
            </span>
            
            {/* Copy pd.read_csv button */}
            <button
                              onClick={(e) => {
                  e.stopPropagation();
                  // Notebook path for persisted datasets
                  const csvPath = `./.meridian/datasets/${dataset.name}.csv`;
                  navigator.clipboard.writeText(`pd.read_csv('${csvPath}')`);
                }}
                className="p-1 hover:bg-[var(--vscode-toolbar-hoverBackground)] rounded transition-colors"
                title={`Copy pd.read_csv('./.meridian/datasets/${dataset.name}.csv')`}
            >
              <svg className="w-4 h-4 text-[var(--vscode-descriptionForeground)] hover:text-[var(--vscode-foreground)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            </button>
            
            {isGeneratingDefinitions && (
              <span className="text-xs text-[var(--vscode-descriptionForeground)] italic ml-2">Generating AI descriptions...</span>
            )}
          </div>
        </div>
        
        {/* Study Finish + Settings button on the right */}
        <div className="ml-2 flex items-center gap-2">
          {/* {StudyConfigurationService.isStudyMode() && (
            <button
              onClick={() => {
                try {
                  const studyService = StudyConfigurationService.getInstance();
                  const messageService = MessageService.getInstance();
                  messageService.sendMessage('study-finish-condition', {});
                  // Advance local currentConditionCode
                  const config = studyService.getConfiguration();
                  if (config && config.conditionOrder) {
                    const current = (config as any).currentConditionCode as 'A'|'B'|'C' | undefined;
                    const idx = current ? config.conditionOrder.indexOf(current) : 0;
                    const nextCode = config.conditionOrder[idx + 1] as 'A'|'B'|'C' | undefined;
                    if (nextCode) {
                      (config as any).currentConditionCode = nextCode;
                      // Persist via StudyParticipantInterface flow storage
                      localStorage.setItem('study_configuration', JSON.stringify(config));
                      window.dispatchEvent(new CustomEvent('studyConditionAdvanced'));
                    }
                  }
                } catch (e) {
                  console.error('Failed to finish condition', e);
                }
              }}
              className="px-2 py-1 text-xs rounded bg-[var(--vscode-button-background)] text-[var(--vscode-button-foreground)] hover:bg-[var(--vscode-button-hoverBackground)]"
              title="Finish this condition and advance"
            >
              Finish
            </button>
          )} */}
          {settingsButton && (
            <div>
              {settingsButton}
            </div>
          )}
        </div>
      </div>

      {/* Expandable Content */}
      {isExpanded && (
        <div className="transition-all duration-300 ease-in-out overflow-hidden max-h-[500px] opacity-100">
          <div className="overflow-y-auto h-full p-4" style={{ maxHeight: '500px' }}>
            {hasBeenExpanded && enhancedColumns.length === 0 && isGeneratingDefinitions ? (
              /* Loading state when first expanding */
              <div className="flex items-center justify-center h-32">
                <div className="text-center">
                  <div className="text-sm text-[var(--vscode-descriptionForeground)] mb-2">Loading dataset details...</div>
                  <div className="text-xs text-[var(--vscode-descriptionForeground)] italic">Generating AI descriptions...</div>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Dataset metadata */}
                <div className="text-xs text-[var(--vscode-descriptionForeground)] opacity-75 pb-2 border-b border-[var(--vscode-widget-border)]">
                  {dataset.rowCount.toLocaleString()} rows • {dataset.columnCount} columns • Types: {Object.entries(
                    columnsToUse.reduce((acc, col) => {
                      const type = col.dataType === 'string' ? 'TXT' : 
                                  col.dataType === 'number' ? 'NUM' : 
                                  col.dataType === 'boolean' ? 'BOOL' : 'MIX';
                      acc[type] = (acc[type] || 0) + 1;
                      return acc;
                    }, {} as Record<string, number>)
                  ).map(([type, count]) => `${count} ${type}`).join(', ')}
                </div>

            {/* Compact Column Cards - 15 in 400px */}
            <div className="space-y-1" style={{ maxHeight: '400px', overflowY: 'auto' }}>
              {columnsToUse.map((column, index) => (
                <CompactColumnCard
                  key={column.name}
                  column={column}
                  index={index}
                  dataset={dataset}
                  updateField={updateColumnField}
                  onSaveDescription={handleSaveDescription}
                  onSaveUnit={handleSaveUnit}
                  onAcceptAIDescription={handleAcceptAIDescription}
                  onAcceptAIUnit={handleAcceptAIUnit}
                  onAddComment={addComment}
                  onEditComment={editComment}
                  renderDataTypeIcon={renderDataTypeIcon}
                  renderNumericKDEPlot={renderNumericKDEPlot}
                  renderCategoricalChart={(column) => renderCategoricalChart(column, valueComments, setEditingValueComment)}
                  generateValueAnnotations={generateValueAnnotations}
                  updateValueAnnotation={updateValueAnnotation}
                  // Value commenting props
                  valueComments={valueComments}
                  editingValueComment={editingValueComment}
                  newValueCommentText={newValueCommentText}
                  setEditingValueComment={setEditingValueComment}
                  setNewValueCommentText={setNewValueCommentText}
                  addValueComment={addValueComment}
                  deleteValueComment={deleteValueComment}
                />
              ))}
            </div>
            
                {/* Export Button at the end */}
                <div className="pt-4 border-t border-[var(--vscode-widget-border)] flex justify-end">
                  <ExportSemanticLayerButton 
                    stateService={stateService}
                    disabled={!dataset}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

// Compact Column Card Component - redesigned layout
function CompactColumnCard(props: {
  column: any;
  index: number;
  dataset: DatasetInfo;
  updateField: (idx: number, field: string, value: any) => void;
  onSaveDescription: (idx: number) => void;
  onSaveUnit: (idx: number) => void;
  onAcceptAIDescription: (idx: number) => void;
  onAcceptAIUnit: (idx: number) => void;
  onAddComment: (idx: number) => void;
  onEditComment: (colIdx: number, commentId: number) => void;
  renderDataTypeIcon: (dataType: string, semanticType?: string) => React.ReactNode;
  renderNumericKDEPlot: (column: any) => React.ReactNode;
  renderCategoricalChart: (column: any) => React.ReactNode;
  generateValueAnnotations: (columnName: string) => void;
  updateValueAnnotation: (columnName: string, rawValue: string, annotation: string) => void;
  // Value commenting props
  valueComments: {[columnName: string]: {[rawValue: string]: ValueComment[]}};
  editingValueComment: {columnName: string, rawValue: string} | null;
  newValueCommentText: string;
  setEditingValueComment: (value: {columnName: string, rawValue: string} | null) => void;
  setNewValueCommentText: (value: string) => void;
  addValueComment: (columnName: string, rawValue: string, commentText: string) => void;
  deleteValueComment: (columnName: string, rawValue: string, commentId: number) => void;
}) {
  const { trackClick } = useDatasetDictionaryInstrumentation();
  
  const [expanded, setExpanded] = useState(false);
  const [showDescriptionTooltip, setShowDescriptionTooltip] = useState(false);
  const [showUnitTooltip, setShowUnitTooltip] = useState(false);
  const [descriptionTooltipTimer, setDescriptionTooltipTimer] = useState<NodeJS.Timeout | null>(null);
  const [unitTooltipTimer, setUnitTooltipTimer] = useState<NodeJS.Timeout | null>(null);
  const [isRenaming, setIsRenaming] = useState(false);


  const handleCardClick = (e: React.MouseEvent) => {
    // Prevent expansion when clicking on interactive elements
    const target = e.target as Element;
    if (target.closest('button') || target.closest('[contenteditable]') || 
        target.closest('input') || target.closest('textarea')) {
      e.stopPropagation();
      return;
    }
    
    const newExpanded = !expanded;
    trackClick('column_expand_toggle', {
      action: newExpanded ? 'expand' : 'collapse',
      columnName: props.column.name,
      dataType: props.column.dataType,
      semanticType: props.column.semanticType
    });
    
    setExpanded(newExpanded);
  };

  const handleDescriptionKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      (e.target as HTMLElement).blur();
    }
  };

  const handleUnitKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      (e.target as HTMLElement).blur();
    }
  };

  const handleShowDescriptionTooltip = () => {
    // Clear any existing timer and ensure only one tooltip at a time
    if (descriptionTooltipTimer) {
      clearTimeout(descriptionTooltipTimer);
      setDescriptionTooltipTimer(null);
    }
    if (unitTooltipTimer) {
      clearTimeout(unitTooltipTimer);
      setUnitTooltipTimer(null);
    }
    setShowUnitTooltip(false); // Hide unit tooltip when showing description tooltip
    setShowDescriptionTooltip(true);
  };

  const handleHideDescriptionTooltip = () => {
    // Clear any existing timer first to prevent multiple tooltips
    if (descriptionTooltipTimer) {
      clearTimeout(descriptionTooltipTimer);
    }
    const timer = setTimeout(() => {
      setShowDescriptionTooltip(false);
      setDescriptionTooltipTimer(null);
    }, 100); // Reduced delay to 100ms to prevent multiple tooltips
    setDescriptionTooltipTimer(timer);
  };

  const handleShowUnitTooltip = () => {
    // Clear any existing timer and ensure only one tooltip at a time
    if (unitTooltipTimer) {
      clearTimeout(unitTooltipTimer);
      setUnitTooltipTimer(null);
    }
    if (descriptionTooltipTimer) {
      clearTimeout(descriptionTooltipTimer);
      setDescriptionTooltipTimer(null);
    }
    setShowDescriptionTooltip(false); // Hide description tooltip when showing unit tooltip
    setShowUnitTooltip(true);
  };

  const handleHideUnitTooltip = () => {
    // Clear any existing timer first to prevent multiple tooltips
    if (unitTooltipTimer) {
      clearTimeout(unitTooltipTimer);
    }
    const timer = setTimeout(() => {
      setShowUnitTooltip(false);
      setUnitTooltipTimer(null);
    }, 100); // Reduced delay to 100ms to prevent multiple tooltips
    setUnitTooltipTimer(timer);
  };


  return (
    <div 
      className="rounded-lg text-xs bg-[var(--vscode-input-background)] cursor-pointer hover:opacity-80 transition-all duration-200"
      onClick={handleCardClick}
    >
      {/* Redesigned Header - No caret, better layout */}
      <div className="px-3 py-2">
        {/* First line: Type icon + Name + Unit */}
        <div className="flex items-center justify-between">
          <div className="flex items-center flex-1">
            {props.renderDataTypeIcon(props.column.dataType, props.column.semanticType)}
            
            {isRenaming ? (
              <input
                value={props.column.displayName || props.column.name}
                onBlur={(e) => {
                  props.updateField(props.index, 'displayName', e.currentTarget.value.trim() || props.column.name);
                  setIsRenaming(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur();
                  if (e.key === 'Escape') {
                    e.currentTarget.value = props.column.displayName || props.column.name;
                    e.currentTarget.blur();
                  }
                }}
                className="bg-[var(--vscode-input-background)] border border-[var(--vscode-focusBorder)] text-sm font-bold rounded px-1 text-[var(--vscode-input-foreground)] flex-1 min-w-0"
                autoFocus
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <div className="flex items-center flex-1 min-w-0 group">
                <span
                  className="font-bold text-sm text-[var(--vscode-foreground)] hover:bg-[var(--vscode-list-hoverBackground)] rounded px-1 cursor-text inline-block"
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    setIsRenaming(true);
                  }}
                  title={`Double-click to rename: ${props.column.displayName || props.column.name}`}
                >
                  {props.column.displayName || props.column.name}
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    navigator.clipboard.writeText(props.column.name);
                  }}
                  className="ml-1 p-1 opacity-0 group-hover:opacity-100 hover:bg-[var(--vscode-toolbar-hoverBackground)] rounded transition-opacity"
                  title="Copy column name"
                >
                  <svg className="w-3 h-3 text-[var(--vscode-descriptionForeground)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                </button>
              </div>
            )}
          </div>

          {/* Unit in top right with tooltip */}
          <div className="relative">
            <span
              contentEditable
              onBlur={(e) => props.updateField(props.index, 'unit', e.currentTarget.textContent?.trim() || '')}
              onKeyDown={handleUnitKeyDown}
              onMouseEnter={handleShowUnitTooltip}
              onMouseLeave={handleHideUnitTooltip}
              onClick={(e) => e.stopPropagation()}
              className={`text-[var(--vscode-descriptionForeground)] px-2 py-1 rounded hover:bg-[var(--vscode-list-hoverBackground)] min-w-[30px] text-right cursor-text ${
                props.column.isUnitAIGenerated ? 'border-b border-dashed border-[var(--vscode-descriptionForeground)] italic' : ''
              } ${
                !props.column.isUnitHumanEdited && !props.column.isUnitAIGenerated && props.column.unit !== '–' ? 'border-b border-dashed border-[var(--vscode-descriptionForeground)]' : ''
              }`}
              suppressContentEditableWarning
              title="Unit"
            >
              {props.column.unit || '–'}
            </span>
            
            {/* Unit Tooltip */}
            {showUnitTooltip && (props.column.isUnitAIGenerated || (!props.column.isUnitHumanEdited && props.column.unit !== '–')) && (
              <div 
                className="absolute bottom-full right-0 mb-1 px-2 py-1 bg-[var(--vscode-editorHoverWidget-background)] border border-[var(--vscode-editorHoverWidget-border)] rounded text-xs text-[var(--vscode-editorHoverWidget-foreground)] shadow-lg z-10 whitespace-nowrap"
                onMouseEnter={handleShowUnitTooltip}
                onMouseLeave={handleHideUnitTooltip}
              >
                {props.column.isUnitAIGenerated ? (
                  <div className="flex items-center gap-2">
                    <span>AI generated</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        props.onAcceptAIUnit(props.index);
                        setShowUnitTooltip(false);
                      }}
                      className="px-1 py-0.5 rounded bg-[var(--vscode-button-background)] text-[var(--vscode-button-foreground)] hover:bg-[var(--vscode-button-hoverBackground)] text-xs"
                    >
                      Accept
                    </button>
                  </div>
                ) : !props.column.isUnitHumanEdited ? (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      props.onSaveUnit(props.index);
                      setShowUnitTooltip(false);
                    }}
                    className="text-[var(--vscode-button-foreground)] hover:underline"
                  >
                    Human Edited ⟨save⟩
                  </button>
                ) : (
                  'Human edited'
                )}
              </div>
            )}
          </div>

          {/* Comment indicator */}
          {props.column.comments && props.column.comments.length > 0 && (
            <div className="text-[var(--vscode-descriptionForeground)] text-xs ml-2">
              💬{props.column.comments.length}
            </div>
          )}
        </div>

        {/* Second line: Description with tooltip */}
        <div className="mt-1 relative">
          <span
            contentEditable
            onBlur={(e) => props.updateField(props.index, 'description', e.currentTarget.textContent?.trim() || '')}
            onKeyDown={handleDescriptionKeyDown}
            onMouseEnter={handleShowDescriptionTooltip}
            onMouseLeave={handleHideDescriptionTooltip}
            onClick={(e) => e.stopPropagation()}
            className={`text-[var(--vscode-descriptionForeground)] text-xs block w-full hover:bg-[var(--vscode-list-hoverBackground)] rounded px-1 py-0.5 cursor-text ${
              props.column.isDescriptionAIGenerated ? 'border-b border-dashed border-[var(--vscode-descriptionForeground)] italic' : ''
            } ${
              !props.column.isDescriptionHumanEdited && !props.column.isDescriptionAIGenerated ? 'border-b border-dashed border-[var(--vscode-descriptionForeground)]' : ''
            }`}
            suppressContentEditableWarning
            title={props.column.description || 'No description'}
          >
            {props.column.description || 'No description'}
          </span>
          
          {/* Description Tooltip */}
          {showDescriptionTooltip && (props.column.isDescriptionAIGenerated || !props.column.isDescriptionHumanEdited) && (
            <div 
              className="absolute top-full left-0 mt-1 px-2 py-1 bg-[var(--vscode-editorHoverWidget-background)] border border-[var(--vscode-editorHoverWidget-border)] rounded text-xs text-[var(--vscode-editorHoverWidget-foreground)] shadow-lg z-10 whitespace-nowrap"
              onMouseEnter={handleShowDescriptionTooltip}
              onMouseLeave={handleHideDescriptionTooltip}
            >
              {props.column.isDescriptionAIGenerated ? (
                <div className="flex items-center gap-2">
                  <span>AI generated</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      props.onAcceptAIDescription(props.index);
                      setShowDescriptionTooltip(false);
                    }}
                    className="px-1 py-0.5 rounded bg-[var(--vscode-button-background)] text-[var(--vscode-button-foreground)] hover:bg-[var(--vscode-button-hoverBackground)] text-xs"
                  >
                    Accept
                  </button>
                </div>
              ) : !props.column.isDescriptionHumanEdited ? (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    props.onSaveDescription(props.index);
                    setShowDescriptionTooltip(false);
                  }}
                  className="text-[var(--vscode-button-foreground)] hover:underline"
                >
                  Human Edited ⟨save⟩
                </button>
              ) : (
                'Human edited'
              )}
            </div>
          )}
        </div>
      </div>

      {/* Expanded Details with Charts */}
      {expanded && (
        <div 
          className="border-t border-[var(--vscode-widget-border)] bg-[var(--vscode-textBlockQuote-background)] px-3 py-2 text-xs space-y-3"
          onClick={(e) => e.stopPropagation()}
        >
          {(props.column.displayName || props.column.name) !== props.column.name && (
            <p className="text-[var(--vscode-descriptionForeground)]">
              Original: {props.column.name}
            </p>
          )}
          
          {/* Profile Statistics */}
          {props.column.uniqueCount > 0 && (
            <div className="flex justify-between">
              <span className="text-[var(--vscode-descriptionForeground)]">Unique values:</span>
              <span>{props.column.uniqueCount}</span>
            </div>
          )}
          
          {props.column.completeness < 1 && (
            <div className="flex justify-between">
              <span className="text-[var(--vscode-descriptionForeground)]">Completeness:</span>
              <span>{(props.column.completeness * 100).toFixed(1)}%</span>
            </div>
          )}

          {/* Charts/Visualizations */}
          {(() => {
            try {
              if (props.column.dataType === 'number') {
                return props.renderNumericKDEPlot(props.column);
              } else {
                return props.renderCategoricalChart(props.column);
              }
            } catch (error) {
              console.error('Error rendering column visualization:', error, props.column);
              return (
                <div className="mt-2 text-xs text-[var(--vscode-descriptionForeground)]">
                  Unable to display visualization for this column
                </div>
              );
            }
          })()}


          {/* Sample Values */}
          {props.dataset.data && Array.isArray(props.dataset.data) && props.dataset.data.length > 0 && (
            <div>
              <div className="text-[var(--vscode-descriptionForeground)] mb-1">Sample Values:</div>
              <div className="flex flex-wrap gap-1">
                {props.dataset.data.slice(0, 3).map((row, i) => (
                  <span key={i} className="inline-block bg-[var(--vscode-badge-background)] px-1 py-0.5 rounded text-xs">
                    {typeof row[props.column.name] === 'object' && row[props.column.name] !== null 
                      ? JSON.stringify(row[props.column.name]) 
                      : String(row[props.column.name])
                    }
                  </span>
                ))}
              </div>
            </div>
          )}
          
          {/* Comments Section */}
          <div>
            <div className="text-[var(--vscode-descriptionForeground)] mb-1">Comments & Notes:</div>
            <div className="space-y-1">
              {/* Current comment input */}
              <div className="flex gap-1">
                <textarea
                  value={props.column.currentComment || ''}
                  onChange={(e) => props.updateField(props.index, 'currentComment', e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      if ((props.column.currentComment || '').trim()) {
                        props.onAddComment(props.index);
                      }
                    }
                  }}
                  placeholder="Add a comment..."
                  className="flex-1 bg-[var(--vscode-input-background)] border border-[var(--vscode-input-border)] rounded p-1 text-xs text-[var(--vscode-input-foreground)] resize-none"
                  rows={1}
                />
                {(props.column.currentComment || '').trim() && (
                  <button
                    onClick={() => props.onAddComment(props.index)}
                    className="text-xs px-2 py-1 rounded bg-[var(--vscode-button-background)] text-[var(--vscode-button-foreground)] hover:bg-[var(--vscode-button-hoverBackground)]"
                  >
                    Save
                  </button>
                )}
              </div>
              
              {/* Saved comments */}
              {props.column.comments && props.column.comments.map((comment: SavedComment) => (
                <div 
                  key={comment.id}
                  className="p-1 bg-[var(--vscode-input-background)] rounded border-l-2 border-[var(--vscode-textBlockQuote-border)] cursor-pointer hover:bg-[var(--vscode-list-hoverBackground)]"
                  onClick={() => props.onEditComment(props.index, comment.id)}
                >
                  <p className="text-xs text-[var(--vscode-foreground)]">{comment.text}</p>
                  <p className="text-xs text-[var(--vscode-descriptionForeground)]">{comment.timestamp}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
