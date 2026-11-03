/**
 * Main controller for analet operations
 * Orchestrates adapters, generation, persistence, and state sync
 */

import { Analet } from '../../../types/analet';
import {
  GenerationRequest,
  GenerationCommand,
  AnaletEvent,
  AnaletEventBus,
  EnrichmentConfig
} from '../types';
// Import the updated GenerationResult with new metadata fields
import type { GenerationResult } from '../types/index';
import { AnaletInputAdapter } from '../adapters/base/AnaletInputAdapter';
import { AnaletRepository } from './AnaletRepository';
import { AnaletEnrichmentService } from './AnaletEnrichmentService';
import { StateSyncService } from './StateSyncService';

export class AnaletController {
  private adapters = new Map<string, AnaletInputAdapter>();
  private eventListeners = new Set<(event: AnaletEvent) => void>();
  private eventHistory: AnaletEvent[] = [];
  private enrichmentService: AnaletEnrichmentService;

  constructor(
    private repository: AnaletRepository,
    private stateSync: StateSyncService
  ) {
    this.enrichmentService = AnaletEnrichmentService.getInstance();
  }

  /**
   * Register an input adapter for a specific command type
   */
  registerAdapter(commandType: string, adapter: AnaletInputAdapter): void {
    this.adapters.set(commandType, adapter);
  }

  /**
   * Get an input adapter by command type
   */
  getAdapter(commandType: string): AnaletInputAdapter | undefined {
    return this.adapters.get(commandType);
  }

  /**
   * Main entry point for analet generation
   * NEW ARCHITECTURE: adapter → enrichment → persistence pipeline
   */
  async generateAnalets(request: GenerationRequest): Promise<GenerationResult> {
    const startTime = Date.now();
    const requestId = request.requestId || this.generateRequestId();
    try {
      // Guard: if framing is requested but analets already exist, prefer cached state
      try {
        if ((request as any)?.command?.type === 'from_framing') {
          const existing = await this.repository.findAll();
          if (existing && existing.length > 0) {
            await this.stateSync.fullStateRefresh?.();
            return {
              success: true,
              analets: [],
              metadata: {
                generationTime: Date.now() - startTime,
                source: 'cached',
                inputSummary: 'framing:cached-existing',
                requestId
              }
            } as any;
          }
        }
      } catch {}

      // Emit start event
      await this.emitEvent({
        type: 'analet_generation_started',
        timestamp: new Date().toISOString(),
        requestId,
        command: request.command
      });

      // Step 1: Find appropriate adapter
      const adapter = this.adapters.get(request.command.type);
      if (!adapter) {
        throw new Error(`No adapter found for command type: ${request.command.type}`);
      }

      // Step 2: Validate input
      if (!adapter.canHandle(request.command)) {
        throw new Error(`Adapter cannot handle input of type: ${(request.command as any).type}`);
      }

      const validationResult = adapter.validate(request.command);
      if (!validationResult.isValid) {
        throw new Error(`Input validation failed: ${validationResult.errors.join(', ')}`);
      }

      // Step 3: Generate base analets using adapter (calls OpenAI directly)
      const adapterResponse = await adapter.generateBaseAnalets(request.command);

      if (!adapterResponse.success) {
        throw new Error(adapterResponse.error || 'Adapter generation failed');
      }

      // Step 4: Use pre-enriched analets if provided; otherwise enrich base analets
      const enrichmentConfig: EnrichmentConfig = {
        source: this.getSourceFromCommandType(request.command.type),
        startPosition: (request.command as any).position,
        generateEmbeddings: true,
        additionalMetadata: {
          requestId,
          ...this.extractAdditionalMetadata(request.command)
        }
      };

      // For notebook commands without explicit position (e.g., from sync),
      // don't set startPosition so analets get projected through UMAP
      if (request.command.type === 'from_notebook' && !(request.command as any).position) {
        enrichmentConfig.startPosition = undefined;
      }
      // Hierarchy now handled by edges API
      const pre: Analet[] | undefined = (adapterResponse as any)?.metadata?.context?.preEnrichedAnalets;
      const base = adapterResponse.baseAnalets as any[];
      const isEnrichedShape = (x: any) => x && (Array.isArray(x.embedding) || typeof x.id === 'number' || typeof x.type === 'string' || x.location);
      let enrichedAnalets: Analet[];
      let enrichmentTime: number | undefined = undefined;

      if (pre && pre.length > 0) {
        enrichedAnalets = pre;
      } else if (base && base.length > 0 && isEnrichedShape(base[0])) {
        enrichedAnalets = base as unknown as Analet[];
      } else {
        const startEnr = Date.now();
        const result = await this.enrichmentService.enrichAnalets(
          adapterResponse.baseAnalets,
          enrichmentConfig
        );
        if (!result.success) {
          throw new Error(result.error || 'Enrichment failed');
        }
        enrichedAnalets = result.analets as Analet[];
        enrichmentTime = result.metadata?.enrichmentTime ?? (Date.now() - startEnr);
      }
      // Safety: limit to one analet per notebook command
      if ((request.command as any)?.type === 'from_notebook' && enrichedAnalets.length > 1) {
        enrichedAnalets = enrichedAnalets.slice(0, 1);
      }

      // Step 5: Persist analets
      if (enrichedAnalets.length > 0) {
        await this.repository.saveMany(enrichedAnalets);

        // Step 6: Sync state
        await this.stateSync.syncToWorkspace(enrichedAnalets);
        await this.stateSync.syncToFrontend(enrichedAnalets);

        // REMOVED: Individual analet_created events to prevent triple duplication
        // The syncToFrontend call above already sends all analets via fetch-analet-data
      }

      // Step 7: Emit completion event
      const totalTime = Date.now() - startTime;
      await this.emitEvent({
        type: 'analet_generation_completed',
        timestamp: new Date().toISOString(),
        requestId,
        analets: enrichedAnalets,
        generationTime: totalTime,
        source: enrichmentConfig.source,
        inputSummary: this.createInputSummary(request.command)
      });
      return {
        success: true,
        analets: enrichedAnalets,
        metadata: {
          generationTime: totalTime,
          source: enrichmentConfig.source,
          inputSummary: this.createInputSummary(request.command),
          requestId,
          adapterProcessingTime: adapterResponse.metadata?.processingTime,
          enrichmentTime
        }
      };

    } catch (error) {
      console.error(`❌ [AnaletController] Generation failed for request ${requestId}:`, error);

      // Emit failure event
      await this.emitEvent({
        type: 'analet_generation_failed',
        timestamp: new Date().toISOString(),
        requestId,
        error: error instanceof Error ? error.message : 'Unknown error',
        command: request.command
      });

      return {
        success: false,
        analets: [],
        error: error instanceof Error ? error.message : 'Unknown error',
        metadata: {
          generationTime: Date.now() - startTime,
          source: 'unknown',
          inputSummary: `Failed: ${request.command.type}`,
          requestId
        }
      };
    }
  }

