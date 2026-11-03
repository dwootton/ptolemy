/**
 * Service for extracting and analyzing values from dataset columns
 */

export interface ColumnValueData {
  value: any;
  count: number;
  percentage: number;
  displayValue: string; // Human-readable version
}

export interface ColumnAnalysis {
  fieldName: string;
  totalRows: number;
  uniqueValues: number;
  nullCount: number;
  values: ColumnValueData[];
  dataType: 'string' | 'number' | 'boolean' | 'mixed';
}

export class DatasetValueExtractor {
  private data: any[];
  private cache: Map<string, ColumnAnalysis> = new Map();

  constructor(data: any[] = []) {
    this.data = data;
  }

  /**
   * Update the dataset data and clear cache
   */
  updateData(data: any[]) {
    this.data = data;
    this.cache.clear();
  }

  /**
   * Get comprehensive analysis of a column's values
   */
  analyzeColumn(fieldName: string): ColumnAnalysis {
    // Check cache first
    const cacheKey = `${fieldName}`;
    if (this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey)!;
      return cached;
    }

    const valueCounts = new Map<any, number>();
    let nullCount = 0;
    let totalRows = this.data.length;
    
    // Count occurrences of each value
    this.data.forEach(row => {
      const value = row[fieldName];
      if (value === null || value === undefined || value === '') {
        nullCount++;
      } else {
        const count = valueCounts.get(value) || 0;
        valueCounts.set(value, count + 1);
      }
    });
    // Convert to sorted array with percentages
    const values: ColumnValueData[] = Array.from(valueCounts.entries())
      .map(([value, count]) => ({
        value,
        count,
        percentage: totalRows > 0 ? (count / totalRows) * 100 : 0,
        displayValue: this.formatDisplayValue(value)
      }))
      .sort((a, b) => b.count - a.count); // Sort by frequency descending

    // Detect data type
    const dataType = this.detectDataType(values.map(v => v.value));

    const analysis: ColumnAnalysis = {
      fieldName,
      totalRows,
      uniqueValues: values.length,
      nullCount,
      values,
      dataType
    };

