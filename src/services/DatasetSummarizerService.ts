import * as fs from 'fs';
import * as path from 'path';

// Import types from newSummarizer
interface NumericStatistics {
  min: number;
  max: number;
  mean: number;
  median: number;
  q1: number;
  q3: number;
  standardDeviation: number;
  variance: number;
  skewness?: number;
  kurtosis?: number;
}

interface OutlierInfo {
  count: number;
  percentage: number;
  method: 'IQR' | 'Z-score' | 'modified_z_score';
  sampleValues: any[];
  lowerBound?: number;
  upperBound?: number;
}

interface PatternInfo {
  emails?: number;
  phones?: number;
  urls?: number;
  dates?: number;
  identifiers?: number;
  patterns: string[];
}

interface ColumnProfile {
  name: string;
  dataType: 'string' | 'number' | 'boolean' | 'date' | 'mixed';
  semanticType: 'categorical' | 'numerical' | 'ordinal' | 'temporal' | 'identifier' | 'text' | 'binary';
  cardinality: 'low' | 'medium' | 'high' | 'unique';
  totalCount: number;
  uniqueCount: number;
  uniqueRatio: number;
  missingCount: number;
  missingPercentage: number;
  sampleValues: any[];
  topValues: Array<{ value: any; count: number; percentage: number }>;
  patterns?: PatternInfo;
  statistics?: NumericStatistics;
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
  distributionShape?: 'normal' | 'skewed_left' | 'skewed_right' | 'uniform' | 'bimodal' | 'unknown';
  outliers?: OutlierInfo;
  analysisCapabilities: string[];
  nullCount?: number;
  completeness?: number;
}

interface DataQualityMetrics {
  overall: 'excellent' | 'good' | 'fair' | 'poor';
  overallScore: number;
  completeness: number;
  consistency: number;
  duplicates: number; // Just the count, not the object
}

interface ColumnTypesSummary {
  categorical: number;
  numerical: number;
  ordinal: number;
  temporal: number;
  identifier: number;
  text: number;
  binary: number;
}

interface DatasetProfile {
  fileName: string;
  totalRows: number;
  totalColumns: number;
  fileSize: number;
  columns: ColumnProfile[];
  dataQuality: DataQualityMetrics;
  columnTypesSummary: ColumnTypesSummary;
  relationships?: Array<{
    column1: string;
    column2: string;
    correlation: number;
    strength: 'weak' | 'moderate' | 'strong';
  }>;
  summary: string;
  dataReadiness: {
    needsPreprocessing: boolean;
    issues: string[];
    recommendations: string[];
  };
}

// Legacy interface for backward compatibility
interface DatasetInfo {
  name: string;
  rowCount: number;
  columnCount: number;
  columns: string[];
  firstTwoRows: Record<string, any>[];
  data?: Record<string, any>[];
  filePath?: string;
  fileSize?: number;
}

export class DatasetSummarizerService {
  private static instance: DatasetSummarizerService;
  private datasetProfile: DatasetProfile | null = null;
  private datasetInfo: DatasetInfo | null = null;
  private csvFilePath: string | null = null;

  // Pattern recognition regexes
  private emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  private phoneRegex = /^[+]?[\d\s\-()]{7,15}$/;
  private urlRegex = /^https?:\/\/[^\s]+$/;
  private dateRegex = /^\d{4}-\d{2}-\d{2}|\d{2}\/\d{2}\/\d{4}|\d{2}-\d{2}-\d{4}$/;
  private idRegex = /^[A-Z0-9_-]{3,}$/i;

  private constructor() {}

  public static getInstance(): DatasetSummarizerService {
    if (!DatasetSummarizerService.instance) {
      DatasetSummarizerService.instance = new DatasetSummarizerService();
    }
    return DatasetSummarizerService.instance;
  }

  /**
   * Set the CSV file path for the current dataset so downstream consumers
   * (e.g., column description generation) can read from disk when in-memory
   * rows are not available.
   */
  public setCSVFilePath(filePath: string): void {
    this.csvFilePath = filePath;
    if (this.datasetInfo) {
      this.datasetInfo.filePath = filePath;
    }
  }

  /**
   * Set dataset from parsed CSV data (legacy method for backward compatibility)
   */
  public setDataset(dataset: DatasetInfo): void {
    this.datasetInfo = dataset;
    // Check if we have existing profile data
  }

  /**
   * Set dataset with enhanced profile (for state restoration)
   */
  public setDatasetWithProfile(dataset: DatasetInfo, profile: DatasetProfile): void {
    this.datasetInfo = dataset;
    this.datasetProfile = profile;
  }

  /**
   * Analyze a CSV file and store the comprehensive profile
   */
  public async analyzeCSVFile(filePath: string): Promise<DatasetProfile> {
    try {
      this.csvFilePath = filePath;
      const profile = await this.analyzeFile(filePath);
      this.datasetProfile = profile;

      // Create legacy DatasetInfo for backward compatibility
      this.datasetInfo = {
        name: path.basename(filePath, '.csv'),
        rowCount: profile.totalRows,
        columnCount: profile.totalColumns,
        columns: profile.columns.map(col => col.name),
        firstTwoRows: [] // Will be populated if needed
      };
      return profile;
    } catch (error) {
      console.error('❌ DatasetSummarizerService: Error analyzing CSV file:', error);
      throw error;
    }
  }

