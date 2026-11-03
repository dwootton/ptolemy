/**
 * Adapter for generating analets from notebook cell code
 *
 * NEW ARCHITECTURE: Takes cell code → generates analet idea → generates CellQL → returns BaseAnalet
 */

import { NotebookGenerationCommand } from '../types/commands';
import { ValidationResult, AdapterResponse } from '../types';
import { BaseAnaletInputAdapter } from './base/AnaletInputAdapter';
import { NewOpenAIService } from '../../llm/NewOpenAIService';
import { EnvironmentService } from '../../EnvironmentService';
import { zodResponseFormat } from 'openai/helpers/zod';
import { DSLResponseSchema } from '../../../schemas/openai-schemas';

export class NotebookAdapter extends BaseAnaletInputAdapter<NotebookGenerationCommand> {
  readonly inputType = 'from_notebook';
  private openAIService: NewOpenAIService | null = null;

  canHandle(input: any): input is NotebookGenerationCommand {
    return (
      input &&
      typeof input === 'object' &&
      input.type === 'from_notebook' &&
      typeof input.cellContent === 'string' &&
      typeof input.filePath === 'string'
    );
  }

  validate(input: NotebookGenerationCommand): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Required field validation
    if (!input.cellContent || typeof input.cellContent !== 'string') {
      errors.push('Cell content is required and must be a string');
    } else if (input.cellContent.trim().length === 0) {
      errors.push('Cell content cannot be empty');
    } else if (input.cellContent.trim().length < 5) {
      warnings.push('Cell content is very short - may not be meaningful code');
    }

    if (!input.filePath || typeof input.filePath !== 'string') {
      errors.push('File path is required and must be a string');
    } else if (!input.filePath.endsWith('.ipynb')) {
      warnings.push('File path should reference a Jupyter notebook (.ipynb)');
    }

    if (typeof input.cellIndex !== 'number') {
      errors.push('Cell index is required and must be a number');
    } else if (input.cellIndex < 0) {
      errors.push('Cell index must be non-negative');
    }

    // Content validation - check if it's actually code
    if (input.cellContent && this.isLikelyNotCode(input.cellContent)) {
      warnings.push('Cell content does not appear to be executable code');
    }

    // Position validation
    if (input.position) {
      if (typeof input.position.x !== 'number' || typeof input.position.y !== 'number') {
        errors.push('Position must have numeric x and y coordinates');
      }
    }

