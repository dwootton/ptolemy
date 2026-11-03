/**
 * SemanticLayerMessageHandler - Handles semantic layer operations
 */

import { BaseMessageHandler } from '../BaseMessageHandler';
import { MessageContext } from '../types';
import { NewOpenAIService } from '../../llm/NewOpenAIService';

export class SemanticLayerMessageHandler extends BaseMessageHandler {

  constructor() {
    super([
      'save-semantic-layer',
      'load-semantic-layer',
      'export-semantic-layer-yaml',
      'save-conceptual-statements',
      'save-variable-modifications',
      'generate-value-annotations',
      'save-value-annotations',
      'generate-embedding-description',
      'generate-bearing-embedding'
    ]);
  }

  public async handle(messageType: string, data: any, context: MessageContext): Promise<void> {
    switch (messageType) {
      case 'save-semantic-layer':
        await this.handleSaveSemanticLayer(data);
        break;
      case 'load-semantic-layer':
        await this.handleLoadSemanticLayer();
        break;
      case 'export-semantic-layer-yaml':
        await this.handleExportSemanticLayerYAML(data);
        break;
      case 'save-conceptual-statements':
        await this.handleSaveConceptualStatements(data);
        break;
      case 'save-variable-modifications':
        await this.handleSaveVariableModifications(data);
        break;
      case 'generate-value-annotations':
        await this.handleGenerateValueAnnotations(data);
        break;
      case 'save-value-annotations':
        await this.handleSaveValueAnnotations(data);
        break;
      case 'generate-embedding-description':
        await this.handleGenerateEmbeddingDescription(data);
        break;
      case 'generate-bearing-embedding':
        await this.handleGenerateBearingEmbedding(data);
        break;
      default:
        throw new Error(`Unsupported message type: ${messageType}`);
    }
  }

  /**
   * Save complete semantic layer
   */
  private async handleSaveSemanticLayer(data: any): Promise<void> {
    try {
      const validation = this.validateData(data, ['semanticLayer']);
      if (!validation.isValid) {
        throw new Error(validation.error);
      }

      if (!this.context?.stateService) {
        throw new Error('StateService not available');
      }

      const { semanticLayer } = data;
      this.log('info', 'Saving semantic layer', {
        datasetName: semanticLayer.datasetName,
        statementsCount: semanticLayer.conceptualStatements?.length || 0,
        modificationsCount: Object.keys(semanticLayer.variableModifications || {}).length
      });

      const stateService = this.context.stateService;

      // Save conceptual statements
      if (semanticLayer.conceptualStatements) {
        await stateService.saveConceptualStatements(semanticLayer.conceptualStatements);
      }

      // Save variable modifications
      if (semanticLayer.variableModifications) {
        await stateService.saveVariableModifications(semanticLayer.variableModifications);
      }

      await this.sendMessage('semantic-layer-save-response', {
        success: true,
        message: 'Semantic layer saved successfully'
      });

    } catch (error) {
      await this.sendError('save-semantic-layer', error, data);
    }
  }

  /**
   * Load semantic layer
   */
  private async handleLoadSemanticLayer(): Promise<void> {
    try {
      if (!this.context?.stateService) {
        throw new Error('StateService not available');
      }

      this.log('info', 'Loading semantic layer');

      const stateService = this.context.stateService;

      // Get current semantic layer data
      const conceptualStatements = await stateService.loadConceptualStatements() || [];
      const variableModifications = await stateService.loadVariableModifications() || {};

      const semanticLayer = {
        conceptualStatements,
        variableModifications
      };

      await this.sendMessage('semantic-layer-load-response', {
        success: true,
        semanticLayer
      });

      this.log('info', 'Semantic layer loaded', {
        statementsCount: conceptualStatements.length,
        modificationsCount: Object.keys(variableModifications).length
      });

    } catch (error) {
      await this.sendError('load-semantic-layer', error);
    }
  }

  /**
   * Export semantic layer to YAML format
   */
  private async handleExportSemanticLayerYAML(data: any): Promise<void> {
    try {
      const validation = this.validateData(data, ['semanticLayer']);
      if (!validation.isValid) {
        throw new Error(validation.error);
      }

      const { semanticLayer } = data;
      this.log('info', 'Exporting semantic layer to YAML', {
        datasetName: semanticLayer.datasetName
      });

      // Convert semantic layer to YAML format
      const yamlContent = this.convertSemanticLayerToYAML(semanticLayer);

      // Generate filename
      const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
      const filename = `semantic-layer-${semanticLayer.datasetName || 'dataset'}-${timestamp}.yaml`;

      await this.sendMessage('semantic-layer-export-response', {
        success: true,
        yamlContent,
        filename,
        message: 'Semantic layer exported to YAML successfully'
      });

    } catch (error) {
      await this.sendError('export-semantic-layer-yaml', error, data);
    }
  }