  private generateKDEData(data: string[], statistics: NumericStatistics, outliers?: OutlierInfo): any {
    const numericData = data.map(v => parseFloat(v)).filter(v => !isNaN(v)).sort((a, b) => a - b);
    if (numericData.length === 0) return undefined;

    const { min, max, mean, standardDeviation, q1, q3 } = statistics;
    const iqr = q3 - q1;
    const lowerOutlierThreshold = q1 - 1.5 * iqr;
    const upperOutlierThreshold = q3 + 1.5 * iqr;

    // Generate KDE points including outliers
    const kdePoints: Array<{ x: number; y: number }> = [];
    const numPoints = 60;
    const range = max - min;

    if (range > 0) {
      for (let i = 0; i < numPoints; i++) {
        const x = min + (i / (numPoints - 1)) * range;

        // Simple KDE approximation using normal distribution
        let y = 0;
        const bandwidth = standardDeviation * 0.5; // Simple bandwidth selection

        for (const point of numericData) {
          const distance = Math.abs(x - point) / bandwidth;
          y += Math.exp(-0.5 * distance * distance);
        }

        y = y / (numericData.length * bandwidth * Math.sqrt(2 * Math.PI));
        kdePoints.push({ x, y });
      }
    }

    // Count outliers
    const lowOutliers = numericData.filter(v => v < lowerOutlierThreshold);
    const highOutliers = numericData.filter(v => v > upperOutlierThreshold);

    return {
      points: kdePoints,
      outliers: {
        low: { count: lowOutliers.length, threshold: lowerOutlierThreshold },
        high: { count: highOutliers.length, threshold: upperOutlierThreshold }
      }
    };
  }

  /**
   * Clear the current dataset
   */
  public clearDataset(): void {
    this.datasetProfile = null;
    this.datasetInfo = null;
    this.csvFilePath = null;
  }

  /**
   * Generate a basic profile from in-memory dataset data
   * Used for basic analysis when file-based enhanced analysis isn't available
   */
  public async generateBasicProfile(dataset: DatasetInfo): Promise<DatasetProfile> {
    try {
      if (!dataset.data || !Array.isArray(dataset.data) || dataset.data.length === 0) {
        throw new Error('No data available for basic profile generation');
      }

      // Convert data to the format expected by analysis methods
      const headers = dataset.columns;
      const dataRows = dataset.data.map(row =>
        headers.map(col => {
          const val = row[col];
          return val == null ? '' : String(val);
        })
      );

      // Use existing analysis methods
      const columns = await this.analyzeColumns(headers, dataRows);
      const dataQuality = this.calculateDataQuality(dataRows, columns);
      const columnTypesSummary = this.summarizeColumnTypes(columns);
      const relationships = this.detectRelationships(columns, dataRows);

      const profile: DatasetProfile = {
        fileName: `${dataset.name}.csv`,
        totalRows: dataset.rowCount,
        totalColumns: dataset.columnCount,
        fileSize: 0, // Unknown for in-memory data
        columns,
        dataQuality,
        columnTypesSummary,
        relationships,
        summary: this.generateSummary(dataset.rowCount, columns, dataQuality),
        dataReadiness: this.assessDataReadiness(columns, dataQuality)
      };

      // Store the profile
      this.datasetProfile = profile;
      return profile;
    } catch (error) {
      console.error('❌ DatasetSummarizerService: Error generating basic profile:', error);
      throw error;
    }
  }

  /**
   * Check if a dataset is currently loaded
   */
  public hasDataset(): boolean {
    return this.datasetProfile !== null || this.datasetInfo !== null;
  }

  /**
   * Get the current dataset profile (enhanced version)
   */
  public getDatasetProfile(): DatasetProfile | null {
    return this.datasetProfile;
  }

  /**
   * Get the current dataset info (legacy version)
   */
  public getDatasetInfo(): DatasetInfo | null {
    return this.datasetInfo;
  }

  /**
   * Get the full dataset data for frontend usage
   */
  public getFullDatasetData(): any[] | null {
    // First, try to get data from the stored datasetInfo
    if (this.datasetInfo?.data && this.datasetInfo.data.length > 0) {
      return this.datasetInfo.data;
    }

    // If no data in datasetInfo but we have a CSV file path, try to read it
    if (this.csvFilePath) {
      try {
        const Papa = require('papaparse');

        const csvContent = fs.readFileSync(this.csvFilePath, 'utf8');
        const parseResult = Papa.parse(csvContent, {
          header: true,
          skipEmptyLines: true,
          transformHeader: (header: string) => header.trim()
        });

        if (parseResult.errors.length > 0) {
          console.warn('⚠️ [DatasetSummarizerService] CSV parsing warnings:', parseResult.errors);
        }

        const data = parseResult.data as any[];
        // Store the data in datasetInfo for future access
        if (this.datasetInfo) {
          this.datasetInfo.data = data;
        }

        return data;
      } catch (error) {
        console.error('❌ [DatasetSummarizerService] Error reading CSV file:', error);
        return null;
      }
    }

    console.warn('⚠️ [DatasetSummarizerService] No dataset data available - neither in memory nor CSV file');
    return null;
  }

