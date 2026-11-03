/**
 * Predicate Parser for Conceptual Statements
 * 
 * Supports syntax like:
 * - @IdealDiamond(@cut.Ideal) - single predicate
 * - @GoodDiamonds(@cut.Ideal(x)@cut.[Very Good](x)@cut.[Good](x)) - multiple predicates with OR logic
 * - @IdealDiamonds(@color.Green).grade - nested filtering
 */

export interface Predicate {
  field: string;
  value: string;
  variable?: string; // For (x) binding
}

export interface PredicateEntity {
  name: string;
  predicates: Predicate[];
  isNested?: boolean;
  parentEntity?: string;
}

export interface ParsedStatement {
  entities: PredicateEntity[];
  originalText: string;
}

/**
 * Parse a conceptual statement to extract predicate entities
 */
export function parsePredicateStatement(statement: string): ParsedStatement {
  const entities: PredicateEntity[] = [];
  
  // Enhanced regex to match @EntityName(@field.value) patterns
  // Supports multiple predicates: @Entity(@field1.value1@field2.value2)
  // Supports variable binding: @Entity(@field.value(x))
  // Supports brackets in values: @Entity(@field.[Very Good])
  const entityRegex = /@(\w+)\(([^)]+)\)/g;
  
  let match;
  while ((match = entityRegex.exec(statement)) !== null) {
    const entityName = match[1];
    const predicateString = match[2];
    
    const predicates = parsePredicates(predicateString);
    
    entities.push({
      name: entityName,
      predicates,
      isNested: false
    });
  }
  
  // Also handle nested entities like @IdealDiamonds(@color.Green).field
  const nestedRegex = /@(\w+)\(([^)]+)\)\.(\w+)/g;
  let nestedMatch;
  while ((nestedMatch = nestedRegex.exec(statement)) !== null) {
    const parentEntityName = nestedMatch[1];
    const predicateString = nestedMatch[2];
    const fieldName = nestedMatch[3];
    
    const predicates = parsePredicates(predicateString);
    
    entities.push({
      name: `${parentEntityName}_${fieldName}`,
      predicates,
      isNested: true,
      parentEntity: parentEntityName
    });
  }
  
  return {
    entities,
    originalText: statement
  };
}

/**
 * Parse predicate string like "@cut.Ideal@color.Green(x)" into individual predicates
 */
function parsePredicates(predicateString: string): Predicate[] {
  const predicates: Predicate[] = [];
  
  // Regex to match @field.value or @field.[Value with spaces](x)
  // Supports bracketed values and variable binding
  const predicateRegex = /@(\w+)\.(\[([^\]]+)\]|(\w+))(\((\w+)\))?/g;
  
  let match;
  while ((match = predicateRegex.exec(predicateString)) !== null) {
    const field = match[1];
    const value = match[3] || match[4]; // Bracketed value or simple value
    const variable = match[6]; // Variable binding like (x)
    
    predicates.push({
      field,
      value,
      variable
    });
  }
  
  return predicates;
}

/**
 * Generate filter function for a predicate entity
 */
export function createEntityFilter(entity: PredicateEntity): (row: any) => boolean {
  return (row: any) => {
    // All predicates must be true (AND logic within entity)
    return entity.predicates.every(predicate => {
      const fieldValue = row[predicate.field];
      
      if (fieldValue === undefined || fieldValue === null) {
        return false;
      }
      
      // Convert both to strings for comparison to handle various data types
      const rowValue = String(fieldValue).toLowerCase();
      const predicateValue = predicate.value.toLowerCase();
      
      return rowValue === predicateValue;
    });
  };
}

/**
 * Apply entity filter to dataset and return filtered rows
 */
export function applyEntityFilter(data: any[], entity: PredicateEntity): any[] {
  const filterFn = createEntityFilter(entity);
  return data.filter(filterFn);
}

/**
 * Get unique values for a field in filtered dataset
 */
export function getFilteredFieldValues(data: any[], entity: PredicateEntity, fieldName: string): Array<{value: any, count: number}> {
  const filteredData = applyEntityFilter(data, entity);
  const valueCounts = new Map<any, number>();
  
  filteredData.forEach(row => {
    const value = row[fieldName];
    if (value !== undefined && value !== null) {
      const count = valueCounts.get(value) || 0;
      valueCounts.set(value, count + 1);
    }
  });
  
  return Array.from(valueCounts.entries())
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count); // Sort by count descending
}

/**
 * Extract field names from predicate entities for autocomplete
 */
export function extractFieldsFromStatement(statement: string): string[] {
  const parsed = parsePredicateStatement(statement);
  const fields = new Set<string>();
  
  parsed.entities.forEach(entity => {
    entity.predicates.forEach(predicate => {
      fields.add(predicate.field);
    });
  });
  
  return Array.from(fields);
}

/**
 * Check if a statement contains predicate syntax
 */
export function hasPredicateSyntax(statement: string): boolean {
  return /@\w+\([^)]+\)/.test(statement);
}

/**
 * Generate autocomplete suggestions for predicate entities
 */
export interface PredicateAutocompleteItem {
  type: 'entity' | 'field' | 'value' | 'predicate_template';
  label: string;
  insert: string;
  description?: string;
  count?: number;
}

export function generatePredicateAutocomplete(
  query: string,
  availableFields: string[],
  datasetData?: any[],
  currentEntityContext?: PredicateEntity
): PredicateAutocompleteItem[] {
  const items: PredicateAutocompleteItem[] = [];
  
  // If query starts with @, suggest entity creation templates
  if (query.startsWith('@') && !query.includes('(')) {
    const entityName = query.slice(1);
    
    // Suggest predicate templates
    availableFields.forEach(field => {
      if (field.toLowerCase().includes(entityName.toLowerCase())) {
        items.push({
          type: 'predicate_template',
          label: `${entityName}(@${field}.value)`,
          insert: `@${entityName}(@${field}.`,
          description: `Create entity filtered by ${field}`
        });
      }
    });
  }
  
  // If inside predicate parentheses, suggest field.value combinations
  const predicateMatch = query.match(/@(\w+)\(([^)]*)/);
  if (predicateMatch) {
    const insideParens = predicateMatch[2];
    
    // If has @field. pattern, suggest values
    const fieldMatch = insideParens.match(/@(\w+)\.(\w*)$/);
    if (fieldMatch) {
      const fieldName = fieldMatch[1];
      const valueQuery = fieldMatch[2];
      
      if (datasetData && currentEntityContext) {
        // Get filtered values with counts
        const fieldValues = getFilteredFieldValues(datasetData, currentEntityContext, fieldName);
        
        fieldValues.forEach(({ value, count }) => {
          const valueStr = String(value);
          if (valueStr.toLowerCase().includes(valueQuery.toLowerCase())) {
            // Use brackets for values with spaces
            const needsBrackets = valueStr.includes(' ');
            const insertValue = needsBrackets ? `[${valueStr}]` : valueStr;
            
            items.push({
              type: 'value',
              label: valueStr,
              insert: insertValue,
              description: `${count} rows`,
              count
            });
          }
        });
      }
    } else {
      // Suggest fields
      availableFields.forEach(field => {
        if (field.toLowerCase().includes(insideParens.toLowerCase())) {
          items.push({
            type: 'field',
            label: field,
            insert: `@${field}.`,
            description: `Filter by ${field}`
          });
        }
      });
    }
  }
  
  return items;
}