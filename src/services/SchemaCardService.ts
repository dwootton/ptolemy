/**
 * SchemaCardService - Utility service for building compact dataset context cards
 *
 * This service provides utilities for creating standardized dataset context
 * strings that can be used by adapters when making LLM calls.
 *
 * The goal is to provide consistent, compact dataset descriptions that
 * contain all necessary information for analysis generation.
 */

export interface DatasetInfo {
  name?: string;
  description?: string;
  columns?: Array<{
    name: string;
    type?: string;
    description?: string;
    unit?: string;
    example?: any;
    displayName?: string;
  }>;
  sampleData?: any[];
  rowCount?: number;
  summary?: string;
}

export interface SchemaCardOptions {
  includeTypes?: boolean;
  includeExamples?: boolean;
  includeUnits?: boolean;
  includeSampleData?: boolean;
  maxColumns?: number;
  maxSampleRows?: number;
  compactMode?: boolean;
}

export class SchemaCardService {
  private static instance: SchemaCardService;

  private constructor() {}

  public static getInstance(): SchemaCardService {
    if (!SchemaCardService.instance) {
      SchemaCardService.instance = new SchemaCardService();
    }
    return SchemaCardService.instance;
  }

  /**
   * Build a compact dataset schema card for use in LLM prompts
   */
  public buildDatasetSchemaCard(
    datasetInfo: DatasetInfo,
    options: SchemaCardOptions = {}
  ): string {
    const {
      includeTypes = true,
      includeExamples = true,
      includeUnits = true,
      includeSampleData = false,
      maxColumns = 20,
      maxSampleRows = 3,
      compactMode = false
    } = options;

    const sections: string[] = [];

    // Dataset header
    if (datasetInfo.name) {
      sections.push(`DATASET: ${datasetInfo.name}`);
    }

    // Description
    if (datasetInfo.description) {
      sections.push(`DESCRIPTION: ${datasetInfo.description}`);
    }

    // Row count
    if (datasetInfo.rowCount) {
      sections.push(`ROWS: ${datasetInfo.rowCount.toLocaleString()}`);
    }

    // Columns section
    if (datasetInfo.columns && datasetInfo.columns.length > 0) {
      const columnsToShow = datasetInfo.columns.slice(0, maxColumns);
      const columnLines = columnsToShow.map(col => {
        const parts: string[] = [col.name];

        if (includeTypes && col.type) {
          parts.push(`(${col.type})`);
        }

        if (col.description && !compactMode) {
          parts.push(`- ${col.description}`);
        }

        if (includeUnits && col.unit && col.unit !== '–') {
          parts.push(`[${col.unit}]`);
        }

        if (includeExamples && col.example !== undefined && !compactMode) {
          parts.push(`e.g., ${col.example}`);
        }

        return compactMode ? parts.slice(0, 2).join(' ') : parts.join(' ');
      });

      sections.push('COLUMNS:');
      sections.push(...columnLines.map(line => `- ${line}`));

      if (datasetInfo.columns.length > maxColumns) {
        sections.push(`... and ${datasetInfo.columns.length - maxColumns} more columns`);
      }
    }

    // Sample data
    if (includeSampleData && datasetInfo.sampleData && datasetInfo.sampleData.length > 0) {
      const sampleRows = datasetInfo.sampleData.slice(0, maxSampleRows);
      const columnNames = datasetInfo.columns?.map(c => c.name) || Object.keys(sampleRows[0] || {});

      sections.push('SAMPLE DATA:');
      sampleRows.forEach((row, i) => {
        const values = columnNames.map(col => row[col]).join(', ');
        sections.push(`Row ${i + 1}: ${values}`);
      });
    }

    // Summary
    if (datasetInfo.summary && !compactMode) {
      sections.push(`SUMMARY: ${datasetInfo.summary}`);
    }

    return sections.join('\n');
  }

  /**
   * Build a compact column list for use in prompts
   */
  public buildColumnList(
    columns: Array<{ name: string; type?: string; description?: string }>,
    options: { includeTypes?: boolean; separator?: string } = {}
  ): string {
    const { includeTypes = false, separator = ', ' } = options;

    return columns.map(col => {
      if (includeTypes && col.type) {
        return `${col.name}(${col.type})`;
      }
      return col.name;
    }).join(separator);
  }

  /**
   * Build enhanced context with semantic column definitions
   */
  public buildEnhancedContext(
    baseContext: string,
    columnDefinitions?: Array<{
      name: string;
      displayName?: string;
      type?: string;
      unit?: string;
      description?: string;
      example?: any;
    }>
  ): string {
    if (!columnDefinitions || columnDefinitions.length === 0) {
      return baseContext;
    }

    const columnsText = columnDefinitions
      .filter(col => col && col.name)
      .map(col => {
        const parts = [col.displayName || col.name];

        if (col.type) parts.push(`(${col.type})`);
        if (col.description) parts.push(`: ${col.description}`);
        if (col.unit) parts.push(`[Unit: ${col.unit}]`);
        if (col.example) parts.push(`[Example: ${col.example}]`);

        return `${col.name} - ${parts.join(' ')}`;
      })
      .join('\n');

    return `${baseContext}\n\nSEMANTIC COLUMN DEFINITIONS:\n${columnsText}`;
  }

  /**
   * Extract column information from dataset context string
   */
  public extractColumnsFromContext(context: string): string[] {
    const columns: string[] = [];

    // Look for common column patterns
    const patterns = [
      /columns?[:\s]+([^.\n]+)/i,
      /fields?[:\s]+([^.\n]+)/i,
      /variables?[:\s]+([^.\n]+)/i
    ];

    for (const pattern of patterns) {
      const match = context.match(pattern);
      if (match) {
        const columnText = match[1];
        // Split by common separators and clean up
        const extracted = columnText
          .split(/[,;|]/)
          .map(col => col.trim().replace(/['"]/g, ''))
          .filter(col => col.length > 0 && col.length < 50);

        columns.push(...extracted);
        break; // Use first match found
      }
    }

    return [...new Set(columns)]; // Remove duplicates
  }

  /**
   * Validate dataset info completeness
   */
  public validateDatasetInfo(datasetInfo: DatasetInfo): {
    isValid: boolean;
    warnings: string[];
    suggestions: string[];
  } {
    const warnings: string[] = [];
    const suggestions: string[] = [];

    if (!datasetInfo.name) {
      warnings.push('Dataset name is missing');
    }

    if (!datasetInfo.description || datasetInfo.description.length < 20) {
      warnings.push('Dataset description is missing or too short');
      suggestions.push('Add a descriptive summary of what this dataset contains');
    }

    if (!datasetInfo.columns || datasetInfo.columns.length === 0) {
      warnings.push('Column definitions are missing');
      suggestions.push('Provide column names and types for better analysis generation');
    } else {
      const columnsWithoutTypes = datasetInfo.columns.filter(col => !col.type);
      if (columnsWithoutTypes.length > 0) {
        warnings.push(`${columnsWithoutTypes.length} columns missing type information`);
      }

      const columnsWithoutDescriptions = datasetInfo.columns.filter(col => !col.description);
      if (columnsWithoutDescriptions.length > datasetInfo.columns.length / 2) {
        suggestions.push('Consider adding descriptions for key columns');
      }
    }

    if (!datasetInfo.sampleData || datasetInfo.sampleData.length === 0) {
      suggestions.push('Sample data would help improve analysis generation');
    }

    const isValid = warnings.length === 0 && (datasetInfo.columns?.length ?? 0) > 0;

    return { isValid, warnings, suggestions };
  }
}
