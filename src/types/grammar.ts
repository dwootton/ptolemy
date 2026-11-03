// Formal Grammar AST Types for Meridian Analets

/**
 * Base AST Node interface that all grammar nodes implement
 */
export interface ASTNode {
  type: string;
  id?: string;
  metadata?: {
    line?: number;
    column?: number;
    source?: string;
  };
}

/**
 * Grammar production rule
 * Format: LHS := RHS
 */
export interface ProductionRule extends ASTNode {
  type: 'production';
  lhs: NonTerminal;
  rhs: Expression;
}

/**
 * Complete formal grammar definition
 */
export interface FormalGrammar extends ASTNode {
  type: 'grammar';
  productions: ProductionRule[];
  startSymbol?: NonTerminal;
  terminals: Set<string>;
  nonTerminals: Set<string>;
}

/**
 * Expression types for the right-hand side of productions
 */
export type Expression = 
  | Sequence
  | Alternative
  | Optional
  | Repetition
  | Terminal
  | NonTerminal
  | Concept
  | Function
  | Constraint;

/**
 * Sequence: A B C
 */
export interface Sequence extends ASTNode {
  type: 'sequence';
  elements: Expression[];
}

/**
 * Alternative: A | B | C
 */
export interface Alternative extends ASTNode {
  type: 'alternative';
  choices: Expression[];
}

/**
 * Optional: A?
 */
export interface Optional extends ASTNode {
  type: 'optional';
  expression: Expression;
}

/**
 * Repetition: A* (zero or more) or A+ (one or more)
 */
export interface Repetition extends ASTNode {
  type: 'repetition';
  expression: Expression;
  min: number; // 0 for *, 1 for +
  max?: number; // undefined for unbounded
}

/**
 * Terminal symbol (literal values)
 */
export interface Terminal extends ASTNode {
  type: 'terminal';
  value: string;
  dataType?: 'string' | 'number' | 'boolean' | 'date';
}

/**
 * Non-terminal symbol (references to other productions)
 */
export interface NonTerminal extends ASTNode {
  type: 'nonterminal';
  name: string;
}

/**
 * Concept - domain-specific semantic constructs
 * These are searchable entities like "MPG", "horsepower", etc.
 */
export interface Concept extends ASTNode {
  type: 'concept';
  name: string;
  domain?: string; // e.g., "automotive", "financial"
  semanticType?: 'metric' | 'attribute' | 'entity' | 'relationship';
  aliases?: string[]; // Alternative names for the concept
  description?: string;
}

/**
 * Function - computational operations
 */
export interface Function extends ASTNode {
  type: 'function';
  name: string;
  parameters: Expression[];
  returnType?: string;
}

/**
 * Constraint - conditions or restrictions
 */
export interface Constraint extends ASTNode {
  type: 'constraint';
  operator: 'eq' | 'ne' | 'lt' | 'le' | 'gt' | 'ge' | 'in' | 'contains' | 'matches';
  left: Expression;
  right: Expression;
}

/**
 * Parsed grammar with additional metadata for search and analysis
 */
export interface ParsedGrammar {
  ast: FormalGrammar;
  concepts: Concept[];
  conceptIndex: Map<string, Concept[]>; // For fast concept lookup
  dependencies: Map<string, string[]>; // Non-terminal dependencies
  complexity: {
    productionCount: number;
    conceptCount: number;
    maxDepth: number;
  };
}

/**
 * Search query structure for grammar-based semantic search
 */
export interface GrammarSearchQuery {
  type: 'concept' | 'production' | 'terminal' | 'pattern';
  value: string;
  domain?: string;
  semanticType?: string;
  fuzzy?: boolean; // Enable fuzzy matching for concepts
  maxResults?: number;
}

/**
 * Search result with relevance scoring
 */
export interface GrammarSearchResult {
  analetId: number;
  matchType: 'exact' | 'partial' | 'semantic' | 'alias';
  relevanceScore: number; // 0-1, higher is more relevant
  matches: GrammarMatch[];
}

/**
 * Individual match within a grammar
 */
export interface GrammarMatch {
  nodeType: string;
  nodePath: string; // JSON path to the matched node
  matchedText: string;
  context?: {
    production?: string;
    surrounding?: string;
  };
}

/**
 * Grammar validation result
 */
export interface GrammarValidationResult {
  isValid: boolean;
  errors: GrammarError[];
  warnings: GrammarWarning[];
}

export interface GrammarError {
  type: 'syntax' | 'semantic' | 'reference' | 'structural';
  message: string;
  line?: number;
  column?: number;
  nodeId?: string;
}

export interface GrammarWarning {
  type: 'unused' | 'ambiguous' | 'performance' | 'convention' | 'empty' | 'unknown' | 'type' | 'incomplete' | 'documentation' | 'organization' | 'balance' | 'semantic';
  message: string;
  nodeId?: string;
}

/**
 * Grammar transformation options for LLM generation
 */
export interface GrammarGenerationConfig {
  includeSemanticTypes: boolean;
  generateConcepts: boolean;
  maxComplexity: number;
  domainContext?: string;
  preferredStyle: 'bnf' | 'ebnf' | 'antlr' | 'custom';
}