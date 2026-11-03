/**
 * Utility for parsing and evaluating filter expressions with & and | operators
 * Supports expressions like "cut & clarity", "price | carat", "cut & clarity | price"
 */

export interface FilterExpression {
  type: 'term' | 'and' | 'or';
  value?: string;
  left?: FilterExpression;
  right?: FilterExpression;
}

/**
 * Parse a filter string into an expression tree
 * Supports & (AND) and | (OR) operators with | having lower precedence than &
 * Examples:
 *   "cut" -> { type: 'term', value: 'cut' }
 *   "cut & clarity" -> { type: 'and', left: { type: 'term', value: 'cut' }, right: { type: 'term', value: 'clarity' } }
 *   "cut & clarity | price" -> { type: 'or', left: { type: 'and', ... }, right: { type: 'term', value: 'price' } }
 */
export function parseFilterExpression(filterText: string): FilterExpression {
  const text = filterText.trim();
  if (!text) {
    return { type: 'term', value: '' };
  }

  // Split by | (OR) first (lower precedence)
  const orParts = text.split('|').map(part => part.trim());
  if (orParts.length > 1) {
    let result: FilterExpression = parseAndExpression(orParts[0]);
    for (let i = 1; i < orParts.length; i++) {
      result = {
        type: 'or',
        left: result,
        right: parseAndExpression(orParts[i])
      };
    }
    return result;
  }

  return parseAndExpression(text);
}

function parseAndExpression(text: string): FilterExpression {
  // Split by & (AND) 
  const andParts = text.split('&').map(part => part.trim());
  if (andParts.length > 1) {
    let result: FilterExpression = { type: 'term', value: andParts[0] };
    for (let i = 1; i < andParts.length; i++) {
      result = {
        type: 'and',
        left: result,
        right: { type: 'term', value: andParts[i] }
      };
    }
    return result;
  }

  return { type: 'term', value: text };
}

/**
 * Evaluate a filter expression against searchable text fields
 * @param expression - The parsed filter expression
 * @param searchableText - The text to search in (should be lowercase)
 * @returns true if the expression matches the text
 */
export function evaluateFilterExpression(expression: FilterExpression, searchableText: string): boolean {
  switch (expression.type) {
    case 'term':
      return !expression.value || searchableText.includes(expression.value.toLowerCase());
    
    case 'and':
      return !!(expression.left && expression.right && 
               evaluateFilterExpression(expression.left, searchableText) && 
               evaluateFilterExpression(expression.right, searchableText));
    
    case 'or':
      return !!(expression.left && expression.right && 
               (evaluateFilterExpression(expression.left, searchableText) || 
                evaluateFilterExpression(expression.right, searchableText)));
    
    default:
      return false;
  }
}

/**
 * Create a filter function for analets using multi-query expressions
 * Searches across statement, shortName, explanation, and cellQL fields
 */
export function createAnaletFilter(filterText: string) {
  const expression = parseFilterExpression(filterText);
  
  return (analet: any): boolean => {
    if (!filterText.trim()) {
      return true;
    }

    // Combine all searchable fields
    const searchableFields = [
      analet.statement,
      analet.shortName, 
      analet.explanation,
      analet.cellQL
    ].filter(Boolean).join(' ').toLowerCase();

    return evaluateFilterExpression(expression, searchableFields);
  };
}

/**
 * Create a filter function for generic objects with text fields
 * @param filterText - The filter expression
 * @param textExtractor - Function to extract searchable text from an object
 */
export function createGenericFilter<T>(
  filterText: string, 
  textExtractor: (item: T) => string
) {
  const expression = parseFilterExpression(filterText);
  
  return (item: T): boolean => {
    if (!filterText.trim()) {
      return true;
    }

    const searchableText = textExtractor(item).toLowerCase();
    return evaluateFilterExpression(expression, searchableText);
  };
}
