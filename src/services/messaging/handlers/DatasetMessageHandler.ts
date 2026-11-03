/**
 * DatasetMessageHandler - Handles dataset analysis, storage, and metadata operations
 */

import { BaseMessageHandler } from '../BaseMessageHandler';
import { MessageContext } from '../types';
import { DatasetSummarizerService } from '../../DatasetSummarizerService';
import { NewOpenAIService } from '../../llm/NewOpenAIService';
import { EnhancedColumnDefinitionsResponseSchema } from '../../../schemas/openai-schemas';

export class DatasetMessageHandler extends BaseMessageHandler {

  constructor() {
    super([
      'analyze-dataset',
      'analyze-dataset-from-path',
      'clear-dataset',
      'request-dataset-data',
      'get-dataset-data',
      'get-column-values',
      'generate-column-definitions',
      'generate-column-descriptions',
      'generate-variable-relationships'
    ]);
  }

  public async handle(messageType: string, data: any, context: MessageContext): Promise<void> {
    switch (messageType) {
      case 'analyze-dataset':
        await this.handleAnalyzeDataset(data);
        break;
      case 'analyze-dataset-from-path':
        await this.handleAnalyzeDatasetFromPath(data);
        break;
      case 'clear-dataset':
        await this.handleClearDataset();
        break;
      case 'request-dataset-data':
      case 'get-dataset-data':
        await this.handleGetDatasetData();
        break;
      case 'get-column-values':
        await this.handleGetColumnValues(data);
        break;
      case 'generate-column-definitions':
        await this.handleGenerateColumnDefinitions(data);
        break;
      case 'generate-column-descriptions':
        await this.handleGenerateColumnDescriptions(data);
        break;
      case 'generate-variable-relationships':
        await this.handleGenerateVariableRelationships(data);
        break;
      default:
        throw new Error(`Unsupported message type: ${messageType}`);
    }
  }

  /**
   * Analyze a dataset and store it in the summarizer service
   */
  private async handleAnalyzeDataset(data: any): Promise<void> {
    try {
      const validation = this.validateData(data, ['dataset']);
      if (!validation.isValid) {
        throw new Error(validation.error);
      }

      const { dataset, fileContent } = data;
      this.log('info', 'Analyzing dataset', {
        name: dataset.name,
        rowCount: dataset.rowCount,
        columnCount: dataset.columns?.length
      });

      // Flush any pending logs before switching dataset to avoid mixing contexts
      try {
        if (this.context?.telemetryService) {
          const telemetryService = this.context.telemetryService as any;
          await telemetryService.flushAll();
          // Set dataset name for future logs and rotate session to new files
          telemetryService.setCurrentDatasetName(dataset.name);
          telemetryService.restartSession();
        }
      } catch (e) {
        this.log('warn', 'Failed to flush telemetry before dataset analyze', e);
      }

      // Validate dataset structure
      if (!dataset.name || !dataset.columns || !Array.isArray(dataset.columns)) {
        throw new Error('Invalid dataset structure: missing name or columns');
      }

      // Store dataset in summarizer service
      const summarizerService = DatasetSummarizerService.getInstance();
      summarizerService.setDataset(dataset);

      // If file content is provided, persist it under workspace .meridian/datasets/<name>.csv
      let csvPath: string | undefined;
      if (typeof fileContent === 'string' && fileContent.length > 0 && this.context?.stateService) {
        try {
          const workspaceFolder = (require('vscode').workspace.workspaceFolders?.[0]?.uri.fsPath) as string | undefined;
          const pathMod = require('path');
          const fs = await import('fs');
          const baseDir = workspaceFolder
            ? pathMod.join(workspaceFolder, '.meridian', 'datasets')
            : pathMod.join(process.cwd(), '.meridian', 'datasets');
          await fs.promises.mkdir(baseDir, { recursive: true });
          const savedCsvPath: string = pathMod.join(baseDir, `${dataset.name}.csv`);
          csvPath = savedCsvPath;
          await fs.promises.writeFile(savedCsvPath, fileContent, 'utf8');
          summarizerService.setCSVFilePath(savedCsvPath);
          this.log('info', 'Saved uploaded dataset CSV to disk', { csvPath });
        } catch (e) {
          this.log('warn', 'Failed to persist uploaded CSV; will rely on in-memory data only', e);
        }
      }

      // Compute a profile: prefer file-based enhanced profile if we have a saved CSV; otherwise generate a basic profile
      let profile: any = null;
      try {
        if (csvPath) {
          profile = await summarizerService.analyzeCSVFile(csvPath);
        } else {
          profile = await summarizerService.generateBasicProfile(dataset);
        }
      } catch (e) {
        this.log('warn', 'Failed to compute dataset profile during analyze-dataset', e);
      }

      // Determine datasetInfo for saving (use summarizer datasetInfo if present; else use incoming dataset)
      const datasetInfoForSave = summarizerService.getDatasetInfo() || dataset;

      // Store in state service as well (with profile + file metadata if available)
      if (this.context?.stateService) {
        await this.context.stateService.saveDataset(datasetInfoForSave as any, profile || undefined, {
          loadedAt: new Date().toISOString(),
          source: 'file_upload',
          filePath: csvPath,
          fileSize: typeof fileContent === 'string' ? fileContent.length : undefined,
          version: '1.0'
        } as any);
      }

      this.log('info', 'Dataset analysis completed', { name: dataset.name });
      try {
        console.log('[dataset-bug][extension] analyze-dataset complete', {
          name: dataset?.name,
          savedCsv: !!csvPath,
          csvPath,
          willSendProfile: false,
        });
      } catch {}

      await this.sendMessage('dataset-restored', {
        success: true,
        dataset: datasetInfoForSave,
        profile: profile || undefined,
        enhanced: !!profile
      });
      // Also broadcast profile separately for listeners
      if (profile) {
        await this.sendMessage('dataset-profile', { profile, enhanced: true });
      }
      try { console.log('[dataset-bug][extension] dataset-restored (analyze-dataset)', { name: datasetInfoForSave?.name, sentProfile: !!profile }); } catch {}

    } catch (error) {
      await this.sendError('analyze-dataset', error instanceof Error ? error : String(error), data);
    }
  }