    // Cache the result
    this.cache.set(cacheKey, analysis);
    return analysis;
  }

  /**
   * Get filtered column analysis based on predicate constraints
   */
  analyzeColumnWithFilter(
    fieldName: string, 
    filterPredicates: Array<{ field: string; value: any }>
  ): ColumnAnalysis {
    // Create cache key that includes filter predicates
    const filterKey = filterPredicates
      .map(p => `${p.field}:${p.value}`)
      .sort()
      .join('|');
    const cacheKey = `${fieldName}|filtered:${filterKey}`;
    
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    // Apply filters to get subset of data
    const filteredData = this.data.filter(row => {
      return filterPredicates.every(predicate => {
        const rowValue = row[predicate.field];
        return this.valuesMatch(rowValue, predicate.value);
      });
    });

    // Analyze the filtered data
    const valueCounts = new Map<any, number>();
    let nullCount = 0;
    const totalRows = filteredData.length;
    
    filteredData.forEach(row => {
      const value = row[fieldName];
      if (value === null || value === undefined || value === '') {
        nullCount++;
      } else {
        const count = valueCounts.get(value) || 0;
        valueCounts.set(value, count + 1);
      }
    });

    const values: ColumnValueData[] = Array.from(valueCounts.entries())
      .map(([value, count]) => ({
        value,
        count,
        percentage: totalRows > 0 ? (count / totalRows) * 100 : 0,
        displayValue: this.formatDisplayValue(value)
      }))
      .sort((a, b) => b.count - a.count);

    const dataType = this.detectDataType(values.map(v => v.value));

    const analysis: ColumnAnalysis = {
      fieldName,
      totalRows,
      uniqueValues: values.length,
      nullCount,
      values,
      dataType
    };

    this.cache.set(cacheKey, analysis);
    return analysis;
  }

  /**
   * Get top N values for a field (for quick suggestions)
   */
  getTopValues(fieldName: string, limit: number = 10): ColumnValueData[] {
    const analysis = this.analyzeColumn(fieldName);
    return analysis.values.slice(0, limit);
  }

  /**
   * Get quartile values for numeric fields
   */
  getQuartiles(fieldName: string): { q1: number; q2: number; q3: number; q4: number } | null {
    // Extract numeric values from the field
    const numericValues: number[] = [];
    this.data.forEach(row => {
      const value = row[fieldName];
      if (value !== null && value !== undefined && value !== '') {
        const numValue = typeof value === 'number' ? value : parseFloat(String(value));
        if (!isNaN(numValue)) {
          numericValues.push(numValue);
        }
      }
    });

    if (numericValues.length === 0) {
      return null;
    }

    // Sort values for quartile calculation
    numericValues.sort((a, b) => a - b);
    
    const n = numericValues.length;
    const q1Index = Math.floor(n * 0.25);
    const q2Index = Math.floor(n * 0.5);
    const q3Index = Math.floor(n * 0.75);
    
    const quartiles = {
      q1: numericValues[q1Index],
      q2: numericValues[q2Index], // median
      q3: numericValues[q3Index],
      q4: numericValues[n - 1] // max value
    };
    return quartiles;
  }

  /**
   * Get quartile ranges with counts and percentages for a numeric field
   */
  getQuartileRanges(
    fieldName: string
  ): {
    min: number;
    q1: number;
    q2: number;
    q3: number;
    max: number;
    ranges: Array<{ key: 'q1' | 'q2' | 'q3' | 'q4'; start: number; end: number; count: number; percentage: number }>
  } | null {
    // Extract numeric values
    const values: number[] = [];
    this.data.forEach(row => {
      const v = row[fieldName];
      if (v !== null && v !== undefined && v !== '') {
        const n = typeof v === 'number' ? v : parseFloat(String(v));
        if (!isNaN(n)) values.push(n);
      }
    });
    if (values.length === 0) return null;
    values.sort((a, b) => a - b);
    const n = values.length;
    const min = values[0];
    const max = values[n - 1];
    const q1Index = Math.floor(n * 0.25);
    const q2Index = Math.floor(n * 0.5);
    const q3Index = Math.floor(n * 0.75);
    const q1 = values[q1Index];
    const q2 = values[q2Index];
    const q3 = values[q3Index];
    const counts = { q1: 0, q2: 0, q3: 0, q4: 0 } as Record<'q1'|'q2'|'q3'|'q4', number>;
    for (const v of values) {
      if (v <= q1) counts.q1++;
      else if (v <= q2) counts.q2++;
      else if (v <= q3) counts.q3++;
      else counts.q4++;
    }
    const total = values.length || 1;
    return {
      min,
      q1,
      q2,
      q3,
      max,
      ranges: [
        { key: 'q1', start: min, end: q1, count: counts.q1, percentage: (counts.q1 / total) * 100 },
        { key: 'q2', start: q1, end: q2, count: counts.q2, percentage: (counts.q2 / total) * 100 },
        { key: 'q3', start: q2, end: q3, count: counts.q3, percentage: (counts.q3 / total) * 100 },
        { key: 'q4', start: q3, end: max, count: counts.q4, percentage: (counts.q4 / total) * 100 }
      ]
    };
  }

  /**
   * Check if a field contains primarily numeric data
   */
  isNumericField(fieldName: string): boolean {
    let numericCount = 0;
    let totalCount = 0;
    
    for (const row of this.data) {
      const value = row[fieldName];
      if (value !== null && value !== undefined && value !== '') {
        totalCount++;
        const numValue = typeof value === 'number' ? value : parseFloat(String(value));
        if (!isNaN(numValue)) {
          numericCount++;
        }
      }
    }
    
    // Consider field numeric if >80% of values are numeric
    const isNumeric = totalCount > 0 && (numericCount / totalCount) > 0.8;
    return isNumeric;
  }

  /**
   * Get top N values with filtering
   */
  getTopValuesWithFilter(
    fieldName: string, 
    filterPredicates: Array<{ field: string; value: any }>,
    limit: number = 10
  ): ColumnValueData[] {
    const analysis = this.analyzeColumnWithFilter(fieldName, filterPredicates);
    return analysis.values.slice(0, limit);
  }

  /**
   * Search for values matching a query
   */
  searchValues(fieldName: string, query: string, limit: number = 10): ColumnValueData[] {
    const analysis = this.analyzeColumn(fieldName);
    const queryLower = query.toLowerCase();
    
    return analysis.values
      .filter(valueInfo => 
        valueInfo.displayValue.toLowerCase().includes(queryLower)
      )
      .slice(0, limit);
  }

  /**
   * Search for values with filtering
   */
  searchValuesWithFilter(
    fieldName: string,
    query: string,
    filterPredicates: Array<{ field: string; value: any }>,
    limit: number = 10
  ): ColumnValueData[] {
    const analysis = this.analyzeColumnWithFilter(fieldName, filterPredicates);
    const queryLower = query.toLowerCase();
    
    return analysis.values
      .filter(valueInfo => 
        valueInfo.displayValue.toLowerCase().includes(queryLower)
      )
      .slice(0, limit);
  }

  /**
   * Check if two values match (handles different data types)
   */
  private valuesMatch(rowValue: any, predicateValue: any): boolean {
    if (rowValue === predicateValue) return true;
    
    // Handle case-insensitive string matching
    if (typeof rowValue === 'string' && typeof predicateValue === 'string') {
      return rowValue.toLowerCase() === predicateValue.toLowerCase();
    }
    
    // Handle number comparison
    if (typeof rowValue === 'number' || typeof predicateValue === 'number') {
      return Number(rowValue) === Number(predicateValue);
    }
    
    return false;
  }

  /**
   * Format a value for display (handle different data types)
   */
  private formatDisplayValue(value: any): string {
    if (value === null || value === undefined) {
      return '<null>';
    }
    
    if (typeof value === 'string') {
      return value;
    }
    
    if (typeof value === 'number') {
      // Format numbers nicely
      if (Number.isInteger(value)) {
        return value.toLocaleString();
      } else {
        return value.toFixed(2);
      }
    }
    
    if (typeof value === 'boolean') {
      return value ? 'true' : 'false';
    }
    
    return String(value);
  }

  /**
   * Detect the primary data type of a column
   */
  private detectDataType(values: any[]): 'string' | 'number' | 'boolean' | 'mixed' {
    if (values.length === 0) return 'string';
    
    let stringCount = 0;
    let numberCount = 0;
    let booleanCount = 0;
    
    values.forEach(value => {
      if (typeof value === 'string') stringCount++;
      else if (typeof value === 'number') numberCount++;
      else if (typeof value === 'boolean') booleanCount++;
    });
    
    const total = values.length;
    const threshold = 0.8; // 80% threshold
    
    if (numberCount / total >= threshold) return 'number';
    if (booleanCount / total >= threshold) return 'boolean';
    if (stringCount / total >= threshold) return 'string';
    
    return 'mixed';
  }

  /**
   * Get available field names
   */
  getAvailableFields(): string[] {
    if (this.data.length === 0) return [];
    
    // Get all unique keys from the first few rows
    const fields = new Set<string>();
    this.data.slice(0, 10).forEach(row => {
      Object.keys(row).forEach(key => fields.add(key));
    });
    
    return Array.from(fields).sort();
  }

  /**
   * Clear cache (useful when data changes)
   */
  clearCache() {
    this.cache.clear();
  }

  /**
   * Get cache statistics for debugging
   */
  getCacheStats() {
    return {
      cacheSize: this.cache.size,
      dataRows: this.data.length
    };
  }
}