  /**
   * Get comprehensive dataset context for analet generation prompts
   */
  public getDatasetContext(): string {
    if (!this.datasetProfile && !this.datasetInfo) {
      return 'No dataset currently loaded.';
    }

    const profile = this.datasetProfile;
    const info = this.datasetInfo;

    if (profile) {
      const { fileName, totalRows, totalColumns, columns, summary, dataQuality } = profile;

      return `Dataset: "${fileName}"
Dimensions: ${totalRows.toLocaleString()} rows × ${totalColumns} columns
Columns: ${columns.map(col => col.name).join(', ')}
Data Quality: ${dataQuality.overall} (${(dataQuality.overallScore * 100).toFixed(1)}% overall quality)

${summary}

This dataset contains ${totalRows.toLocaleString()} observations across ${totalColumns} variables with ${dataQuality.overall} data quality. The analysis suggests ${this.getDatasetTypeHint()} analysis opportunities.`;
    } else if (info) {
      const { name, rowCount, columnCount, columns } = info;

      return `Dataset: "${name}"
Dimensions: ${rowCount.toLocaleString()} rows × ${columnCount} columns
Columns: ${columns.join(', ')}

This dataset contains ${rowCount.toLocaleString()} observations across ${columnCount} variables. The data structure suggests ${this.getDatasetTypeHint()} analysis opportunities.`;
    }

    return 'Dataset information not available.';
  }

  /**
   * Get detailed column information for context
   */
  public getColumnContext(): string {
    if (!this.datasetProfile && !this.datasetInfo) {
      return 'No dataset columns available.';
    }

    const profile = this.datasetProfile;
    const info = this.datasetInfo;

    if (profile) {
      const { columns } = profile;

      let context = `Available columns (${columns.length} total):\n`;

      columns.forEach((column, index) => {
        context += `${index + 1}. "${column.name}" (${column.dataType}/${column.semanticType})`;
        context += ` - ${column.uniqueCount} unique values (${(column.uniqueRatio * 100).toFixed(1)}% unique)`;

        if (column.topValues.length > 0) {
          const samples = column.topValues.slice(0, 2).map(tv =>
            typeof tv.value === 'string' ? `"${tv.value}"` : tv.value
          ).join(', ');
          context += ` - Top values: ${samples}`;
        }

        if (column.statistics) {
          context += ` - Range: ${column.statistics.min} to ${column.statistics.max}`;
        }

        if (column.missingPercentage > 0) {
          context += ` - Missing: ${column.missingPercentage.toFixed(1)}%`;
        }

        context += '\n';
      });

      return context;
    } else if (info) {
      const { columns, firstTwoRows } = info;

      let context = `Available columns (${columns.length} total):\n`;

      columns.forEach((column, index) => {
        const sampleValues = firstTwoRows.map(row => row[column]).filter(val => val !== null && val !== undefined);
        const valueType = this.inferColumnType(sampleValues);

        context += `${index + 1}. "${column}" (${valueType})`;
        if (sampleValues.length > 0) {
          const samples = sampleValues.slice(0, 2).map(val =>
            typeof val === 'string' ? `"${val}"` : val
          ).join(', ');
          context += ` - Sample values: ${samples}`;
        }
        context += '\n';
      });

      return context;
    }

    return 'Column information not available.';
  }

  /**
   * Get first few rows as context for understanding data structure
   */
  public getFirstRowsContext(): string {
    if (!this.datasetProfile && !this.datasetInfo) {
      return 'No sample data available.';
    }

    const profile = this.datasetProfile;
    const info = this.datasetInfo;

    if (profile) {
      const { columns } = profile;

      let context = `Sample data (showing top values for each column):\n\n`;

      // Create a simple table format using top values
      context += columns.map(col => col.name).join(' | ') + '\n';
      context += columns.map(() => '---').join(' | ') + '\n';

      // Show up to 2 rows of top values
      for (let i = 0; i < Math.min(2, Math.max(...columns.map(col => col.topValues.length))); i++) {
        const values = columns.map(col => {
          const topVal = col.topValues[i];
          if (!topVal) return 'null';
          if (typeof topVal.value === 'string') return `"${topVal.value}"`;
          return String(topVal.value);
        });
        context += values.join(' | ') + '\n';
      }

      return context;
    } else if (info && info.firstTwoRows.length > 0) {
      const { columns, firstTwoRows } = info;

      let context = `Sample data (first ${firstTwoRows.length} rows):\n\n`;

      // Create a simple table format
      context += columns.join(' | ') + '\n';
      context += columns.map(() => '---').join(' | ') + '\n';

      firstTwoRows.forEach(row => {
        const values = columns.map(col => {
          const val = row[col];
          if (val === null || val === undefined) return 'null';
          if (typeof val === 'string') return `"${val}"`;
          return String(val);
        });
        context += values.join(' | ') + '\n';
      });

      return context;
    }

    return 'No sample data available.';
  }