  /**
   * Analyze a dataset from an absolute CSV file path (extension-side file access)
   */
  private async handleAnalyzeDatasetFromPath(data: any): Promise<void> {
    try {
      const validation = this.validateData(data, ['filePath']);
      if (!validation.isValid) {
        throw new Error(validation.error);
      }

      const filePath = String(data.filePath);
      this.log('info', 'Analyzing dataset from path', { filePath });

      const summarizerService = DatasetSummarizerService.getInstance();
      const profile = await summarizerService.analyzeCSVFile(filePath);
      const datasetInfo = summarizerService.getDatasetInfo();
      if (!datasetInfo) throw new Error('Failed to compute dataset info');

      // Persist dataset info + profile
      if (this.context?.stateService) {
        await this.context.stateService.saveDataset(datasetInfo, profile, {
          loadedAt: new Date().toISOString(),
          source: 'file_path',
          filePath
        } as any);
      }

      await this.sendMessage('dataset-restored', {
        success: true,
        dataset: datasetInfo,
        profile,
        enhanced: true
      });
      // Also broadcast profile explicitly
      await this.sendMessage('dataset-profile', { profile, enhanced: true });
      try { console.log('[dataset-bug][extension] dataset-restored (analyze-dataset-from-path)', { name: datasetInfo?.name, sentProfile: !!profile }); } catch {}
    } catch (error) {
      await this.sendError('analyze-dataset-from-path', error instanceof Error ? error : String(error), data);
    }
  }

  /**
   * Clear the current dataset
   */
  private async handleClearDataset(): Promise<void> {
    try {
      this.log('info', 'Clearing dataset');

      // Clear from summarizer service
      const summarizerService = DatasetSummarizerService.getInstance();
      summarizerService.clearDataset();

      // Clear from state service
      if (this.context?.stateService) {
        this.context.stateService.clearDataset();
      }

      await this.sendMessage('dataset-cleared', {
        success: true
      });

    } catch (error) {
      await this.sendError('clear-dataset', error instanceof Error ? error : String(error));
    }
  }

