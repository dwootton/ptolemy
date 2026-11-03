/**
 * Service for materializing conceptual statements into concrete analets
 */

import { ConceptualStatement, Analet } from '../types/analet';

export interface MaterializationRequest {
  statement: ConceptualStatement;
  datasetInfo: {
    name: string;
    columns: string[];
    sampleData?: any[];
    description?: string;
  };
  maxAnalets?: number;
}

export interface MaterializationResult {
  success: boolean;
  analets: Analet[];
  error?: string;
  generationDetails?: {
    strategy: string;
    reasoning: string;
    complexity: 'simple' | 'moderate' | 'complex';
  };
}

export interface AnaletTemplate {
  statement: string;
  formalGrammar: string;
  explanation: string;
  tags: string[];
  priority: number; // 1-10, higher = more important
  complexity: 'simple' | 'moderate' | 'complex';
}

export class ConceptualMaterializationService {
  private messageService: any; // For OpenAI API calls

  constructor(messageService?: any) {
    this.messageService = messageService;
  }

  /**
   * Materialize a conceptual statement into concrete analets
   */
  async materialize(request: MaterializationRequest): Promise<MaterializationResult> {
    try {
      // Analyze the conceptual statement to determine complexity and strategy
      const analysis = this.analyzeStatement(request.statement, request.datasetInfo);
      
      // Generate analet templates based on the analysis
      const templates = await this.generateAnaletTemplates(request, analysis);
      
      // Convert templates to actual analets
      const analets = this.createAnaletsFromTemplates(templates, request.statement);
      
      return {
        success: true,
        analets,
        generationDetails: {
          strategy: analysis.strategy,
          reasoning: analysis.reasoning,
          complexity: analysis.complexity
        }
      };
    } catch (error) {
      return {
        success: false,
        analets: [],
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

  /**
   * Analyze a conceptual statement to determine materialization strategy
   */
  private analyzeStatement(statement: ConceptualStatement, datasetInfo: any): {
    complexity: 'simple' | 'moderate' | 'complex';
    strategy: string;
    reasoning: string;
    suggestedAnaletCount: number;
    keyVariables: string[];
    relationships: string[];
  } {
    const text = statement.text.toLowerCase();
    const availableColumns = datasetInfo.columns || [];
    
    // Extract mentioned variables/columns
    const mentionedVariables = this.extractMentionedVariables(statement.text, availableColumns);
    
    // Detect relationship types
    const relationships = this.extractRelationships(text);
    
    // Determine complexity based on various factors
    let complexity: 'simple' | 'moderate' | 'complex' = 'simple';
    let suggestedAnaletCount = 1;
    
    if (mentionedVariables.length > 3 || relationships.length > 2) {
      complexity = 'complex';
      suggestedAnaletCount = 4 + Math.min(mentionedVariables.length - 3, 3);
    } else if (mentionedVariables.length > 2 || relationships.length > 1) {
      complexity = 'moderate';
      suggestedAnaletCount = 2 + mentionedVariables.length;
    }
    
    // Determine strategy
    let strategy = 'descriptive';
    if (text.includes('correlat') || text.includes('relationship')) {
      strategy = 'correlation-analysis';
    } else if (text.includes('group') || text.includes('categor')) {
      strategy = 'categorical-analysis';
    } else if (text.includes('trend') || text.includes('over time')) {
      strategy = 'temporal-analysis';
    } else if (text.includes('compare') || text.includes('differ')) {
      strategy = 'comparative-analysis';
    }
    
    const reasoning = `Detected ${mentionedVariables.length} variables and ${relationships.length} relationships. Strategy: ${strategy}`;
    
    return {
      complexity,
      strategy,
      reasoning,
      suggestedAnaletCount: Math.min(suggestedAnaletCount, 8), // Cap at 8
      keyVariables: mentionedVariables,
      relationships
    };
  }

  /**
   * Generate analet templates based on conceptual statement analysis
   */
  private async generateAnaletTemplates(
    request: MaterializationRequest, 
    analysis: any
  ): Promise<AnaletTemplate[]> {
    const templates: AnaletTemplate[] = [];
    
    // If we have OpenAI access, use LLM generation
    if (this.messageService) {
      try {
        const llmTemplates = await this.generateTemplatesWithLLM(request, analysis);
        templates.push(...llmTemplates);
      } catch (error) {
        console.warn('LLM generation failed, falling back to rule-based generation:', error);
      }
    }
    
    // If no LLM templates or LLM failed, use rule-based generation
    if (templates.length === 0) {
      const ruleBasedTemplates = this.generateTemplatesWithRules(request, analysis);
      templates.push(...ruleBasedTemplates);
    }
    
    // Sort by priority and limit count
    const maxAnalets = request.maxAnalets || analysis.suggestedAnaletCount;
    return templates
      .sort((a, b) => b.priority - a.priority)
      .slice(0, maxAnalets);
  }

  /**
   * Generate templates using LLM
   */
  private async generateTemplatesWithLLM(
    request: MaterializationRequest,
    analysis: any
  ): Promise<AnaletTemplate[]> {
    const prompt = this.buildLLMPrompt(request, analysis);
    
    // Send to OpenAI via message service
    const response = await this.messageService.sendMessage({
      type: 'generate-analets-from-concept',
      payload: {
        prompt,
        maxAnalets: analysis.suggestedAnaletCount,
        datasetInfo: request.datasetInfo
      }
    });
    
    if (response.success && response.analets) {
      return response.analets.map((analet: any, index: number) => ({
        statement: analet.statement,
        formalGrammar: analet.formalGrammar,
        explanation: analet.explanation,
        tags: analet.tags || ['conceptual', 'materialized'],
        priority: 10 - index, // Higher priority for earlier suggestions
        complexity: analysis.complexity
      }));
    }
    
    throw new Error('LLM generation failed');
  }

  /**
   * Generate templates using rule-based approach
   */
  private generateTemplatesWithRules(
    request: MaterializationRequest,
    analysis: any
  ): AnaletTemplate[] {
    const templates: AnaletTemplate[] = [];
    const variables = analysis.keyVariables;
    const statement = request.statement;
    
    // Template 1: Overview/Summary
    templates.push({
      statement: `What is the overall distribution and summary of ${variables.join(', ')} as described in: "${statement.text}"?`,
      formalGrammar: `summary(${variables.join(', ')})`,
      explanation: `Provides an overview analysis based on the conceptual statement: "${statement.text}"`,
      tags: ['overview', 'summary', 'materialized'],
      priority: 9,
      complexity: 'simple'
    });

    // Template 2: Correlations (if multiple variables)
    if (variables.length >= 2) {
      templates.push({
        statement: `How do ${variables[0]} and ${variables[1]} relate to each other in the context of: "${statement.text}"?`,
        formalGrammar: `correlation(${variables[0]}, ${variables[1]})`,
        explanation: `Explores the relationship between key variables mentioned in the conceptual statement`,
        tags: ['correlation', 'relationship', 'materialized'],
        priority: 8,
        complexity: 'moderate'
      });
    }

    // Template 3: Distribution Analysis
    if (variables.length >= 1) {
      templates.push({
        statement: `What is the distribution pattern of ${variables[0]} in relation to the statement: "${statement.text}"?`,
        formalGrammar: `distribution(${variables[0]})`,
        explanation: `Analyzes the distribution of the primary variable from the conceptual statement`,
        tags: ['distribution', 'analysis', 'materialized'],
        priority: 7,
        complexity: 'simple'
      });
    }

    // Template 4: Comparative Analysis (if categorical variables detected)
    if (variables.length >= 2 && analysis.strategy === 'comparative-analysis') {
      templates.push({
        statement: `How does ${variables[1]} vary across different categories of ${variables[0]}?`,
        formalGrammar: `compare(${variables[1]} by ${variables[0]})`,
        explanation: `Comparative analysis exploring how variables differ across categories`,
        tags: ['comparison', 'categorical', 'materialized'],
        priority: 6,
        complexity: 'moderate'
      });
    }

    // Template 5: Complex Multi-variable Analysis (for complex statements)
    if (analysis.complexity === 'complex' && variables.length >= 3) {
      templates.push({
        statement: `What are the complex interactions between ${variables.slice(0, 3).join(', ')} as suggested by: "${statement.text}"?`,
        formalGrammar: `multivariate_analysis(${variables.slice(0, 3).join(', ')})`,
        explanation: `Multi-dimensional analysis of the complex relationships described in the conceptual statement`,
        tags: ['multivariate', 'complex', 'interactions', 'materialized'],
        priority: 5,
        complexity: 'complex'
      });
    }

    return templates;
  }

  /**
   * Build LLM prompt for analet generation
   */
  private buildLLMPrompt(request: MaterializationRequest, analysis: any): string {
    return `You are to convert a conceptual statement into ${analysis.suggestedAnaletCount} concrete analysis units using a SQL-like orchestration language ("Unit SQL").

CONCEPTUAL STATEMENT: "${request.statement.text}"

DATASET CONTEXT:
- Dataset: ${request.datasetInfo.name}
- Available columns: ${request.datasetInfo.columns.join(', ')}
- Sample data available: ${request.datasetInfo.sampleData ? 'Yes' : 'No'}

GUIDELINES:
- Output, for each unit, a human-friendly question plus a Unit SQL script in plain text in the field formalGrammar.
- Unit SQL orchestrates one or more UNIT queries. Each UNIT is a single SELECT (use placeholders like {{col}} where appropriate).
- Allowed building blocks:
  - REPEAT item IN [...]: expand a template per item.
  - QUANTIZE(col, spec): produce lists (e.g., DECILES => 10) to feed REPEAT.
  - BRANCH { WHEN condition -> spec; ELSE -> spec }: compile-time selection (no runtime CASE).
  - CONCAT([...]): run independent queries side-by-side.
- Favor operations that reflect binning, grouping, joining, and aggregating. Focus on which columns and transformations are used.

EXAMPLES (abbreviated):
A) Pair Grid
REPEAT col IN ('col1','col2'): REPEAT row IN ('col1','col2'):
BRANCH WHEN col <> row THEN SELECT {{row}} AS r, {{col}} AS c FROM ${request.datasetInfo.name};
       WHEN col = row THEN SELECT * FROM BIN_COUNT1D('${request.datasetInfo.name}', '{{row}}', 40); END END

B) Univariate Board
REPEAT c IN ('price','carat','cut'):
BRANCH WHEN TYPE(c) = NUMERIC THEN SELECT * FROM BIN_COUNT1D('${request.datasetInfo.name}', '{{c}}', 30);
       WHEN TYPE(c) = CATEGORICAL THEN SELECT * FROM VALUE_COUNT('${request.datasetInfo.name}', '{{c}}'); END END

TASK:
- Generate ${analysis.suggestedAnaletCount} items. Vary complexity and complementarity.
- For each, return: statement, formalGrammar (Unit SQL), explanation, tags.
`;
  }

  /**
   * Convert templates to actual Analet objects
   */
  private createAnaletsFromTemplates(templates: AnaletTemplate[], parentStatement: ConceptualStatement): Analet[] {
    return templates.map((template, index) => ({
      id: Date.now() + index, // Temporary ID
      statement: template.statement,
      formalGrammar: template.formalGrammar,
      explanation: template.explanation,
      tags: [...template.tags, `concept-${parentStatement.id}`],
      embedding: undefined, // Will be generated later
      location: undefined, // Will be positioned later
      conceptAxes: [],
      comments: [],
      hierarchyStatus: 'derived' as const,
      originalAnaletId: parentStatement.id, // Link back to concept
      source: 'conceptual_statement' // Mark as conceptual statement materialization
    }));
  }

  /**
   * Extract mentioned variables from statement text
   */
  private extractMentionedVariables(text: string, availableColumns: string[]): string[] {
    const mentioned = new Set<string>();
    
    // Extract @variable mentions
    const atMentions = text.match(/@(\w+)/g);
    if (atMentions) {
      atMentions.forEach(mention => {
        const varName = mention.slice(1);
        if (availableColumns.includes(varName)) {
          mentioned.add(varName);
        }
      });
    }
    
    // Extract direct column name mentions (case-insensitive)
    availableColumns.forEach(column => {
      const columnLower = column.toLowerCase();
      if (text.toLowerCase().includes(columnLower)) {
        mentioned.add(column);
      }
    });
    
    return Array.from(mentioned);
  }

  /**
   * Extract relationship types from statement text
   */
  private extractRelationships(text: string): string[] {
    const relationships: string[] = [];
    
    const relationshipPatterns = [
      { pattern: /correlat|relationship|related|associat/i, type: 'correlation' },
      { pattern: /cause|effect|influence|impact/i, type: 'causation' },
      { pattern: /compare|differ|contrast|versus/i, type: 'comparison' },
      { pattern: /group|categor|cluster|segment/i, type: 'grouping' },
      { pattern: /trend|over time|temporal|change/i, type: 'temporal' },
      { pattern: /distribut|pattern|spread/i, type: 'distribution' }
    ];
    
    relationshipPatterns.forEach(({ pattern, type }) => {
      if (pattern.test(text)) {
        relationships.push(type);
      }
    });
    
    return relationships;
  }

  /**
   * Update message service for OpenAI integration
   */
  setMessageService(messageService: any) {
    this.messageService = messageService;
  }
}