  /**
   * Get file and metadata context
   */
  public getFileContext(): string {
    if (!this.datasetProfile && !this.datasetInfo) {
      return 'No file information available.';
    }

    const profile = this.datasetProfile;
    const info = this.datasetInfo;

    if (profile) {
      const { fileName, totalRows, totalColumns, fileSize, dataQuality } = profile;

      return `File: ${fileName}
Size: ${totalRows.toLocaleString()} rows × ${totalColumns} columns (${(fileSize / 1024).toFixed(1)} KB)
Data Type: Tabular CSV dataset
Quality: ${dataQuality.overall} (${(dataQuality.overallScore * 100).toFixed(1)}% overall quality)
Status: Successfully loaded and analyzed`;
    } else if (info) {
      const { name, rowCount, columnCount } = info;

      return `File: ${name}.csv
Size: ${rowCount.toLocaleString()} rows × ${columnCount} columns
Data Type: Tabular CSV dataset
Status: Successfully loaded and parsed`;
    }

    return 'File information not available.';
  }

  /**
   * Get combined context for analet generation prompts
   */
  public getAnaletGenerationContext(): string {
    if (!this.datasetProfile && !this.datasetInfo) {
      return 'No dataset available for analysis.';
    }

    const profile = this.datasetProfile;

    if (profile) {
      let context = `${this.getFileContext()}

${this.getDatasetContext()}

${this.getColumnContext()}

${this.getFirstRowsContext()}

DATA QUALITY ASSESSMENT:
- Completeness: ${(profile.dataQuality.completeness * 100).toFixed(1)}%
- Consistency: ${(profile.dataQuality.consistency * 100).toFixed(1)}%
- Duplicates: ${profile.dataQuality.duplicates} rows
- Overall Quality: ${profile.dataQuality.overall}`;

      if (profile.dataReadiness.needsPreprocessing) {
        context += `\n\nDATA READINESS ISSUES:
${profile.dataReadiness.issues.map(issue => `- ${issue}`).join('\n')}

RECOMMENDATIONS:
${profile.dataReadiness.recommendations.map(rec => `- ${rec}`).join('\n')}`;
      }

      if (profile.relationships && profile.relationships.length > 0) {
        context += `\n\nKEY RELATIONSHIPS:
${profile.relationships.slice(0, 5).map(rel =>
  `- ${rel.column1} ↔ ${rel.column2}: ${rel.strength} correlation (${rel.correlation.toFixed(3)})`
).join('\n')}`;
      }

      context += `\n\nBased on this comprehensive dataset analysis, you can generate analysis notebooks (analets) that explore relationships, patterns, trends, and insights within this ${profile.dataQuality.overall}-quality data.`;

      return context;
    }

    return `${this.getFileContext()}

${this.getDatasetContext()}

${this.getColumnContext()}

${this.getFirstRowsContext()}

Based on this dataset structure, you can generate analysis notebooks (analets) that explore relationships, patterns, trends, and insights within this data.`;
  }

  /**
   * Get context for specific columns (for targeted analet generation)
   */
  public getColumnSpecificContext(columnNames: string[]): string {
    if (!this.datasetProfile && !this.datasetInfo) {
      return 'No dataset available.';
    }

    const profile = this.datasetProfile;
    const info = this.datasetInfo;

    if (profile) {
      const { columns } = profile;
      const validColumns = columns.filter(col => columnNames.includes(col.name));

      if (validColumns.length === 0) {
        return 'No valid columns specified.';
      }

      let context = `Focus columns: ${validColumns.map(col => col.name).join(', ')}\n\n`;

      validColumns.forEach(column => {
        context += `"${column.name}" (${column.dataType}/${column.semanticType}): `;
        context += `${column.uniqueCount} unique values, `;

        if (column.topValues.length > 0) {
          const samples = column.topValues.slice(0, 2).map(tv =>
            typeof tv.value === 'string' ? `"${tv.value}"` : tv.value
          ).join(', ');
          context += `Top values: ${samples}`;
        }

        if (column.statistics) {
          context += ` Range: ${column.statistics.min}-${column.statistics.max}, Mean: ${column.statistics.mean.toFixed(2)}`;
        }

        context += '\n';
      });

      return context;
    } else if (info) {
      const { columns, firstTwoRows } = info;
      const validColumns = columnNames.filter(col => columns.includes(col));

      if (validColumns.length === 0) {
        return 'No valid columns specified.';
      }

      let context = `Focus columns: ${validColumns.join(', ')}\n\n`;

      validColumns.forEach(column => {
        const sampleValues = firstTwoRows.map(row => row[column]).filter(val => val !== null && val !== undefined);
        const valueType = this.inferColumnType(sampleValues);

        context += `"${column}" (${valueType}): `;
        if (sampleValues.length > 0) {
          const samples = sampleValues.map(val =>
            typeof val === 'string' ? `"${val}"` : val
          ).join(', ');
          context += `Sample values: ${samples}`;
        }
        context += '\n';
      });

      return context;
    }

    return 'Column information not available.';
  }