  /**
   * Save conceptual statements
   */
  private async handleSaveConceptualStatements(data: any): Promise<void> {
    try {
      const validation = this.validateData(data, ['statements']);
      if (!validation.isValid) {
        throw new Error(validation.error);
      }

      if (!this.context?.stateService) {
        throw new Error('StateService not available');
      }

      const { statements } = data;
      this.log('info', 'Saving conceptual statements', { count: statements.length });

      await this.context.stateService.saveConceptualStatements(statements);

      await this.sendMessage('conceptual-statements-save-response', {
        success: true,
        count: statements.length
      });

    } catch (error) {
      await this.sendError('save-conceptual-statements', error, data);
    }
  }

  /**
   * Save variable modifications
   */
  private async handleSaveVariableModifications(data: any): Promise<void> {
    try {
      const validation = this.validateData(data, ['modifications']);
      if (!validation.isValid) {
        throw new Error(validation.error);
      }

      if (!this.context?.stateService) {
        throw new Error('StateService not available');
      }

      const { modifications } = data;
      this.log('info', 'Saving variable modifications', {
        count: Object.keys(modifications).length
      });

      await this.context.stateService.saveVariableModifications(modifications);

      await this.sendMessage('variable-modifications-save-response', {
        success: true,
        count: Object.keys(modifications).length
      });

    } catch (error) {
      await this.sendError('save-variable-modifications', error, data);
    }
  }

  /**
   * Generate value annotations using AI
   */
  private async handleGenerateValueAnnotations(data: any): Promise<void> {
    try {
      // Back-compat: accept either { column, values } or { columnName, datasetName } (values optional)
      let column: string | undefined = data?.column || data?.columnName;
      let values: any[] | undefined = Array.isArray(data?.values) ? data.values : undefined;
      if (!column) {
        throw new Error('Missing required field: column');
      }
      // If values not provided, try to derive from dataset summary (top values) or CSV
      if (!values || values.length === 0) {
        try {
          const summarizer = (await import('../../DatasetSummarizerService')).DatasetSummarizerService.getInstance();
          const dataRows = summarizer.getFullDatasetData() || [];
          if (dataRows.length > 0 && typeof dataRows[0] === 'object') {
            const sample = new Map<any, number>();
            for (let i = 0; i < Math.min(200, dataRows.length); i++) {
              const v = (dataRows[i] as any)[column];
              if (v !== undefined && v !== null) sample.set(v, (sample.get(v) || 0) + 1);
            }
            values = Array.from(sample.entries()).sort((a,b)=>b[1]-a[1]).slice(0, 12).map(e=>e[0]);
          }
        } catch {}
      }
      if (!values || values.length === 0) {
        throw new Error('Missing required field: values');
      }

      const colForLog = column;
      this.log('info', 'Generating value annotations', {
        column: colForLog,
        valueCount: values.length
      });

      const openAIService = NewOpenAIService.getInstance();

      // Build prompt for value annotation
      const prompt = this.buildValueAnnotationPrompt(colForLog, values);

      const response = await openAIService.chatText({
        system: 'You are a data analysis expert. Generate value annotations for dataset columns.',
        user: prompt,
        model: 'gpt-4.1-mini'
      });

      const annotations = this.parseValueAnnotations(response);

      // New unified response + legacy compatibility events
      await this.sendMessage('value-annotations-response', { success: true, column: colForLog, annotations });
      await this.sendMessage('value-annotations-generated', { success: true, columnName: colForLog, annotations });

    } catch (error) {
      await this.sendError('generate-value-annotations', error, data);
      try {
        // Legacy error event for webview listener
        await this.sendMessage('value-annotations-error', { columnName: data?.column || data?.columnName, error: (error as any)?.message || String(error) });
      } catch {}
    }
  }

  /**
   * Save value annotations
   */
  private async handleSaveValueAnnotations(data: any): Promise<void> {
    try {
      const validation = this.validateData(data, ['column', 'annotations']);
      if (!validation.isValid) {
        throw new Error(validation.error);
      }

      if (!this.context?.stateService) {
        throw new Error('StateService not available');
      }

      const { column, annotations } = data;
      this.log('info', 'Saving value annotations', {
        column,
        annotationCount: Object.keys(annotations).length
      });

      // Save annotations as part of variable modifications
      const currentModifications = await this.context.stateService.loadVariableModifications() || {};

      if (!currentModifications[column]) {
        currentModifications[column] = {
          name: column,
          comments: []
        };
      }

      currentModifications[column].valueAnnotations = annotations;
      await this.context.stateService.saveVariableModifications(currentModifications);

      await this.sendMessage('value-annotations-save-response', {
        success: true,
        column,
        annotationCount: Object.keys(annotations).length
      });

    } catch (error) {
      await this.sendError('save-value-annotations', error, data);
    }
  }