  /**
   * Get the current dataset data
   */
  private async handleGetDatasetData(): Promise<void> {
    try {
      const summarizerService = DatasetSummarizerService.getInstance();
      const datasetInfo = summarizerService.getDatasetInfo();

      if (!datasetInfo) {
        throw new Error('No dataset currently loaded');
      }

      // Get full dataset data
      const datasetData = summarizerService.getFullDatasetData();

      // Get profile data as well
      const datasetProfile = summarizerService.getDatasetProfile();

      this.log('info', 'Returning dataset data', {
        name: datasetInfo.name,
        rowCount: datasetData?.length || 0,
        hasProfile: !!datasetProfile,
        profileColumns: datasetProfile?.columns?.length,
        infoColumns: datasetInfo?.columns?.length
      });


      await this.sendMessage('dataset-data-response', {
        success: true,
        data: datasetData,
        info: datasetInfo,
        profile: datasetProfile // Add profile to the response
      });

    } catch (error) {
      await this.sendError('get-dataset-data', error instanceof Error ? error : String(error));
    }
  }

  /**
   * Get unique values for a specific column
   */
  private async handleGetColumnValues(data: any): Promise<void> {
    try {
      const validation = this.validateData(data, ['columnName']);
      if (!validation.isValid) {
        throw new Error(validation.error);
      }

      const { columnName, limit = 100 } = data;
      this.log('info', 'Getting column values', { columnName, limit });

      const summarizerService = DatasetSummarizerService.getInstance();
      const datasetData = summarizerService.getFullDatasetData();

      if (!datasetData || datasetData.length === 0) {
        throw new Error('No dataset data available');
      }

      // Extract unique values for the column
      const uniqueValues = new Set();
      let totalCount = 0;

      for (const row of datasetData) {
        if (row[columnName] !== undefined && row[columnName] !== null) {
          uniqueValues.add(row[columnName]);
          totalCount++;

          // Stop if we've hit the limit
          if (uniqueValues.size >= limit) {
            break;
          }
        }
      }

      const values = Array.from(uniqueValues).sort();

      await this.sendMessage('column-values-response', {
        success: true,
        columnName,
        values,
        totalUniqueCount: uniqueValues.size,
        totalCount,
        limited: uniqueValues.size >= limit
      });

    } catch (error) {
      await this.sendError('get-column-values', error instanceof Error ? error : String(error), data);
    }
  }