  /**
   * Get summary statistics context
   */
  public getSummaryContext(): string {
    if (!this.datasetProfile && !this.datasetInfo) {
      return 'No dataset available for summary.';
    }

    const profile = this.datasetProfile;
    const info = this.datasetInfo;

    if (profile) {
      const { fileName, totalRows, totalColumns, columnTypesSummary, dataQuality } = profile;

      let summary = `Dataset Summary for "${fileName}":
- Total observations: ${totalRows.toLocaleString()}
- Variables: ${totalColumns}
- Column types: ${columnTypesSummary.numerical} numerical, ${columnTypesSummary.categorical} categorical, ${columnTypesSummary.temporal} temporal, ${columnTypesSummary.identifier} identifier, ${columnTypesSummary.text} text
- Data quality: ${dataQuality.overall} (${(dataQuality.overallScore * 100).toFixed(1)}% overall quality)
- Completeness: ${(dataQuality.completeness * 100).toFixed(1)}%
- Analysis readiness: ${profile.dataReadiness.needsPreprocessing ? 'Needs preprocessing' : 'Ready for analysis'}`;

      return summary;
    } else if (info) {
      const { name, rowCount, columnCount, columns, firstTwoRows } = info;

      // Analyze column types
      const columnTypes = columns.map(col => {
        const sampleValues = firstTwoRows.map(row => row[col]).filter(val => val !== null && val !== undefined);
        return this.inferColumnType(sampleValues);
      });

      const typeCount = columnTypes.reduce((acc, type) => {
        acc[type] = (acc[type] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      let summary = `Dataset Summary for "${name}":
- Total observations: ${rowCount.toLocaleString()}
- Variables: ${columnCount}`;

      if (Object.keys(typeCount).length > 0) {
        summary += '\n- Column types: ';
        summary += Object.entries(typeCount)
          .map(([type, count]) => `${count} ${type}`)
          .join(', ');
      }

      summary += `\n- Data quality: ${firstTwoRows.length > 0 ? 'Sample data available' : 'No sample data'}`;
      summary += `\n- Analysis readiness: Ready for exploration`;

      return summary;
    }

    return 'Dataset summary not available.';
  }

  // === PRIVATE METHODS - CSV ANALYSIS (from newSummarizer.ts) ===

  private async analyzeFile(filePath: string): Promise<DatasetProfile> {
    const fileStats = fs.statSync(filePath);
    const content = fs.readFileSync(filePath, 'utf-8');
    const rows = this.parseCSV(content);

    if (rows.length === 0) {
      throw new Error('CSV file is empty or invalid');
    }

    const headers = rows[0];
    const dataRows = rows.slice(1);

    const columns = await this.analyzeColumns(headers, dataRows);
    const dataQuality = this.calculateDataQuality(dataRows, columns);
    const columnTypesSummary = this.summarizeColumnTypes(columns);
    const relationships = this.detectRelationships(columns, dataRows);

    const profile: DatasetProfile = {
      fileName: path.basename(filePath),
      totalRows: dataRows.length,
      totalColumns: headers.length,
      fileSize: fileStats.size,
      columns,
      dataQuality,
      columnTypesSummary,
      relationships,
      summary: this.generateSummary(dataRows.length, columns, dataQuality),
      dataReadiness: this.assessDataReadiness(columns, dataQuality)
    };

    return profile;
  }

  private parseCSV(content: string): string[][] {
    const lines = content.split('\n');
    const result: string[][] = [];

    for (const line of lines) {
      if (line.trim() === '') continue;

      const row: string[] = [];
      let current = '';
      let inQuotes = false;

      for (let i = 0; i < line.length; i++) {
        const char = line[i];

        if (char === '"' && (i === 0 || line[i-1] !== '\\')) {
          inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
          row.push(current.trim());
          current = '';
        } else {
          current += char;
        }
      }

      row.push(current.trim());
      result.push(row);
    }

    return result;
  }

  private async analyzeColumns(headers: string[], dataRows: string[][]): Promise<ColumnProfile[]> {
    const columns: ColumnProfile[] = [];

    for (let i = 0; i < headers.length; i++) {
      const columnData = dataRows.map(row => row[i] || '');
      const profile = this.profileColumn(headers[i], columnData);
      columns.push(profile);
    }

    return columns;
  }

  private profileColumn(name: string, data: string[]): ColumnProfile {
    const totalCount = data.length;
    const nonEmptyData = data.filter(val => val !== '' && val !== null && val !== undefined);
    const uniqueValues = new Set(nonEmptyData);
    const uniqueCount = uniqueValues.size;
    const uniqueRatio = uniqueCount / totalCount;
    const missingCount = totalCount - nonEmptyData.length;
    const missingPercentage = (missingCount / totalCount) * 100;

    const dataType = this.inferDataType(nonEmptyData);
    const semanticType = this.inferSemanticType(nonEmptyData, uniqueRatio, dataType);
    const cardinality = this.determineCardinality(uniqueRatio, uniqueCount);
    const sampleValues = this.getSampleValues(nonEmptyData, 5);
    const topValues = this.getTopValues(nonEmptyData, 5);
    const patterns = this.detectPatterns(nonEmptyData);
    const analysisCapabilities = this.determineAnalysisCapabilities(dataType, semanticType, uniqueCount, totalCount);

    let statistics: NumericStatistics | undefined;
    let distributionShape: 'normal' | 'skewed_left' | 'skewed_right' | 'uniform' | 'bimodal' | 'unknown' | undefined;
    let outliers: OutlierInfo | undefined;

    let numericStats: any = undefined;
    let kdeData: any = undefined;

    if (dataType === 'number') {
      statistics = this.calculateNumericStatistics(nonEmptyData);
      distributionShape = this.determineDistributionShape(nonEmptyData, statistics);
      outliers = this.detectOutliers(nonEmptyData, statistics);

      // Generate frontend-compatible numeric stats
      if (statistics) {
        numericStats = {
          min: statistics.min,
          max: statistics.max,
          mean: statistics.mean,
          median: statistics.median,
          std: statistics.standardDeviation,
          q25: statistics.q1,
          q75: statistics.q3
        };

        // Generate KDE data
        kdeData = this.generateKDEData(nonEmptyData, statistics, outliers);
      }
    }

    return {
      name,
      dataType,
      semanticType,
      cardinality,
      totalCount,
      uniqueCount,
      uniqueRatio,
      missingCount,
      missingPercentage,
      sampleValues,
      topValues,
      patterns,
      statistics,
      numericStats,
      kdeData,
      distributionShape,
      outliers,
      analysisCapabilities,
      nullCount: missingCount,
      completeness: (totalCount - missingCount) / totalCount
    };
  }

  private inferDataType(data: string[]): 'string' | 'number' | 'boolean' | 'date' | 'mixed' {
    if (data.length === 0) return 'string';

    const sampleSize = Math.min(100, data.length);
    const sample = data.slice(0, sampleSize);

    let numberCount = 0;
    let booleanCount = 0;
    let dateCount = 0;
    let stringCount = 0;

    for (const value of sample) {
      if (this.isNumber(value)) {
        numberCount++;
      } else if (this.isBoolean(value)) {
        booleanCount++;
      } else if (this.isDate(value)) {
        dateCount++;
      } else {
        stringCount++;
      }
    }

    const threshold = sampleSize * 0.8;

    if (numberCount >= threshold) return 'number';
    if (booleanCount >= threshold) return 'boolean';
    if (dateCount >= threshold) return 'date';
    if (stringCount >= threshold) return 'string';

    return 'mixed';
  }

  private inferSemanticType(data: string[], uniqueRatio: number, dataType: string): 'categorical' | 'numerical' | 'ordinal' | 'temporal' | 'identifier' | 'text' | 'binary' {
    if (dataType === 'number') {
      if (uniqueRatio < 0.1) return 'categorical';
      return 'numerical';
    }

    if (dataType === 'date') return 'temporal';
    if (dataType === 'boolean') return 'binary';

    if (uniqueRatio > 0.9) return 'identifier';
    if (uniqueRatio < 0.1) return 'categorical';

    // Check for text patterns
    const avgLength = data.reduce((sum, val) => sum + val.length, 0) / data.length;
    if (avgLength > 50) return 'text';

    return 'categorical';
  }

  private determineCardinality(uniqueRatio: number, uniqueCount: number): 'low' | 'medium' | 'high' | 'unique' {
    if (uniqueRatio > 0.9) return 'unique';
    if (uniqueCount < 10) return 'low';
    if (uniqueCount < 50) return 'medium';
    return 'high';
  }

  private getSampleValues(data: string[], count: number): any[] {
    const shuffled = [...data].sort(() => 0.5 - Math.random());
    return shuffled.slice(0, count);
  }

  private getTopValues(data: string[], count: number): Array<{ value: any; count: number; percentage: number }> {
    const frequency = new Map<string, number>();

    for (const value of data) {
      frequency.set(value, (frequency.get(value) || 0) + 1);
    }

    const sorted = Array.from(frequency.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, count);

    return sorted.map(([value, count]) => ({
      value,
      count,
      percentage: (count / data.length) * 100
    }));
  }

  private detectPatterns(data: string[]): PatternInfo {
    const patterns: PatternInfo = { patterns: [] };

    let emails = 0;
    let phones = 0;
    let urls = 0;
    let dates = 0;
    let identifiers = 0;

    for (const value of data.slice(0, 100)) { // Sample first 100 values
      if (this.emailRegex.test(value)) emails++;
      if (this.phoneRegex.test(value)) phones++;
      if (this.urlRegex.test(value)) urls++;
      if (this.dateRegex.test(value)) dates++;
      if (this.idRegex.test(value)) identifiers++;
    }

    if (emails > 0) patterns.emails = emails;
    if (phones > 0) patterns.phones = phones;
    if (urls > 0) patterns.urls = urls;
    if (dates > 0) patterns.dates = dates;
    if (identifiers > 0) patterns.identifiers = identifiers;

    return patterns;
  }

  private calculateNumericStatistics(data: string[]): NumericStatistics {
    const numbers = data.map(val => parseFloat(val)).filter(val => !isNaN(val));

    if (numbers.length === 0) {
      return { min: 0, max: 0, mean: 0, median: 0, q1: 0, q3: 0, standardDeviation: 0, variance: 0 };
    }

    const sorted = numbers.sort((a, b) => a - b);
    const n = numbers.length;

    const min = sorted[0];
    const max = sorted[n - 1];
    const mean = numbers.reduce((sum, val) => sum + val, 0) / n;
    const median = n % 2 === 0 ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2 : sorted[Math.floor(n / 2)];
    const q1 = sorted[Math.floor(n * 0.25)];
    const q3 = sorted[Math.floor(n * 0.75)];

    const variance = numbers.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / n;
    const standardDeviation = Math.sqrt(variance);

    return { min, max, mean, median, q1, q3, standardDeviation, variance };
  }

  private determineDistributionShape(data: string[], stats: NumericStatistics): 'normal' | 'skewed_left' | 'skewed_right' | 'uniform' | 'bimodal' | 'unknown' {
    // Simple heuristic based on mean vs median
    const meanMedianDiff = Math.abs(stats.mean - stats.median);
    const threshold = stats.standardDeviation * 0.5;

    if (meanMedianDiff < threshold) return 'normal';
    if (stats.mean > stats.median) return 'skewed_right';
    if (stats.mean < stats.median) return 'skewed_left';

    return 'unknown';
  }

  private detectOutliers(data: string[], stats: NumericStatistics): OutlierInfo {
    const numbers = data.map(val => parseFloat(val)).filter(val => !isNaN(val));
    const iqr = stats.q3 - stats.q1;
    const lowerBound = stats.q1 - 1.5 * iqr;
    const upperBound = stats.q3 + 1.5 * iqr;

    const outliers = numbers.filter(val => val < lowerBound || val > upperBound);

    return {
      count: outliers.length,
      percentage: (outliers.length / numbers.length) * 100,
      method: 'IQR',
      sampleValues: outliers.slice(0, 5),
      lowerBound,
      upperBound
    };
  }

  private determineAnalysisCapabilities(dataType: string, semanticType: string, uniqueCount: number, totalCount: number): string[] {
    const capabilities: string[] = [];

    if (dataType === 'number') {
      capabilities.push('statistical_analysis', 'correlation', 'regression', 'distribution_analysis');
    }

    if (semanticType === 'categorical') {
      capabilities.push('frequency_analysis', 'chi_square_test', 'association_analysis');
    }

    if (semanticType === 'temporal') {
      capabilities.push('time_series_analysis', 'trend_analysis', 'seasonal_analysis');
    }

    if (uniqueCount > 1 && uniqueCount < totalCount) {
      capabilities.push('grouping', 'segmentation');
    }

    return capabilities;
  }

  private calculateDataQuality(dataRows: string[][], columns: ColumnProfile[]): DataQualityMetrics {
    const totalCells = dataRows.length * columns.length;
    const missingCells = columns.reduce((sum, col) => sum + col.missingCount, 0);
    const completeness = (totalCells - missingCells) / totalCells;

    // Simple consistency check (could be enhanced)
    const consistency = 0.9; // Placeholder

    // Duplicate detection
    const rowStrings = dataRows.map(row => row.join('|'));
    const uniqueRows = new Set(rowStrings);
    const duplicates = rowStrings.length - uniqueRows.size;

    const overallScore = (completeness + consistency - (duplicates / dataRows.length)) / 2;

    let overall: 'excellent' | 'good' | 'fair' | 'poor';
    if (overallScore >= 0.9) overall = 'excellent';
    else if (overallScore >= 0.7) overall = 'good';
    else if (overallScore >= 0.5) overall = 'fair';
    else overall = 'poor';

    return {
      overall,
      overallScore,
      completeness,
      consistency,
      duplicates // Just the count
    };
  }

  private summarizeColumnTypes(columns: ColumnProfile[]): ColumnTypesSummary {
    const summary: ColumnTypesSummary = {
      categorical: 0,
      numerical: 0,
      ordinal: 0,
      temporal: 0,
      identifier: 0,
      text: 0,
      binary: 0
    };

    for (const column of columns) {
      summary[column.semanticType]++;
    }

    return summary;
  }

  private detectRelationships(columns: ColumnProfile[], dataRows: string[][]): Array<{
    column1: string;
    column2: string;
    correlation: number;
    strength: 'weak' | 'moderate' | 'strong';
  }> {
    const relationships: Array<{
      column1: string;
      column2: string;
      correlation: number;
      strength: 'weak' | 'moderate' | 'strong';
    }> = [];

    const numericColumns = columns.filter(col => col.dataType === 'number');

    for (let i = 0; i < numericColumns.length; i++) {
      for (let j = i + 1; j < numericColumns.length; j++) {
        const col1 = numericColumns[i];
        const col2 = numericColumns[j];

        const correlation = this.calculateCorrelation(col1.name, col2.name, dataRows, columns);
        const absCorr = Math.abs(correlation);

        let strength: 'weak' | 'moderate' | 'strong';
        if (absCorr >= 0.7) strength = 'strong';
        else if (absCorr >= 0.3) strength = 'moderate';
        else strength = 'weak';

        if (absCorr >= 0.3) { // Only include moderate to strong relationships
          relationships.push({
            column1: col1.name,
            column2: col2.name,
            correlation,
            strength
          });
        }
      }
    }

    return relationships.sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation));
  }

  private calculateCorrelation(col1Name: string, col2Name: string, dataRows: string[][], columns: ColumnProfile[]): number {
    const col1Index = columns.findIndex(col => col.name === col1Name);
    const col2Index = columns.findIndex(col => col.name === col2Name);

    if (col1Index === -1 || col2Index === -1) return 0;

    const pairs: Array<[number, number]> = [];

    for (const row of dataRows) {
      const val1 = parseFloat(row[col1Index]);
      const val2 = parseFloat(row[col2Index]);

      if (!isNaN(val1) && !isNaN(val2)) {
        pairs.push([val1, val2]);
      }
    }

    if (pairs.length < 2) return 0;

    const n = pairs.length;
    const sumX = pairs.reduce((sum, [x]) => sum + x, 0);
    const sumY = pairs.reduce((sum, [, y]) => sum + y, 0);
    const sumXY = pairs.reduce((sum, [x, y]) => sum + x * y, 0);
    const sumX2 = pairs.reduce((sum, [x]) => sum + x * x, 0);
    const sumY2 = pairs.reduce((sum, [, y]) => sum + y * y, 0);

    const numerator = n * sumXY - sumX * sumY;
    const denominator = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));

