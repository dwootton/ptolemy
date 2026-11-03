/**
 * Service for managing predicate-based entities and filtering
 */

import { 
  PredicateEntity, 
  parsePredicateStatement, 
  applyEntityFilter, 
  getFilteredFieldValues
} from '../utilities/predicateParser';

export interface EntityDefinition {
  name: string;
  predicates: PredicateEntity['predicates'];
  createdAt: string;
  isBuiltIn?: boolean;
}

export interface FilteredFieldData {
  fieldName: string;
  values: Array<{
    value: any;
    count: number;
    percentage: number;
  }>;
  totalRows: number;
}

export class PredicateEntityService {
  private entities: Map<string, EntityDefinition> = new Map();
  private datasetData: any[] = [];
  private fieldNames: string[] = [];

  constructor(datasetData: any[] = [], fieldNames: string[] = []) {
    this.datasetData = datasetData;
    this.fieldNames = fieldNames;
  }

  /**
   * Update the dataset data
   */
  updateDataset(data: any[], fields: string[]) {
    this.datasetData = data;
    this.fieldNames = fields;
  }

  /**
   * Register a new predicate entity from a statement
   */
  registerEntityFromStatement(statement: string): EntityDefinition[] {
    const parsed = parsePredicateStatement(statement);
    const newEntities: EntityDefinition[] = [];
    
    parsed.entities.forEach(entity => {
      if (!this.entities.has(entity.name)) {
        const entityDef: EntityDefinition = {
          name: entity.name,
          predicates: entity.predicates,
          createdAt: new Date().toISOString(),
          isBuiltIn: false
        };
        
        this.entities.set(entity.name, entityDef);
        newEntities.push(entityDef);
      }
    });
    
    return newEntities;
  }

  /**
   * Get all registered entities
   */
  getAllEntities(): EntityDefinition[] {
    return Array.from(this.entities.values());
  }

  /**
   * Get entity by name
   */
  getEntity(name: string): EntityDefinition | undefined {
    return this.entities.get(name);
  }

  /**
   * Check if entity exists
   */
  hasEntity(name: string): boolean {
    return this.entities.has(name);
  }

  /**
   * Get filtered data for an entity
   */
  getFilteredData(entityName: string): any[] {
    const entity = this.entities.get(entityName);
    if (!entity) {
      return [];
    }

    const predicateEntity: PredicateEntity = {
      name: entity.name,
      predicates: entity.predicates
    };

    return applyEntityFilter(this.datasetData, predicateEntity);
  }

  /**
   * Get field values and counts for a specific entity
   */
  getFieldData(entityName: string, fieldName: string): FilteredFieldData {
    const entity = this.entities.get(entityName);
    if (!entity) {
      return {
        fieldName,
        values: [],
        totalRows: 0
      };
    }

    const predicateEntity: PredicateEntity = {
      name: entity.name,
      predicates: entity.predicates
    };

    const fieldValues = getFilteredFieldValues(this.datasetData, predicateEntity, fieldName);
    const totalRows = this.getFilteredData(entityName).length;

    const valuesWithPercentage = fieldValues.map(({ value, count }) => ({
      value,
      count,
      percentage: totalRows > 0 ? (count / totalRows) * 100 : 0
    }));

    return {
      fieldName,
      values: valuesWithPercentage,
      totalRows
    };
  }

  /**
   * Get all field data for an entity (for autocomplete)
   */
  getAllFieldData(entityName: string): { [fieldName: string]: FilteredFieldData } {
    const result: { [fieldName: string]: FilteredFieldData } = {};
    
    this.fieldNames.forEach(fieldName => {
      result[fieldName] = this.getFieldData(entityName, fieldName);
    });
    
    return result;
  }