  /**
   * Generate AI-powered column definitions
   */
  private async handleGenerateColumnDefinitions(data: any): Promise<void> {
    try {
      this.log('info', 'Generating column definitions');

      const summarizerService = DatasetSummarizerService.getInstance();
      const datasetInfo = summarizerService.getDatasetInfo();
      let datasetData = summarizerService.getFullDatasetData();
      const datasetProfile = summarizerService.getDatasetProfile();
      const requestedColumns: string[] = Array.isArray(data?.columns)
        ? data.columns.map((c: any) => c?.name).filter((n: any) => typeof n === 'string')
        : (datasetInfo?.columns || []);
      this.log('info', 'Definitions request context', {
        requestedCount: requestedColumns.length,
        requestedPreview: requestedColumns.slice(0, 10),
        hasDatasetInfo: !!datasetInfo,
        dataRows: Array.isArray(datasetData) ? datasetData.length : 0,
        hasProfile: !!datasetProfile,
        profileCols: (datasetProfile as any)?.columns?.length
      });

      // If CSV parsing failed (e.g., papaparse missing) but we have a profile, synthesize sample rows from profile
      if (datasetInfo && (!datasetData || datasetData.length === 0) && datasetProfile && Array.isArray(datasetProfile.columns)) {
        try {
          const columns = datasetInfo.columns || datasetProfile.columns.map(c => c.name);
          const maxRows = 5;
          const rows: any[] = [];
          for (let i = 0; i < maxRows; i++) {
            const row: any = {};
            for (const colName of columns) {
              const colProf = datasetProfile.columns.find(c => c.name === colName);
              const sv = (colProf?.sampleValues || colProf?.topValues?.map(v => (v as any)?.value) || []);
              row[colName] = sv && sv.length > 0 ? sv[i % sv.length] : null;
            }
            rows.push(row);
          }
          datasetData = rows;
          this.log('info', 'Synthesized sample data from profile for definitions');
        } catch (e) {
          this.log('warn', 'Failed to synthesize sample rows from profile', e);
        }
      }

      if (!datasetInfo) {
        throw new Error('No dataset available for column definition generation');
      }

      const openAIService = NewOpenAIService.getInstance();

      // Sample first few rows for analysis (may be synthesized from profile)
      const sampleData = Array.isArray(datasetData) && datasetData.length > 0
        ? datasetData.slice(0, 5)
        : [];
      const columns = requestedColumns && requestedColumns.length > 0 ? requestedColumns : (datasetInfo.columns || []);

      this.log('info', 'Generating definitions for columns', {
        generatingCount: columns.length,
        generatingPreview: columns.slice(0, 10),
        sampleRows: sampleData.length
      });

      // Generate column definitions using OpenAI with structured response
      const prompt = this.buildColumnDefinitionPrompt(columns, sampleData);
      const response = await openAIService.chatStructured({
        system: 'You are a data analysis expert. Generate concise, technical column definitions.',
        user: prompt,
        schema: EnhancedColumnDefinitionsResponseSchema,
        model: 'gpt-4.1-mini'
      });
      const definitions = response;
      try {
        const returned = Array.isArray((definitions as any)?.columns) ? (definitions as any).columns.map((c: any) => c?.name) : [];
        const missing = columns.filter(n => !returned.includes(n));
        this.log('info', 'Definitions result coverage', {
          requested: columns.length,
          returned: returned.length,
          missingCount: missing.length,
          missingPreview: missing.slice(0, 10)
        });
      } catch {}
      await this.sendMessage('column-definitions-response', {
        success: true,
        definitions,
        datasetName: datasetInfo.name
      });

    } catch (error) {
      await this.sendError('generate-column-definitions', error instanceof Error ? error : String(error), data);
    }
  }

  /**
   * Generate AI-powered column descriptions
   */
  private async handleGenerateColumnDescriptions(data: any): Promise<void> {
    try {
      const validation = this.validateData(data, ['columns']);
      if (!validation.isValid) {
        throw new Error(validation.error);
      }

      const { columns, datasetContext } = data;
      // Normalize columns to array of names (support both [string] and [{name: string}])
      const columnNames: string[] = (Array.isArray(columns) ? columns : [])
        .map((c: any) => typeof c === 'string' ? c : (c && typeof c.name === 'string' ? c.name : null))
        .filter((n: any): n is string => typeof n === 'string' && n.trim().length > 0);

      this.log('info', 'Generating column descriptions', { columnCount: columnNames.length });

      const summarizerService = DatasetSummarizerService.getInstance();
      const datasetData = summarizerService.getFullDatasetData();

      if (!datasetData) {
        throw new Error('No dataset data available');
      }

      const openAIService = NewOpenAIService.getInstance();

      // Sample data for each column
      const sampleData = datasetData.slice(0, 10);

      const descriptions: { [key: string]: string } = {};

      // Generate descriptions for each column
      for (const columnName of columnNames) {
        try {
          const columnSample = sampleData
            .map(row => row[columnName])
            .filter((val: any) => val !== null && val !== undefined)
            .slice(0, 10);

          const prompt = this.buildColumnDescriptionPrompt(columnName, columnSample, datasetContext);
          const response = await openAIService.chatText({
            system: 'You are a data analysis expert. Generate concise column descriptions.',
            user: prompt,
            model: 'gpt-4.1-mini'
          });
          descriptions[columnName] = response.trim();

        } catch (error) {
          this.log('warn', `Failed to generate description for column ${columnName}`, error);
          descriptions[columnName] = `Error generating description: ${error instanceof Error ? error.message : 'Unknown error'}`;
        }
      }
      await this.sendMessage('column-descriptions-response', {
        success: true,
        descriptions
      });

    } catch (error) {
      await this.sendError('generate-column-descriptions', error instanceof Error ? error : String(error), data);
    }
  }