    return denominator === 0 ? 0 : numerator / denominator;
  }

  private generateSummary(rowCount: number, columns: ColumnProfile[], dataQuality: DataQualityMetrics): string {
    const numericCols = columns.filter(col => col.dataType === 'number').length;
    const categoricalCols = columns.filter(col => col.semanticType === 'categorical').length;
    const temporalCols = columns.filter(col => col.semanticType === 'temporal').length;

    return `This dataset contains ${rowCount.toLocaleString()} records with ${columns.length} variables (${numericCols} numerical, ${categoricalCols} categorical${temporalCols > 0 ? `, ${temporalCols} temporal` : ''}). Data quality is ${dataQuality.overall} with ${(dataQuality.completeness * 100).toFixed(1)}% completeness and ${dataQuality.duplicates} duplicate records.`;
  }

  private assessDataReadiness(columns: ColumnProfile[], dataQuality: DataQualityMetrics): {
    needsPreprocessing: boolean;
    issues: string[];
    recommendations: string[];
  } {
    const issues: string[] = [];
    const recommendations: string[] = [];

    // Check for missing values
    const highMissingColumns = columns.filter(col => col.missingPercentage > 20);
    if (highMissingColumns.length > 0) {
      issues.push(`${highMissingColumns.length} columns have >20% missing values`);
      recommendations.push('Consider imputation strategies for high-missing columns');
    }

    // Check for duplicates
    if (dataQuality.duplicates > 0) {
      issues.push(`${dataQuality.duplicates} duplicate rows found`);
      recommendations.push('Remove or investigate duplicate records');
    }

    // Check for outliers
    const outlierColumns = columns.filter(col => col.outliers && col.outliers.count > 0);
    if (outlierColumns.length > 0) {
      issues.push(`${outlierColumns.length} columns contain outliers`);
      recommendations.push('Review outliers for data quality issues');
    }

    // Check for low cardinality
    const lowCardinalityColumns = columns.filter(col => col.cardinality === 'low' && col.dataType !== 'boolean');
    if (lowCardinalityColumns.length > 0) {
      recommendations.push('Consider encoding categorical variables with low cardinality');
    }

    return {
      needsPreprocessing: issues.length > 0,
      issues,
      recommendations
    };
  }

  /**
   * Legacy helper methods for backward compatibility
   */
  private inferColumnType(sampleValues: any[]): string {
    if (sampleValues.length === 0) return 'unknown';

    const types = new Set(sampleValues.map(val => typeof val));

    if (types.has('number')) return 'numeric';
    if (types.has('boolean')) return 'boolean';
    if (types.has('string')) {
      // Check if string values look like dates
      const hasDatePattern = sampleValues.some(val =>
        typeof val === 'string' && !isNaN(Date.parse(val))
      );
      return hasDatePattern ? 'date/text' : 'text';
    }

    return 'mixed';
  }

  private getDatasetTypeHint(): string {
    const profile = this.datasetProfile;
    const info = this.datasetInfo;

    if (profile) {
      const { totalRows, totalColumns } = profile;

      if (totalRows > 1000 && totalColumns > 10) return 'comprehensive statistical';
      if (totalRows > 100 && totalColumns > 5) return 'statistical';
      if (totalColumns > totalRows) return 'wide-format';
      return 'exploratory';
    } else if (info) {
      const { rowCount, columnCount } = info;

      if (rowCount > 1000 && columnCount > 10) return 'comprehensive statistical';
      if (rowCount > 100 && columnCount > 5) return 'statistical';
      if (columnCount > rowCount) return 'wide-format';
      return 'exploratory';
    }

    return 'unknown';
  }

  private isNumber(value: string): boolean {
    return !isNaN(parseFloat(value)) && isFinite(parseFloat(value));
  }

  private isBoolean(value: string): boolean {
    const lower = value.toLowerCase();
    return ['true', 'false', '1', '0', 'yes', 'no', 'y', 'n'].includes(lower);
  }

  private isDate(value: string): boolean {
    return this.dateRegex.test(value) || !isNaN(Date.parse(value));
  }
}