  /**
   * Create a nested entity filter (like @IdealDiamonds(@color.Green).grade)
   */
  createNestedFilter(parentEntityName: string, additionalPredicates: PredicateEntity['predicates']): any[] {
    const parentEntity = this.entities.get(parentEntityName);
    if (!parentEntity) {
      return [];
    }

    // Combine parent predicates with additional predicates
    const combinedPredicates = [...parentEntity.predicates, ...additionalPredicates];
    
    const nestedEntity: PredicateEntity = {
      name: `${parentEntityName}_nested`,
      predicates: combinedPredicates,
      isNested: true,
      parentEntity: parentEntityName
    };

    return applyEntityFilter(this.datasetData, nestedEntity);
  }

  /**
   * Get field values for a nested entity
   */
  getNestedFieldData(
    parentEntityName: string, 
    additionalPredicates: PredicateEntity['predicates'], 
    fieldName: string
  ): FilteredFieldData {
    const filteredData = this.createNestedFilter(parentEntityName, additionalPredicates);
    const valueCounts = new Map<any, number>();
    
    filteredData.forEach(row => {
      const value = row[fieldName];
      if (value !== undefined && value !== null) {
        const count = valueCounts.get(value) || 0;
        valueCounts.set(value, count + 1);
      }
    });

    const values = Array.from(valueCounts.entries())
      .map(([value, count]) => ({
        value,
        count,
        percentage: filteredData.length > 0 ? (count / filteredData.length) * 100 : 0
      }))
      .sort((a, b) => b.count - a.count);

    return {
      fieldName,
      values,
      totalRows: filteredData.length
    };
  }

  /**
   * Remove an entity
   */
  removeEntity(name: string): boolean {
    return this.entities.delete(name);
  }

  /**
   * Clear all entities
   */
  clearEntities() {
    this.entities.clear();
  }

  /**
   * Get entity count (how many rows match the entity predicates)
   */
  getEntityCount(entityName: string): number {
    return this.getFilteredData(entityName).length;
  }

  /**
   * Get available field names
   */
  getFieldNames(): string[] {
    return [...this.fieldNames];
  }

  /**
   * Export entities for persistence
   */
  exportEntities(): EntityDefinition[] {
    return Array.from(this.entities.values());
  }

  /**
   * Import entities from persistence
   */
  importEntities(entities: EntityDefinition[]) {
    this.entities.clear();
    entities.forEach(entity => {
      this.entities.set(entity.name, entity);
    });
  }

  /**
   * Validate entity definition
   */
  validateEntity(entity: EntityDefinition): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!entity.name || entity.name.trim() === '') {
      errors.push('Entity name cannot be empty');
    }

    if (!entity.predicates || entity.predicates.length === 0) {
      errors.push('Entity must have at least one predicate');
    }

    entity.predicates.forEach((predicate, index) => {
      if (!predicate.field || predicate.field.trim() === '') {
        errors.push(`Predicate ${index + 1}: field cannot be empty`);
      }

      if (!predicate.value || predicate.value.trim() === '') {
        errors.push(`Predicate ${index + 1}: value cannot be empty`);
      }

      if (!this.fieldNames.includes(predicate.field)) {
        errors.push(`Predicate ${index + 1}: field "${predicate.field}" does not exist in dataset`);
      }
    });

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Get statistics for an entity
   */
  getEntityStats(entityName: string): {
    totalRows: number;
    percentageOfDataset: number;
    fieldCoverage: { [fieldName: string]: number };
  } {
    const filteredData = this.getFilteredData(entityName);
    const totalRows = filteredData.length;
    const datasetSize = this.datasetData.length;
    
    const fieldCoverage: { [fieldName: string]: number } = {};
    this.fieldNames.forEach(fieldName => {
      const nonNullCount = filteredData.filter(row => 
        row[fieldName] !== null && row[fieldName] !== undefined
      ).length;
      fieldCoverage[fieldName] = totalRows > 0 ? (nonNullCount / totalRows) * 100 : 0;
    });

    return {
      totalRows,
      percentageOfDataset: datasetSize > 0 ? (totalRows / datasetSize) * 100 : 0,
      fieldCoverage
    };
  }
}