    return this.createValidationResult(errors, warnings);
  }

  async generateBaseAnalets(input: NotebookGenerationCommand): Promise<AdapterResponse> {
    try {
      // Initialize OpenAI service if needed
      if (!this.openAIService) {
        this.openAIService = NewOpenAIService.getInstance();
      }

      // Step 1: Generate analet idea from cell code
      const analetsIdeasPrompt = this.createAnaletIdeaPrompt(input.cellContent, input.filePath);
      const ideas = await this.openAIService.chatStructured({
        system: 'You are a data analysis expert. Generate analysis ideas from Python code.',
        user: analetsIdeasPrompt,
        schema: DSLResponseSchema,
        model: 'gpt-4.1-mini'
      });
      // Calculate default position - for sync operations, don't set hardcoded positions
      // so analets get projected through existing UMAP space
      const defaultPosition = input.position; // Don't use calculateDefaultPosition for sync

      // Extract explicit name if provided
      const explicitName = this.extractExplicitName(input);
      // Transform to BaseAnalet format, overriding statement if explicit name provided
      // IMPORTANT: Limit to a single analet per notebook cell
      const limitedIdeas = Array.isArray(ideas.analets) ? ideas.analets.slice(0, 1) : [];
      const baseAnalets = limitedIdeas.map((idea: any) => {
        const finalStatement = explicitName || idea.statement;
        // If using explicit name, generate shortName from that; otherwise use OpenAI's shortName
        const shortName = explicitName ? this.generateFallbackShortName(explicitName) : idea.shortName;

        return {
          statement: finalStatement,
          shortName: shortName,
          cellQL: idea.cellQL,
          explanation: idea.explanation,
          tags: idea.tags || []
        };
      });

      return {
        success: true,
        baseAnalets,
        metadata: {
          requestId: this.generateRequestId(),
          source: 'notebook',
          processingTime: Date.now(),
          context: {
            cellIndex: input.cellIndex,
            filePath: input.filePath,
            cellId: input.notebookMetadata?.cellId,
            changeType: input.notebookMetadata?.changeType || 'new',
            existingAnaletId: input.notebookMetadata?.existingAnaletId,
            additionalContext: input.metadata,
            position: defaultPosition
          }
        }
      };

    } catch (error) {
      console.error(`💥 [NotebookAdapter] Failed to generate analets, falling back to lightweight extraction:`, error);
      // Fallback: create a single base analet using explicit name or simple extraction from code
      const explicitName = this.extractExplicitName(input);
      const simple = this.simpleFromCode(input.cellContent);
      return {
        success: true,
        baseAnalets: [{
          statement: explicitName || simple.statement,
          shortName: this.generateFallbackShortName(explicitName || simple.statement),
          cellQL: simple.cellQL,
          explanation: simple.explanation,
          tags: ['notebook']
        }],
        metadata: {
          requestId: this.generateRequestId(),
          source: 'notebook',
          processingTime: Date.now()
        }
      };
    }
  }

  private extractExplicitName(input: NotebookGenerationCommand): string | undefined {
    // Prefer explicit name provided by caller metadata
    const metaName = (input as any)?.metadata?.explicitName;
    if (typeof metaName === 'string' && metaName.trim().length > 0) return metaName.trim();
    // Otherwise, scan code for a marker line
    const lines = (input.cellContent || '').split('\n');
    for (const raw of lines) {
      const line = raw.trim();
      const hashIndex = line.indexOf('#');
      if (hashIndex === -1) continue;
      let comment = line.slice(hashIndex + 1).trim();
      while (comment.startsWith('#')) comment = comment.slice(1).trim();
      const match = comment.match(/^analet\s*:\s*(.+)$/i);
      if (match) return match[1].trim();
      if (comment.toLowerCase() === 'analet') return undefined;
    }
    return undefined;
  }

  /**
   * Generate a fallback short name by truncating the statement to ~8-10 words
   */
  private generateFallbackShortName(statement: string): string {
    const words = statement.trim().split(/\s+/);
    if (words.length <= 10) {
      return statement;
    }

    // Take first 8 words and add ellipsis if needed
    const shortWords = words.slice(0, 8);
    return shortWords.join(' ') + '...';
  }

  private simpleFromCode(cellContent: string): { statement: string; cellQL: string; explanation: string } {
    const snippet = (cellContent || '').split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'))[0] || 'Notebook analysis';
    const statement = `Analet: ${snippet.length > 80 ? snippet.slice(0, 77) + '...' : snippet}`;
    const cellQL = this.extractSimpleGrammar(cellContent || '');
    const explanation = 'Generated from notebook cell (fallback)';
    return { statement, cellQL, explanation };
  }

  private extractSimpleGrammar(code: string): string {
    const lines = (code || '').split('\n').map(l => l.trim()).filter(Boolean);
    const patterns = ['.describe(', '.groupby(', '.plot(', '.corr(', 'value_counts('];
    const hit = lines.find(l => patterns.some(p => l.includes(p)));
    return hit || 'data_analysis';
  }

  /**
   * Create prompt for generating analet ideas from cell code
   */
  private createAnaletIdeaPrompt(cellContent: string, filePath: string): string {
    const fileName = filePath.split('/').pop()?.replace('.ipynb', '') || 'notebook';

    return `Analyze this Python code from a Jupyter notebook cell and generate analysis ideas.

NOTEBOOK: ${fileName}
CELL CODE:
\`\`\`python
${cellContent.trim()}
\`\`\`

TASK:
Generate 1-3 specific analysis questions that this code could answer or explore. For each idea:

1. **Statement**: A clear, specific analysis question (e.g., "Distribution of diamond prices by cut quality")
2. **shortName**: A concise 8-10 word skimmable version (e.g., "Price distribution by cut")
3. **CellQL**: Convert the Python logic to CellQL that compiles to SQL
4. **Explanation**: Brief description of what insights this analysis provides
5. **Tags**: 2-5 relevant keywords

CELLQL MAPPING RULES:
- pandas groupby + agg → SELECT ... FROM "table" GROUP BY ...
- value_counts → VALUE_COUNT("table", column)
- histogram/hist → BIN_COUNT1D("table", column, bins)
- 2D plots/scatter → BIN_COUNT2D("table", x, y, x_bins, y_bins)
- loops over columns → REPEAT col IN ("col1","col2"): ... END
- conditional logic → BRANCH with TYPE() or other conditions
- quantile analysis → QUANTIZE with DECILE()

Focus on what the Python code is actually doing with the data, not just generic analysis.`;
  }

  /**
   * Check if content looks like executable code
   */
  private isLikelyNotCode(content: string): boolean {
    const codePatterns = [
      /import\s+\w+/,          // import statements
      /from\s+\w+\s+import/,   // from imports
      /def\s+\w+\s*\(/,        // function definitions
      /class\s+\w+/,           // class definitions
      /=\s*\w+\(/,             // function calls with assignment
      /print\s*\(/,            // print statements
      /\w+\.\w+\(/,            // method calls
      /for\s+\w+\s+in/,        // for loops
      /if\s+\w+/,              // if statements
      /while\s+\w+/,           // while loops
    ];

    const trimmed = content.trim();

    // If it's all comments or markdown, probably not executable code
    const lines = trimmed.split('\n').filter(line => line.trim());
    const commentLines = lines.filter(line => line.trim().startsWith('#') || line.trim().startsWith('//'));

    if (commentLines.length / lines.length > 0.8) {
      return true; // Mostly comments
    }

    // Check for code patterns
    return !codePatterns.some(pattern => pattern.test(trimmed));
  }

  /**
   * Calculate a default position based on cell index
   */
  private calculateDefaultPosition(cellIndex: number): { x: number; y: number } {
    // Arrange notebook analets in a vertical column
    const baseX = 100;
    const baseY = 100;
    const verticalSpacing = 150;

    return {
      x: baseX,
      y: baseY + (cellIndex * verticalSpacing)
    };
  }

  /**
   * Extract context information from file path
   */
  private extractContextFromPath(filePath: string): string | undefined {
    // Extract meaningful context from the notebook file path
    const parts = filePath.split('/');
    const fileName = parts[parts.length - 1];
    const dirName = parts.length > 1 ? parts[parts.length - 2] : '';

    // Remove .ipynb extension
    const baseName = fileName.replace('.ipynb', '');

    // Create context string
    if (dirName && dirName !== '.') {
      return `Notebook: ${baseName} (in ${dirName})`;
    } else {
      return `Notebook: ${baseName}`;
    }
  }
}