  /**
   * Update an existing analet
   */
  async updateAnalet(analetId: number, patch: Partial<Analet>): Promise<{ success: boolean; analet?: Analet; error?: string }> {
    try {
      const existingAnalet = await this.repository.findById(analetId);
      if (!existingAnalet) {
        return { success: false, error: 'Analet not found' };
      }
      const updated: Analet = { ...existingAnalet, ...patch } as Analet;
      await this.repository.update(updated);
      await this.stateSync.syncToWorkspace([updated]);
      // Use a lightweight frontend sync to avoid full dataset re-push cycles
      await (this.stateSync as any).syncSingleUpdate?.(updated) ?? this.stateSync.syncToFrontend([updated]);
      await this.emitEvent({
        type: 'analet_updated',
        timestamp: new Date().toISOString(),
        analet: updated,
        previousAnalet: existingAnalet || undefined,
        changes: this.calculateChanges(existingAnalet, updated)
      });
      return { success: true, analet: updated };
    } catch (error) {
      console.error(`❌ [AnaletController] Failed to update analet ${analetId}:`, error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Delete an analet
   */
  async deleteAnalet(analetId: number): Promise<boolean> {
    try {
      const analet = await this.repository.findById(analetId);
      if (!analet) {
        console.warn(`⚠️ [AnaletController] Analet ${analetId} not found for deletion`);
        return false;
      }

      const deleted = await this.repository.delete(analetId);

      if (deleted) {
        await this.stateSync.syncDeletion(analetId);

        // Emit delete event
        await this.emitEvent({
          type: 'analet_deleted',
          timestamp: new Date().toISOString(),
          analetId,
          deletedAnalet: analet
        });
      }

      return deleted;
    } catch (error) {
      console.error(`❌ [AnaletController] Failed to delete analet ${analetId}:`, error);
      throw error;
    }
  }

  /**
   * Get all analets
   */
  async getAllAnalets(): Promise<Analet[]> {
    return await this.repository.findAll();
  }

  /**
   * Get analet by ID
   */
  async getAnaletById(id: number): Promise<Analet | null> {
    return await this.repository.findById(id);
  }

  /**
   * Promote framing analets to waypoint analets (edit operation)
   */
  async promoteFramingAnalets(count: number = 5): Promise<Analet[]> {
    try {
      // Get framing analets from repository
      const framingAnalets = await this.repository.findByType('framing');
      if (framingAnalets.length === 0) {
        return [];
      }

      // Randomly select analets to promote
      const shuffled = [...framingAnalets].sort(() => 0.5 - Math.random());
      const selectedAnalets = shuffled.slice(0, Math.min(count, framingAnalets.length));

      // Check for missing embeddings and log them
      const missingEmbeddings = selectedAnalets.filter(a => !a.embedding || a.embedding.length === 0);
      if (missingEmbeddings.length > 0) {
        console.warn(`⚠️ [AnaletController] Found ${missingEmbeddings.length} framing analets with missing embeddings. IDs: ${missingEmbeddings.map(a => a.id).join(', ')}`);
      }

      // Promote by changing type from 'framing' to 'waypoint'
      const promotedAnalets = selectedAnalets.map(analet => ({
        ...analet,
        type: 'waypoint' as const,
        source: 'waypoint' as const, // Update source to reflect promotion
        // Keep original location or generate if needed
        location: analet.location || {
          id: `analet-${analet.id}`,
          x: 300 + Math.random() * 200,
          y: 300 + Math.random() * 200
        },
        // Ensure embedding exists (should already be there from framing generation)
        embedding: analet.embedding || []
      }));

      // Debug: Log the promoted analets before persistence
      // Update in repository
      await this.repository.updateMany(promotedAnalets);

      // Sync state
      await this.stateSync.syncToWorkspace(promotedAnalets);
      await this.stateSync.syncToFrontend(promotedAnalets);

      // Emit events for each promoted analet
      for (const analet of promotedAnalets) {
        await this.emitEvent({
          type: 'analet_updated',
          timestamp: new Date().toISOString(),
          analet,
          changes: ['type', 'source']
        });
      }
      return promotedAnalets;

    } catch (error) {
      console.error(`❌ [AnaletController] Failed to promote framing analets:`, error);
      throw error;
    }
  }

  /**
   * Event bus implementation
   */
  subscribe(listener: (event: AnaletEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  getEventHistory(limit = 100): AnaletEvent[] {
    return this.eventHistory.slice(-limit);
  }

  private async emitEvent(event: AnaletEvent): Promise<void> {
    // Store in history
    this.eventHistory.push(event);

    // Keep history limited
    if (this.eventHistory.length > 1000) {
      this.eventHistory = this.eventHistory.slice(-500);
    }

    // Notify listeners
    for (const listener of this.eventListeners) {
      try {
        await listener(event);
      } catch (error) {
        console.error('❌ [AnaletController] Event listener error:', error);
      }
    }
  }

  private generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private createInputSummary(command: GenerationCommand): string {
    const content = this.getCommandContent(command).substring(0, 30);
    return `${command.type}: "${content}..."`;
  }

  private getSourceFromCommandType(commandType: string): NonNullable<Analet['source']> {
    // Map command types to source types
    switch (commandType) {
      case 'from_statement': return 'statement';
      case 'from_notebook': return 'notebook';
      case 'from_framing': return 'framing';
      case 'from_derivation': return 'derivation';
      case 'from_embedding': return 'embedding';
      case 'from_focus': return 'focus';
      default: return 'unknown';
    }
  }

  private extractAdditionalMetadata(command: GenerationCommand): Record<string, any> {
    const metadata: Record<string, any> = {};

    // Extract command-specific metadata
    if (command.type === 'from_notebook') {
      const notebookCommand = command as any;
      metadata.filePath = notebookCommand.filePath;
      metadata.cellIndex = notebookCommand.cellIndex;
    } else if (command.type === 'from_derivation') {
      const derivationCommand = command as any;
      metadata.sourceAnalet = derivationCommand.sourceAnalet;
      metadata.derivationPrompt = derivationCommand.derivationPrompt;
    } else if (command.type === 'from_statement') {
      const statementCommand = command as any;
      metadata.statementId = statementCommand.statementId;
    }

    // Add any existing metadata from the command
    if ((command as any).metadata) {
      Object.assign(metadata, (command as any).metadata);
    }

    return metadata;
  }

  private getCommandContent(command: GenerationCommand): string {
    // Extract content based on command type
    switch (command.type) {
      case 'from_statement':
        return (command as any).statement || '';
      case 'from_notebook':
        return (command as any).pythonCode || '';
      case 'from_derivation':
        return (command as any).derivationPrompt || '';
      case 'from_framing':
        return (command as any).datasetName || 'framing';
      default:
        return command.type;
    }
  }

  private calculateChanges(oldAnalet: Analet | null, newAnalet: Analet): string[] {
    if (!oldAnalet) return ['created'];

    const changes: string[] = [];

    if (oldAnalet.statement !== newAnalet.statement) changes.push('statement');
    if (oldAnalet.cellQL !== newAnalet.cellQL) changes.push('cellQL');
    if (oldAnalet.explanation !== newAnalet.explanation) changes.push('explanation');
    if (JSON.stringify(oldAnalet.location) !== JSON.stringify(newAnalet.location)) changes.push('location');
    if (JSON.stringify(oldAnalet.tags) !== JSON.stringify(newAnalet.tags)) changes.push('tags');

    return changes;
  }
}
