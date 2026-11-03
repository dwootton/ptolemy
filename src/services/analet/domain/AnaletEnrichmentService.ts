/**
 * AnaletEnrichmentService - Converts base analets to full Analet objects
 * 
 * This service takes BaseAnalet objects (from adapter responses) and enriches them
 * with embeddings, locations, IDs, and other metadata to create full Analet objects.
 * 
 * Replaces the createAnaletsFromDSLResult logic from the old CoreGenerationService.
 */

import { Analet } from '../../../types/analet';
import { BaseAnalet, EnrichmentConfig, EnrichmentResult } from '../types/base';
import { NewOpenAIService } from '../../llm/NewOpenAIService';
import { EnvironmentService } from '../../EnvironmentService';

export class AnaletEnrichmentService {
  private newOpenAIService: NewOpenAIService | null = null;
  private idCounter: number = Date.now();
  
  constructor() {
    // Will initialize OpenAI service lazily when needed
  }
  
  /**
   * Main enrichment method - converts BaseAnalet[] to Analet[]
   */
  async enrichAnalets(
    baseAnalets: BaseAnalet[],
    config: EnrichmentConfig
  ): Promise<EnrichmentResult> {
    const startTime = Date.now();
    try {
      // Initialize OpenAI service if embeddings are requested
      if (config.generateEmbeddings !== false) {
        await this.initializeOpenAIService();
      }
      
      const enrichedAnalets: Analet[] = [];
      
      for (let i = 0; i < baseAnalets.length; i++) {
        const baseAnalet = baseAnalets[i];
        
        // Generate unique ID
        const id = this.generateUniqueId();
        
        // Calculate position
        const location = this.calculatePosition(config, i, baseAnalets.length);
        
        // Prepare input used for embedding generation
        const textForEmbedding = [
          baseAnalet.cellQL?.trim() || '',
          baseAnalet.semantic_hints_text?.trim() || ''
        ].filter(Boolean).join(' \n');
        const fallback = `${baseAnalet.statement}: ${baseAnalet.explanation || ''}`;
        const embeddingInput = textForEmbedding.length > 0 ? textForEmbedding : fallback;

        // Generate embedding if requested and service available
        let embedding: number[] = [];
        if (config.generateEmbeddings !== false && this.newOpenAIService) {
          embedding = await this.generateEmbedding(baseAnalet);
        }
        
        // Generate fallback shortName if not provided
        const shortName = baseAnalet.shortName || this.generateFallbackShortName(baseAnalet.statement);
        
        // Create full analet object
        const enrichedAnalet: Analet = {
          id,
          statement: baseAnalet.statement,
          shortName: shortName,
          cellQL: baseAnalet.cellQL,
          variables_used: baseAnalet.variables_used,
          semantic_hints_text: baseAnalet.semantic_hints_text,
          explanation: baseAnalet.explanation,
          tags: baseAnalet.tags || [config.source],
          embedding,
          embeddingInput,
          location: location ? {
            id: `analet-${id}`,
            x: location.x,
            y: location.y
          } : undefined,
          
          // Type system
          source: config.source,
          type: this.determineAnaletType(config.source),
          
          // Generation metadata
          isExplanationAIGenerated: !!baseAnalet.explanation,
          isExplanationAccepted: false,
          explanationGeneratedAt: new Date().toISOString(),
          
          // Additional metadata from config
          ...this.extractAdditionalMetadata(config)
        };
        enrichedAnalets.push(enrichedAnalet);
      }
      
      const enrichmentTime = Date.now() - startTime;
      return {
        success: true,
        analets: enrichedAnalets,
        metadata: {
          processedCount: enrichedAnalets.length,
          enrichmentTime,
          embeddingsGenerated: config.generateEmbeddings !== false && !!this.newOpenAIService
        }
      };
      
    } catch (error) {
      console.error('❌ [AnaletEnrichment] Error enriching analets:', error);
      return {
        success: false,
        analets: [],
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
  
  /**
   * Initialize OpenAI service for embedding generation
   */
  private async initializeOpenAIService(): Promise<void> {
    if (this.newOpenAIService) {
      return; // Already initialized
    }
    
    try {
      const environmentService = EnvironmentService.getInstance();
      const apiKey = await environmentService.getOpenAIApiKey();
      
      if (!apiKey) {
        console.warn('🔑 [AnaletEnrichment] OpenAI API key not available - embeddings will be empty');
        return;
      }
      
      this.newOpenAIService = NewOpenAIService.getInstance(apiKey);
    } catch (error) {
      console.warn('⚠️ [AnaletEnrichment] Failed to initialize OpenAI service:', error);
    }
  }
  
  /**
   * Generate embedding for a base analet
   */
  private async generateEmbedding(baseAnalet: BaseAnalet): Promise<number[]> {
    if (!this.newOpenAIService) {
      console.warn('⚠️ [AnaletEnrichment] OpenAI service not available for embedding generation');
      return [];
    }
    
    try {
      // Use CellQL if available, otherwise use statement + explanation
      const textForEmbedding = [
        baseAnalet.cellQL?.trim() || '',
        baseAnalet.semantic_hints_text?.trim() || ''
      ].filter(Boolean).join(' \n');
      const fallback = `${baseAnalet.statement}: ${baseAnalet.explanation || ''}`;
      const target = textForEmbedding.length > 0 ? textForEmbedding : fallback;
      const embeddings = await this.newOpenAIService.generateEmbeddings([target]);
      const embedding = embeddings[0] || [];
      return embedding;
      
    } catch (error) {
      console.warn('⚠️ [AnaletEnrichment] Failed to generate embedding:', baseAnalet.statement, error);
      return [];
    }
  }
  
  /**
   * Calculate position for analet layout
   */
  private calculatePosition(
    config: EnrichmentConfig, 
    index: number, 
    total: number
  ): { x: number; y: number } | undefined {
    // If no startPosition provided, return undefined so analets get projected through UMAP
    if (!config.startPosition) {
      return undefined;
    }
    
    const basePosition = config.startPosition;
    
    if (total === 1) return basePosition;
    
    // Spread in a circle around the base position
    const radius = 50 + (total * 10); // Larger spread for more analets
    const angle = (index / total) * 2 * Math.PI;
    
    return {
      x: basePosition.x + Math.cos(angle) * radius,
      y: basePosition.y + Math.sin(angle) * radius
    };
  }
  
  /**
   * Determine analet type based on source
   */
  private determineAnaletType(source: string): 'framing' | 'waypoint' {
    return source === 'framing' ? 'framing' : 'waypoint';
  }
  
  /**
   * Extract additional metadata for specific sources
   */
  private extractAdditionalMetadata(config: EnrichmentConfig): Partial<Analet> {
    const metadata: Partial<Analet> = {};
    
    // Add any additional metadata from config
    if (config.additionalMetadata) {
      Object.assign(metadata, config.additionalMetadata);
    }
    
    // Notebook-specific metadata
    if (config.source === 'notebook' && config.additionalMetadata) {
      const notebookMeta = config.additionalMetadata;
      if (notebookMeta.filePath && notebookMeta.cellIndex !== undefined) {
        metadata.notebookCellMetadata = {
          filePath: notebookMeta.filePath,
          cellIndex: notebookMeta.cellIndex,
          lastModified: new Date().toISOString()
        };
      }
    }
    
    // Derivation-specific metadata
    if (config.source === 'derivation' && config.additionalMetadata?.sourceAnalet) {
      metadata.parentAnaletId = config.additionalMetadata.sourceAnalet.id;
    }
    
    return metadata;
  }
  
  /**
   * Generate unique ID for analets
   */
  private generateUniqueId(): number {
    return ++this.idCounter;
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
  
  /**
   * Create singleton instance
   */
  private static instance: AnaletEnrichmentService | null = null;
  
  static getInstance(): AnaletEnrichmentService {
    if (!this.instance) {
      this.instance = new AnaletEnrichmentService();
    }
    return this.instance;
  }
}