  /**
   * Generate AI-powered variable relationships
   */
  private async handleGenerateVariableRelationships(data: any): Promise<void> {
    try {
      this.log('info', 'Generating variable relationships');

      const summarizerService = DatasetSummarizerService.getInstance();
      const datasetInfo = summarizerService.getDatasetInfo();
      const datasetData = summarizerService.getFullDatasetData();

      if (!datasetInfo || !datasetData) {
        throw new Error('No dataset available for relationship generation');
      }

      const openAIService = NewOpenAIService.getInstance();
      const columns = datasetInfo.columns;

      // Sample data for analysis
      const sampleData = datasetData.slice(0, 20);

      const prompt = this.buildVariableRelationshipPrompt(columns, sampleData);
      const response = await openAIService.chatText({
        system: 'You are a data analysis expert. Identify variable relationships in datasets.',
        user: prompt,
        model: 'gpt-4.1-mini'
      });
      const relationships = this.parseVariableRelationships(response);

      await this.sendMessage('variable-relationships-response', {
        success: true,
        relationships,
        datasetName: datasetInfo.name
      });

    } catch (error) {
      await this.sendError('generate-variable-relationships', error instanceof Error ? error : String(error), data);
    }
  }

  /**
   * Build prompt for column definition generation
   */
  private buildColumnDefinitionPrompt(columns: string[], sampleData: any[]): string {
    return `Analyze this dataset and provide concise, technical definitions for each column.

Dataset columns: ${columns.join(', ')}

Sample data (first 5 rows):
${sampleData.map(row => JSON.stringify(row)).join('\n')}

For each column, provide:
1. A user-friendly display name (keep original if already good)
2. Data type (string, int, float, boolean, date)
3. Unit of measurement (CRITICAL: provide specific units like mph, kg, $, %, count, etc. - use "–" ONLY if truly no unit applies)
4. ONE SENTENCE description explaining what the column represents (be concise but informative)
5. A representative example value from the sample data

IMPORTANT RULES:
- Descriptions must be exactly ONE SENTENCE
- Units are critical - identify and return proper units whenever possible
- Use actual column names from the provided list
- Infer data types from sample data when available
- Use realistic example values based on sample data`;
  }

  /**
   * Build prompt for individual column description
   */
  private buildColumnDescriptionPrompt(columnName: string, sampleValues: any[], datasetContext?: string): string {
    const formattedSamples = sampleValues
      .slice(0, 10)
      .map(v => (typeof v === 'object' && v !== null) ? JSON.stringify(v) : String(v))
      .join(', ');
    return `Analyze this column from a dataset and provide a concise description.

Dataset context: ${datasetContext || 'N/A'}
Column name: ${columnName}
Sample values: ${formattedSamples}

Provide EXACTLY ONE SENTENCE describing what this column represents, including:
- What the data measures or describes
- The unit of measurement (if applicable)
- The type of values it contains

Keep it technical but accessible. The description must be one complete sentence only.`;
  }

  /**
   * Build prompt for variable relationship generation
   */
  private buildVariableRelationshipPrompt(columns: string[], sampleData: any[]): string {
    return `Analyze the relationships between variables in this dataset.

Columns: ${columns.join(', ')}

Sample data:
${sampleData.slice(0, 10).map(row => JSON.stringify(row)).join('\n')}

Identify potential relationships between variables:
1. Correlations (positive, negative, non-linear)
2. Dependencies (one variable depends on others)
3. Categorical groupings
4. Temporal relationships
5. Hierarchical relationships

Return as JSON array:
[
  {
    "variables": ["var1", "var2"],
    "relationship": "correlation|dependency|grouping|temporal|hierarchical",
    "strength": "weak|moderate|strong",
    "description": "brief explanation of the relationship"
  }
]`;
  }

  /**
   * Parse column definitions from AI response (removed - now handled by zod schema validation)
   */

  /**
   * Parse variable relationships from AI response
   */
  private parseVariableRelationships(response: string): any[] {
    try {
      // Extract JSON array from response
      const jsonMatch = response.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        throw new Error('No JSON array found in response');
      }

      return JSON.parse(jsonMatch[0]);
    } catch (error) {
      this.log('error', 'Failed to parse variable relationships', error);
      return [];
    }
  }
}