  /**
   * Generate embedding description for visualization
   */
  private async handleGenerateEmbeddingDescription(data: any): Promise<void> {
    try {
      const validation = this.validateData(data, ['embedding']);
      if (!validation.isValid) {
        throw new Error(validation.error);
      }

      const { embedding, context } = data;
      this.log('info', 'Generating embedding description');

      const openAIService = NewOpenAIService.getInstance();

      // Build prompt for embedding description
      const prompt = this.buildEmbeddingDescriptionPrompt(embedding, context);

      const response = await openAIService.chatText({
        system: 'You are a data analysis expert. Generate human-readable descriptions for embedding vectors.',
        user: prompt,
        model: 'gpt-4.1-mini'
      });

      await this.sendMessage('embedding-description-response', {
        success: true,
        description: response.trim()
      });

    } catch (error) {
      await this.sendError('generate-embedding-description', error, data);
    }
  }

  /**
   * Generate embedding for a bearing (navigation point)
   */
  private async handleGenerateBearingEmbedding(data: any): Promise<void> {
    try {
      const validation = this.validateData(data, ['statement']);
      if (!validation.isValid) {
        throw new Error(validation.error);
      }

      const { statement } = data;
      this.log('info', 'Generating bearing embedding', { statement });

      const openAIService = NewOpenAIService.getInstance();

      // Generate embedding for the bearing statement
      const embeddings = await openAIService.generateEmbeddings([statement]);

      if (!embeddings || embeddings.length === 0) {
        throw new Error('Failed to generate embedding');
      }

      await this.sendMessage('bearing-embedding-response', {
        success: true,
        statement,
        embedding: embeddings[0]
      });

    } catch (error) {
      await this.sendError('generate-bearing-embedding', error, data);
    }
  }

  /**
   * Convert semantic layer to YAML format
   */
  private convertSemanticLayerToYAML(semanticLayer: any): string {
    const yaml = [
      `# Semantic Layer Export`,
      `# Generated: ${new Date().toISOString()}`,
      ``,
      `dataset_name: "${semanticLayer.datasetName || 'unknown'}"`,
      `version: "${semanticLayer.version || '1.0'}"`,
      ``,
      `conceptual_statements:`
    ];

    // Add conceptual statements
    if (semanticLayer.conceptualStatements && semanticLayer.conceptualStatements.length > 0) {
      for (const statement of semanticLayer.conceptualStatements) {
        yaml.push(`  - id: ${statement.id}`);
        yaml.push(`    text: "${statement.text}"`);
        yaml.push(`    created_at: "${statement.createdAt || ''}"`);
        yaml.push(``);
      }
    } else {
      yaml.push(`  []`);
    }

    yaml.push(`variable_modifications:`);

    // Add variable modifications
    if (semanticLayer.variableModifications && Object.keys(semanticLayer.variableModifications).length > 0) {
      for (const [varName, modification] of Object.entries(semanticLayer.variableModifications)) {
        const mod = modification as any;
        yaml.push(`  ${varName}:`);
        yaml.push(`    display_name: "${mod.displayName || varName}"`);
        yaml.push(`    description: "${mod.description || ''}"`);
        yaml.push(`    unit: "${mod.unit || ''}"`);

        if (mod.comments && mod.comments.length > 0) {
          yaml.push(`    comments:`);
          for (const comment of mod.comments) {
            yaml.push(`      - "${comment}"`);
          }
        }
        yaml.push(``);
      }
    } else {
      yaml.push(`  {}`);
    }

    return yaml.join('\n');
  }

  /**
   * Build prompt for value annotation generation
   */
  private buildValueAnnotationPrompt(column: string, values: any[]): string {
    return `Analyze these values from column "${column}" and provide annotations explaining what each value represents or means.

Values: ${values.slice(0, 20).join(', ')}

For each value, provide a brief, clear annotation that explains:
- What the value represents
- Any domain-specific meaning
- Context or implications

Return as JSON object:
{
  "value1": "annotation for value1",
  "value2": "annotation for value2"
}`;
  }

  /**
   * Build prompt for embedding description
   */
  private buildEmbeddingDescriptionPrompt(embedding: number[], context?: any): string {
    return `Generate a human-readable description for this high-dimensional embedding vector.

Embedding dimensions: ${embedding.length}
Context: ${context ? JSON.stringify(context) : 'none provided'}

Provide a brief description of what this embedding might represent in terms of:
- Semantic meaning
- Conceptual space positioning
- Relationship to other concepts

Keep it concise and accessible.`;
  }

  /**
   * Parse value annotations from AI response
   */
  private parseValueAnnotations(response: string): { [key: string]: string } {
    try {
      // Extract JSON from response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }

      return JSON.parse(jsonMatch[0]);
    } catch (error) {
      this.log('error', 'Failed to parse value annotations', error);
      return {};
    }
  }
}
