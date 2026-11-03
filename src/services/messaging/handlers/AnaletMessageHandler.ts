// @ts-nocheck
/**
 * AnaletMessageHandler - Handles all analet-related operations
 * Leverages the unified AnaletController for clean, consistent analet management
 */

import { BaseMessageHandler } from '../BaseMessageHandler';
import { MessageContext } from '../types';
import { createAnaletController, type AnaletController } from '../../analet';
import { AnaletStore } from '../../AnaletStore';
import { DatasetSummarizerService } from '../../DatasetSummarizerService';
import { NewOpenAIService } from '../../llm/NewOpenAIService';

export class AnaletMessageHandler extends BaseMessageHandler {
  private analetController?: AnaletController;
  private processedRequestIds: Set<string> = new Set();

  constructor() {
    super([
      'generate-analyses',
      'add-waypoint-analets', 
      'add-waypoint-analets-for-bearing',
      'create-analet',
      'create-analet-for-bearing',
      'derive-analet',
      'delete-analet',
      'update-analet',
      'perturb-analet',
      'accept-ai-explanation',
      'generate-analets-from-statement',
      // NN-based analet preview entrypoint (reusing existing UI message)
      'generate-embedding-description',
      // Confirm creation of an analet from an embedding preview
      'create-analet-from-embedding',
      // Hierarchy-based analet preview entrypoint
      'generate-hierarchy-description',
      // Generate full analet during preview (stores in state)
      'generate-hierarchy-analet',
      // Save existing analet from hierarchy context
      'save-analet-from-hierarchy',
      // Confirm creation of an analet from hierarchy context
      'create-analet-from-hierarchy'
    ]);
  }

  public async initialize(context: MessageContext): Promise<void> {
    await super.initialize(context);
    
    // Initialize AnaletStore if not already provided
    if (!context.analetStore && context.stateService) {
      context.analetStore = AnaletStore.getInstance(context.stateService.getContext());
    }
    
    // Create unified analet controller
    this.analetController = createAnaletController(
      context.stateService,
      context.messageRouter,
      context.analetStore
    );
    
    this.log('info', 'Initialized with unified AnaletController');
  }

  /**
   * Get the AnaletController instance (for service wiring)
   */
  public getAnaletController(): AnaletController | undefined {
    return this.analetController;
  }

  public async handle(messageType: string, data: any, context: MessageContext): Promise<void> {
    if (!this.analetController) {
      console.error('[DEBUG-ANALYSISMAP] AnaletController not initialized!');
      throw new Error('AnaletController not initialized');
    }

    switch (messageType) {
      case 'generate-analyses':
        await this.handleGenerateAnalyses(data);
        break;
      case 'generate-embedding-description':
        await this.handlePreviewAnaletFromEmbedding(data);
        break;
      case 'create-analet-from-embedding':
        await this.handleCreateAnaletFromEmbedding(data);
        break;
      case 'generate-hierarchy-description':
        await this.handlePreviewAnaletFromHierarchy(data);
        break;
      case 'generate-hierarchy-analet':
        await this.handleGenerateAnaletFromHierarchy(data);
        break;
      case 'save-analet-from-hierarchy':
        await this.handleSaveAnaletFromHierarchy(data);
        break;
      case 'create-analet-from-hierarchy':
        await this.handleCreateAnaletFromHierarchy(data);
        break;
      case 'add-waypoint-analets':
        await this.handleAddWaypointAnalets(data);
        break;
      case 'add-waypoint-analets-for-bearing':
        await this.handleAddWaypointAnaletsForBearing(data);
        break;
      case 'create-analet':
        await this.handleCreateAnalet(data);
        break;
      case 'create-analet-for-bearing':
        await this.handleCreateAnaletForBearing(data);
        break;
      case 'derive-analet':
        await this.handleDeriveAnalet(data);
        break;
      case 'delete-analet':
        await this.handleDeleteAnalet(data);
        break;
      case 'update-analet':
        await this.handleUpdateAnalet(data);
        break;
      case 'perturb-analet':
        await this.handlePerturbAnalet(data);
        break;
      case 'accept-ai-explanation':
        await this.handleAcceptAIExplanation(data);
        break;
      case 'generate-analets-from-statement':
        await this.handleGenerateAnaletsFromStatement(data);
        break;
      default:
        throw new Error(`Unsupported message type: ${messageType}`);
    }
  }

  /**
   * Generate initial framing analets for a dataset
   */
  private async handleGenerateAnalyses(data?: any): Promise<void> {
    try {
      // TEMPORARY: Disable generation pipeline entirely; always return cached analets
      try {
        const existingAnalets = await this.analetController!.getAllAnalets();
        await this.sendMessage('fetch-analet-data', {
          analets: await this.ensureAnaletEmbeddings(existingAnalets || []),
          success: true,
          loadedFromCache: true,
          usingMockData: false
        });
        await this.sendMessage('analysis-status', { state: 'idle' });
        return;
      } catch {}

      this.log('info', 'Starting analet generation', { forceGenerate: data?.forceGenerate });
      const forceGenerate = data?.forceGenerate || false;
      
      // Check for existing analets first
      const existingAnalets = await this.analetController!.getAllAnalets();
      
      if (!forceGenerate && existingAnalets.length > 0) {
        this.log('info', `Found ${existingAnalets.length} existing analets, returning cached data`);
        
        // Ensure all cached analets have embeddings
        const analetsWithEmbeddings = await this.ensureAnaletEmbeddings(existingAnalets);
        
        await this.sendMessage('fetch-analet-data', {
          analets: analetsWithEmbeddings,
          success: true,
          loadedFromCache: true,
          usingMockData: false
        });
        return;
      }
      
      // Generate framing analets using the unified controller
      await this.sendMessage('analysis-status', { state: 'connecting' });
      
      // Get dataset context
      const summarizerSvc = DatasetSummarizerService.getInstance();
      const datasetContext = summarizerSvc.getDatasetContext();
      const datasetInfo = summarizerSvc.getDatasetInfo();
      
      if (!datasetInfo || datasetContext === 'No dataset currently loaded.') {
        throw new Error('No dataset context available for generation');
      }
      
      await this.sendMessage('analysis-status', { state: 'generating' });
      
      const result = await this.analetController!.generateAnalets({
        command: {
          type: 'from_framing',
          datasetContext,
          datasetName: datasetInfo.name,
          columnDefinitions: undefined // TODO: Get from dataset if available
        }
      });
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to generate analets');
      }
      
      await this.sendMessage('analysis-status', { state: 'processing' });
      
      // Ensure all analets have embeddings
      const analetsWithEmbeddings = await this.ensureAnaletEmbeddings(result.analets);
      
      // Send results to frontend
      await this.sendMessage('fetch-analet-data', {
        analets: analetsWithEmbeddings,
        success: true,
        usingMockData: false,
        loadedFromCache: false
      });

      // Auto-promote a starter set of framing analets to waypoints so the UI can render
      try {
        const allAfterGen = await this.analetController!.getAllAnalets();
        const hasWaypoint = allAfterGen.some(a => a.type === 'waypoint');
        const framingCount = allAfterGen.filter(a => a.type === 'framing').length;
        if (!hasWaypoint && framingCount > 0) {
          const promoteCount = 20;
          const promoted = await this.analetController!.promoteFramingAnalets(promoteCount);
          const promotedWithEmbeddings = await this.ensureAnaletEmbeddings(promoted);
          const allAnaletsNow = await this.analetController!.getAllAnalets();
          const allAnaletsWithEmbeddings = await this.ensureAnaletEmbeddings(allAnaletsNow);
          await this.sendMessage('fetch-analet-data', {
            analets: allAnaletsWithEmbeddings,
            success: true,
            promotedFromFraming: true,
            newAnaletsCount: promotedWithEmbeddings.length
          });
        }
      } catch (e) {
        this.log('warn', 'Auto-promotion after generation failed; user can trigger manually');
      }
      
      // Signal completion
      await this.sendMessage('analysis-status', { state: 'idle' });
      
    } catch (error) {
      await this.sendError('generate-analyses', error, data);
      await this.sendMessage('analysis-status', { state: 'idle' });
    }
  }

  /**
   * Promote framing analets to waypoint analets (for display)
   */
  private async handleAddWaypointAnalets(data: any): Promise<void> {
    try {
      // TEMPORARY: Disable promotion path; always send current analets unchanged
      const allAnalets = await this.analetController!.getAllAnalets();
      const allAnaletsWithEmbeddings = await this.ensureAnaletEmbeddings(allAnalets);
      await this.sendMessage('fetch-analet-data', {
        analets: allAnaletsWithEmbeddings,
        success: true,
        promotedFromFraming: false,
        newAnaletsCount: 0
      });
      
    } catch (error) {
      await this.sendError('add-waypoint-analets', error, data);
    }
  }

  /**
   * Generate focus-aware analets related to the current bearing
   */
  private async handleAddWaypointAnaletsForBearing(data: any): Promise<void> {
    try {
      // TEMPORARY: Disable focus-aware generation; send current analets unchanged
      const allAnalets = await this.analetController!.getAllAnalets();
      const allAnaletsWithEmbeddings = await this.ensureAnaletEmbeddings(allAnalets);
      await this.sendMessage('fetch-analet-data', {
        analets: allAnaletsWithEmbeddings,
        success: true,
        generatedFromFocus: false,
        bearingId: data?.bearingId,
        newAnaletsCount: 0
      });
      
    } catch (error) {
      await this.sendError('add-waypoint-analets-for-bearing', error, data);
    }
  }

  /**
   * Create a new analet from user input, bearing-aware variant
   */
  private async handleCreateAnaletForBearing(data: any): Promise<void> {
    try {
      const validation = this.validateData(data, ['statement', 'bearingId']);
      if (!validation.isValid) {
        throw new Error(validation.error);
      }

      this.log('info', 'Creating new analet (bearing-aware)', { statement: data.statement, bearingId: data.bearingId });
      const result = await this.analetController!.generateAnalets({
        command: {
          type: 'from_statement',
          statement: data.statement,
          explanation: data.explanation,
          tags: data.tags || []
        }
      });

      if (!result.success || !result.analets || result.analets.length === 0) {
        throw new Error(result.error || 'Failed to create analet');
      }

      const newAnalet = result.analets[0];
      const analetWithEmbedding = await this.ensureAnaletEmbeddings([newAnalet]);
      await this.sendMessage('refresh-analets', {
        action: 'created-for-bearing',
        analet: analetWithEmbedding[0],
        success: true,
        bearingId: data.bearingId
      });
    } catch (error) {
      await this.sendError('create-analet-for-bearing', error, data);
    }
  }

  /**
   * Create a new analet from user input
   */
  private async handleCreateAnalet(data: any): Promise<void> {
    try {
      const validation = this.validateData(data, ['statement']);
      if (!validation.isValid) {
        throw new Error(validation.error);
      }

      this.log('info', 'Creating new analet', { statement: data.statement });
      
      const result = await this.analetController!.generateAnalets({
        command: {
          type: 'from_statement',
          statement: data.statement,
          explanation: data.explanation,
          tags: data.tags || []
        }
      });
      
      if (!result.success || !result.analets || result.analets.length === 0) {
        throw new Error(result.error || 'Failed to create analet');
      }
      
      const newAnalet = result.analets[0];
      
      // Ensure analet has embedding
      const analetWithEmbedding = await this.ensureAnaletEmbeddings([newAnalet]);
      
      await this.sendMessage('refresh-analets', {
        action: 'created',
        analet: analetWithEmbedding[0],
        success: true
      });
      
    } catch (error) {
      await this.sendError('create-analet', error, data);
    }
  }

  /**
   * Derive a new analet from an existing one
   */
  private async handleDeriveAnalet(data: any): Promise<void> {
    try {
      const validation = this.validateData(data, ['analetId', 'statement']);
      if (!validation.isValid) {
        throw new Error(validation.error);
      }

      this.log('info', 'Deriving new analet', { 
        sourceAnaletId: data.analetId, 
        statement: data.statement 
      });
      
      const result = await this.analetController!.generateAnalets({
        command: {
          type: 'from_derivation',
          sourceAnaletId: data.analetId,
          statement: data.statement,
          explanation: data.explanation
        }
      });
      
      if (!result.success || !result.analets || result.analets.length === 0) {
        throw new Error(result.error || 'Failed to derive analet');
      }
      
      const derivedAnalet = result.analets[0];
      
      // Ensure analet has embedding
      const analetWithEmbedding = await this.ensureAnaletEmbeddings([derivedAnalet]);
      
      await this.sendMessage('refresh-analets', {
        action: 'derived',
        analet: analetWithEmbedding[0],
        success: true,
        derivedFrom: data.analetId
      });
      
    } catch (error) {
      await this.sendError('derive-analet', error, data);
    }
  }

  /**
   * Delete an analet
   */
  private async handleDeleteAnalet(data: any): Promise<void> {
    try {
      const validation = this.validateData(data, ['analetId']);
      if (!validation.isValid) {
        throw new Error(validation.error);
      }

      this.log('info', 'Deleting analet', { analetId: data.analetId });
      
      const deleted = await this.analetController!.deleteAnalet(data.analetId);
      
      if (!deleted) {
        throw new Error('Failed to delete analet');
      }
      
      // Get remaining analets
      const remainingAnalets = await this.analetController!.getAllAnalets();
      
      await this.sendMessage('delete-analet-response', {
        success: true,
        deletedAnaletId: data.analetId,
        remainingAnalets: remainingAnalets
      });
      
    } catch (error) {
      await this.sendError('delete-analet', error, data);
    }
  }

  /**
   * Update an existing analet
   */
  private async handleUpdateAnalet(data: any): Promise<void> {
    try {
      const validation = this.validateData(data, ['analetId']);
      if (!validation.isValid) {
        throw new Error(validation.error);
      }

      this.log('info', 'Updating analet', { analetId: data.analetId });
      
      const result = await this.analetController!.updateAnalet(data.analetId, data);
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to update analet');
      }
      
      await this.sendMessage('analet-updated', {
        analet: result.analet,
        success: true
      });
      
    } catch (error) {
      await this.sendError('update-analet', error, data);
    }
  }

  /**
   * Generate perturbations for an analet
   */
  private async handlePerturbAnalet(data: any): Promise<void> {
    try {
      const validation = this.validateData(data, ['analetId']);
      if (!validation.isValid) {
        throw new Error(validation.error);
      }

      this.log('info', 'Generating analet perturbations', { analetId: data.analetId });
      
      // Get the source analet
      const sourceAnalet = await this.analetController!.getAnalet(data.analetId);
      if (!sourceAnalet) {
        throw new Error('Source analet not found');
      }

      // Generate perturbations (variations of the analet)
      const result = await this.analetController!.generateAnalets({
        command: {
          type: 'from_derivation',
          sourceAnaletId: data.analetId,
          statement: sourceAnalet.statement,
          perturbation: true // Special flag for perturbation
        }
      });
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to generate perturbations');
      }
      
      await this.sendMessage('analet-perturbations', {
        sourceAnaletId: data.analetId,
        perturbations: result.analets,
        success: true
      });
      
    } catch (error) {
      await this.sendError('perturb-analet', error, data);
    }
  }

  /**
   * Accept an AI-generated explanation for an analet
   */
  private async handleAcceptAIExplanation(data: any): Promise<void> {
    try {
      const validation = this.validateData(data, ['analetId', 'explanation']);
      if (!validation.isValid) {
        throw new Error(validation.error);
      }

      this.log('info', 'Accepting AI explanation', { analetId: data.analetId });
      
      const result = await this.analetController!.updateAnalet(data.analetId, {
        explanation: data.explanation,
        aiGenerated: true
      });
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to accept AI explanation');
      }
      
      await this.sendMessage('analet-updated', {
        analet: result.analet,
        success: true,
        explanationAccepted: true
      });
      
    } catch (error) {
      await this.sendError('accept-ai-explanation', error, data);
    }
  }

  /**
   * Generate multiple analets from a single statement
   */
  private async handleGenerateAnaletsFromStatement(data: any): Promise<void> {
    try {
      const validation = this.validateData(data, ['statement']);
      if (!validation.isValid) {
        throw new Error(validation.error);
      }

      const count = data.count || 3;
      this.log('info', 'Generating multiple analets from statement', { 
        statement: data.statement, 
        count 
      });
      
      const results = [];
      
      // Generate multiple variations
      for (let i = 0; i < count; i++) {
        const result = await this.analetController!.generateAnalets({
          command: {
            type: 'from_statement',
            statement: data.statement,
            variation: i + 1 // Add variation parameter
          }
        });
        
        if (result.success && result.analets) {
          results.push(...result.analets);
        }
      }
      
      if (results.length === 0) {
        throw new Error('Failed to generate any analets from statement');
      }
      
      // Ensure all analets have embeddings
      const analetsWithEmbeddings = await this.ensureAnaletEmbeddings(results);
      
      await this.sendMessage('analets-generated-from-statement', {
        analets: analetsWithEmbeddings,
        success: true,
        sourceStatement: data.statement
      });
      
    } catch (error) {
      await this.sendError('generate-analets-from-statement', error, data);
    }
  }

  /**
   * Ensure all analets have embeddings for UMAP visualization
   */
  private async ensureAnaletEmbeddings(analets: any[]): Promise<any[]> {
    if (!analets || analets.length === 0) {
      return [];
    }

    const openAIService = NewOpenAIService.getInstance();
    const analetsWithEmbeddings = [];

    for (const analet of analets) {
      if (!analet.embedding || analet.embedding.length === 0) {
        this.log('warn', `Analet ${analet.id} missing embedding, generating...`);
        
        try {
          const target = analet.cellQL && analet.cellQL.trim().length > 0
            ? analet.cellQL 
            : `${analet.statement}: ${analet.explanation || ''}`;
          
          const embeddings = await openAIService.generateEmbeddings([target]);
          analet.embedding = embeddings[0] || [];
          
          this.log('info', `Generated embedding for analet ${analet.id}`);
        } catch (error) {
          this.log('error', `Failed to generate embedding for analet ${analet.id}`, error);
          analet.embedding = []; // Set empty embedding to avoid repeated attempts
        }
      }
      
      analetsWithEmbeddings.push(analet);
    }

    const missingEmbeddings = analetsWithEmbeddings.filter(a => !a.embedding || a.embedding.length === 0);
    if (missingEmbeddings.length > 0) {
      this.log('warn', `${missingEmbeddings.length} analets still missing embeddings after generation attempt`);
    }

    return analetsWithEmbeddings;
  }

  /**
   * Generate an analet from a cursor embedding by finding nearest existing analets
   * and delegating to the unified AnaletController via the EmbeddingAdapter.
   * Keeps the response shape expected by the UI ('embedding-description-response').
   */
  private async handlePreviewAnaletFromEmbedding(data: any): Promise<void> {
    try {
      const validation = this.validateData(data, ['embedding', 'x', 'y']);
      if (!validation.isValid) {
        throw new Error(validation.error);
      }

      const { embedding, x, y, requestId } = data;
      this.log('info', 'Previewing analet from cursor embedding', { x, y });

      // Gather candidate analets with embeddings
      const allAnalets = await this.analetController!.getAllAnalets();
      const candidates = (allAnalets || []).filter(a => Array.isArray(a.embedding) && a.embedding.length > 0);
      if (candidates.length === 0) {
        await this.sendMessage('embedding-description-response', {
          success: false,
          error: 'No existing analets with embeddings found for NN search',
          requestId
        });
        return;
      }

      // Compute Euclidean distances and select top K
      const distanceTo = (a: number[], b: number[]): number => {
        const len = Math.min(a.length, b.length);
        let sum = 0;
        for (let i = 0; i < len; i++) {
          const d = a[i] - b[i];
          sum += d * d;
        }
        return Math.sqrt(sum);
      };

      const scored = candidates.map(a => ({
        analet: a,
        distance: distanceTo(embedding, a.embedding)
      })).sort((p, q) => p.distance - q.distance);

      const K = 5;
      const nearest = scored.slice(0, Math.min(K, scored.length));
      if (nearest.length === 0) {
        await this.sendMessage('embedding-description-response', {
          success: false,
          error: 'Failed to find nearest neighbors',
          requestId
        });
        return;
      }

      // Build adapter input from nearest neighbors
      const nearestAnalets = nearest.map(n => ({
        id: n.analet.id,
        statement: n.analet.statement,
        explanation: n.analet.explanation,
        embedding: n.analet.embedding,
        location: n.analet.location
      }));

      // Compute interpolated position using 2D inverse-distance weighting to neighbor map positions
      const interp = (() => {
        const points = nearestAnalets
          .map(nn => ({
            x: typeof nn.location?.x === 'number' ? nn.location.x : undefined,
            y: typeof nn.location?.y === 'number' ? nn.location.y : undefined
          }))
          .filter(p => typeof p.x === 'number' && typeof p.y === 'number') as Array<{x: number; y: number}>;
        if (points.length === 0) return { x, y };
        const eps = 1.0;
        const power = 2.0;
        let wsum = 0;
        let px = 0;
        let py = 0;
        for (const p of points) {
          const dx = p.x - x;
          const dy = p.y - y;
          const d = Math.sqrt(dx*dx + dy*dy);
          const w = 1 / Math.pow(d + eps, power);
          wsum += w;
          px += w * p.x;
          py += w * p.y;
        }
        if (wsum === 0) return { x, y };
        return { x: px / wsum, y: py / wsum };
      })();

      // Also propose a single-sentence analysis idea for confirmation flow
      let idea = '';
      try {
        const openAI = NewOpenAIService.getInstance();
        // Build distance-weighted neighbor context to bias the idea toward the closest neighbor(s)
        const eps = 1.0;
        const power = 2.0;
        const weighted = nearest.map(n => {
          const d = n.distance;
          const w = 1 / Math.pow((isFinite(d) ? d : 0) + eps, power);
          return { analet: n.analet, dist: d, w };
        });
        const wsum = weighted.reduce((acc, v) => acc + v.w, 0) || 1;
        const sorted = weighted
          .map(v => ({
            weight: v.w / wsum,
            statement: v.analet.statement
          }))
          .sort((a, b) => b.weight - a.weight);

        const weightedLines = sorted.slice(0, 5).map((v, i) => `${i + 1}) weight=${v.weight.toFixed(3)} :: ${v.statement}`).join('\n');

        const ideaPrompt = `You are helping propose one concise analysis idea based on nearby analyses in a 2D concept map. Neighbors have weights; prioritize higher-weight entries. Return exactly ONE sentence (no extra text).

NEAREST NEIGHBORS (weighted):
${weightedLines}

Instruction: Propose one single-sentence analysis idea that is most consistent with the highest-weighted neighbors.`;

        idea = (await openAI.chatText({
          system: 'You are a data analysis expert. Respond with exactly one sentence and nothing else.',
          user: ideaPrompt,
          model: 'gpt-4.1-mini'
        })).trim().replace(/^"|"$/g, '');
      } catch (e) {
        this.log('warn', 'Failed to generate preview idea from NN context');
      }

      await this.sendMessage('embedding-description-response', {
        success: true,
        idea,
        position: interp,
        requestId
      });

    } catch (error) {
      await this.sendError('generate-embedding-description', error, data);
    }
  }

  /**
   * Create an analet from an embedding preview confirmation.
   * Uses updated pipeline stages to transform the idea into CellQL and enriches the analet,
   * then fixes its position at the cursor via persisted flags (frontend will also apply a Constraint).
   */
  private async handleCreateAnaletFromEmbedding(data: any): Promise<void> {
    try {
      const validation = this.validateData(data, ['idea', 'x', 'y']);
      if (!validation.isValid) {
        throw new Error(validation.error);
      }

      const { idea, x, y, requestId } = data;
      this.log('info', 'Creating analet from embedding confirmation', { x, y });

      // Generate using AnaletController with Statement adapter pathway so enrichment pipeline is applied
      const result = await this.analetController!.generateAnalets({
        command: {
          type: 'from_statement',
          statement: idea,
          maxCount: 1,
          position: { x, y },
          metadata: {
            source: 'embedding',
            isFixed: true,
            fixedPosition: { x, y },
            constraintStrength: 1.0
          }
        } as any
      });

      if (!result.success || !result.analets || result.analets.length === 0) {
        throw new Error(result.error || 'Failed to create analet from embedding');
      }

      const created = result.analets[0];
      // Ensure embedding present
      const [withEmbedding] = await this.ensureAnaletEmbeddings([created]);

      // Persist fixed metadata on analet to mirror constraint intent
      withEmbedding.isFixed = true;
      withEmbedding.fixedPosition = { x, y } as any;
      withEmbedding.constraintStrength = 1.0;

      await this.sendMessage('refresh-analets', {
        action: 'created-from-embedding',
        success: true,
        analet: withEmbedding,
        requestId
      });
    } catch (error) {
      await this.sendError('create-analet-from-embedding', error, data);
    }
  }

  /**
   * Generate an analet preview from hierarchy context by finding similar analets
   * and delegating to the unified AnaletController via the HierarchyAdapter.
   */
  private async handlePreviewAnaletFromHierarchy(data: any): Promise<void> {
    try {
      const validation = this.validateData(data, ['path', 'depth', 'siblingContext', 'ancestorContext', 'ordinalDistances']);
      if (!validation.isValid) {
        throw new Error(validation.error);
      }

      const { path, depth, parentContext, siblingContext, ancestorContext, ordinalDistances, requestId } = data;
      this.log('info', 'Previewing analet from hierarchy context', { path, depth });

      // Strict local context; no global similarity search
      // LLM-only preview: build a concise preview idea from hierarchy context (no adapter/pipeline here)
      const openAI = NewOpenAIService.getInstance();
      const siblingLines = (siblingContext || [])
        .filter((s: any) => s.kind === 'analet' && s.data?.statement)
        .slice(0, 3)
        .map((s: any, i: number) => `${i + 1}. ${s.data.statement}`)
        .join('\n');

      const ancestorLines = (ancestorContext || [])
        .filter((a: any) => a.kind === 'analet' && a.data?.statement)
        .slice(0, 2)
        .map((a: any, i: number) => `${i + 1}. ${a.data.statement}`)
        .join('\n');

      const contextText = [
        siblingLines ? `SIBLINGS (same level):\n${siblingLines}` : '',
        ancestorLines ? `ANCESTORS (lineage):\n${ancestorLines}` : ''
      ].filter(Boolean).join('\n\n');

      const generationMode = (data?.generationMode === 'followup') ? 'followup' : 'sibling';
      let previewPrompt: string;
      if (generationMode === 'followup' && parentContext?.kind === 'analet' && parentContext?.data?.statement) {
        const parentStmt = String(parentContext.data.statement);
        previewPrompt = `You are a data analysis expert. Write exactly ONE follow-up question (one sentence, no quotes, no extra text) that would add nuance or depth to this parent analysis idea:\n\nPARENT:\n${parentStmt}\n\nYou may draw subtle inspiration from siblings/ancestors if relevant, but do not restate the parent. ${contextText ? `\n\n${contextText}` : ''}`;
      } else {
        previewPrompt = `You are a data analysis expert. Based on nearby analyses in the hierarchy, propose exactly ONE single-sentence idea (no extra text).\n\n${contextText}`;
      }

      const idea = (await openAI.chatText({
        system: 'Respond with exactly one sentence and nothing else.',
        user: previewPrompt,
        model: 'gpt-4o-mini'
      })).trim().replace(/^"|"$/g, '');

      await this.sendMessage('hierarchy-description-response', {
        success: true,
        idea,
        path,
        depth,
        similarAnaletsCount: 0,
        requestId
      });

    } catch (error) {
      await this.sendError('generate-hierarchy-description', error, data);
    }
  }

  /**
   * Generate full analet during preview (stores in state)
   */
  private async handleGenerateAnaletFromHierarchy(data: any): Promise<void> {
    try {
      const validation = this.validateData(data, ['path', 'depth', 'siblingContext', 'ancestorContext', 'ordinalDistances']);
      if (!validation.isValid) {
        throw new Error(validation.error);
      }

      const { path, depth, parentContext, siblingContext, ancestorContext, ordinalDistances, requestId } = data;
      this.log('info', 'Generating full analet from hierarchy context', { path, depth });

      // Generate using AnaletController with Hierarchy adapter pathway (STRICT LOCAL CONTEXT)
      const generationMode = (data?.generationMode === 'followup') ? 'followup' : 'sibling';
      const result = await this.analetController!.generateAnalets({
        command: {
          type: 'from_hierarchy',
          path,
          depth,
          parentContext,
          siblingContext,
          ancestorContext,
          ordinalDistances,
          // Do not use global similar analets; keep it strictly local
          similarAnalets: [],
          maxCount: 1,
          metadata: {
            source: 'hierarchy-preview',
            path,
            depth,
            generationMode
          }
        } as any
      });

      if (!result.success || !result.analets || result.analets.length === 0) {
        throw new Error(result.error || 'Failed to generate hierarchy analet');
      }

      const generated = result.analets[0];
      // Ensure embedding present
      const [withEmbedding] = await this.ensureAnaletEmbeddings([generated]);

      await this.sendMessage('hierarchy-analet-response', {
        success: true,
        analet: withEmbedding,
        path,
        requestId
      });

    } catch (error) {
      await this.sendError('generate-hierarchy-analet', error, data);
    }
  }

  /**
   * Save existing analet from hierarchy context
   */
  private async handleSaveAnaletFromHierarchy(data: any): Promise<void> {
    try {
      const validation = this.validateData(data, ['analet', 'path']);
      if (!validation.isValid) {
        throw new Error(validation.error);
      }

      const { analet, path, requestId } = data;
      const parentIdOverride = data?.parentIdOverride;
      const explicitOrderIndex = Number.isFinite(data?.orderIndex) ? Number(data.orderIndex) : undefined;
      this.log('info', 'Saving existing analet from hierarchy context', { analetId: analet.id, path });

      // The analet is already generated, just ensure it's properly saved
      const [withEmbedding] = await this.ensureAnaletEmbeddings([analet]);

      await this.sendMessage('refresh-analets', {
        action: 'saved-from-hierarchy',
        success: true,
        analet: withEmbedding,
        requestId,
        path
      });

      // Also create a hierarchy edge so it appears in the tree
      try {
        const parentId = parentIdOverride || (Array.isArray(path) && path.length > 1
          ? (path[path.length - 1] === 'root' ? 'item:root' : path[path.length - 1])
          : 'item:root');
        const childId = `analet-${withEmbedding.id}`;
        await this.sendMessage('edges-add', {
          edges: [{ parentId, childId, type: 'tree', orderIndex: (explicitOrderIndex ?? 0) }]
        });
      } catch (edgeErr) {
        this.log('warn', 'Failed to add hierarchy edge for saved analet', edgeErr);
      }

    } catch (error) {
      await this.sendError('save-analet-from-hierarchy', error, data);
    }
  }

  /**
   * Create an analet from hierarchy context confirmation
   */
  private async handleCreateAnaletFromHierarchy(data: any): Promise<void> {
    try {
      const validation = this.validateData(data, ['idea', 'path', 'depth']);
      if (!validation.isValid) {
        console.error('❌ [AnaletMessageHandler] Validation failed:', validation.error);
        throw new Error(validation.error);
      }

      const { idea, path, depth, requestId } = data;
      const parentIdOverride = data?.parentIdOverride;
      const explicitOrderIndex = Number.isFinite(data?.orderIndex) ? Number(data.orderIndex) : undefined;
      this.log('info', 'Creating analet from hierarchy context (from_statement pipeline)', { path, depth });
      // De-dup repeated frontend sends
      if (requestId && this.processedRequestIds.has(requestId)) {
        this.log('warn', 'Duplicate create-analet-from-hierarchy request ignored', { requestId });
        return;
      }

      const result = await this.analetController!.generateAnalets({
        command: {
          type: 'from_statement',
          statement: idea,
          maxCount: 1,
          metadata: {
            source: 'hierarchy',
            path,
            depth
          }
        } as any
      });
      if (!result.success || !result.analets || result.analets.length === 0) {
        console.error('❌ [AnaletMessageHandler] Generation failed:', result.error);
        throw new Error(result.error || 'Failed to create analet from hierarchy');
      }

      const created = result.analets[0];
      // Ensure embedding present
      const [withEmbedding] = await this.ensureAnaletEmbeddings([created]);
      await this.sendMessage('refresh-analets', {
        action: 'created-from-hierarchy',
        success: true,
        analet: withEmbedding,
        requestId,
        path,
        parentIdOverride,
        orderIndex: explicitOrderIndex
      });

      // Also create a hierarchy edge so it appears in the tree
      try {
        const parentId = parentIdOverride || (Array.isArray(path) && path.length > 1
          ? (path[path.length - 1] === 'root' ? 'item:root' : path[path.length - 1])
          : 'item:root');
        const childId = `analet-${withEmbedding.id}`;
        await this.sendMessage('edges-add', {
          edges: [{ parentId, childId, type: 'tree', orderIndex: (explicitOrderIndex ?? 0) }]
        });
      } catch (edgeErr) {
        this.log('warn', 'Failed to add hierarchy edge for created analet', edgeErr);
      }

      if (requestId) this.processedRequestIds.add(requestId);
    } catch (error) {
      console.error('❌ [AnaletMessageHandler] Error in handleCreateAnaletFromHierarchy:', error);
      console.error('❌ [AnaletMessageHandler] Error details:', {
        message: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined
      });
      await this.sendError('create-analet-from-hierarchy', error, data);
    }
  }

  /**
   * Find analets similar to hierarchy context using simple similarity heuristics
   */
  private findHierarchySimilarAnalets(
    candidates: any[],
    context: any,
    maxResults: number = 5
  ): Array<{ analet: any; similarity: number; reason: string }> {
    const results: Array<{ analet: any; similarity: number; reason: string }> = [];

    for (const analet of candidates) {
      let similarity = 0;
      const reasons: string[] = [];

      // Check parent context similarity
      if (context.parent?.kind === 'bearing' && context.parent.data) {
        const bearing = context.parent.data;
        if (analet.bearingId === bearing.id) {
          similarity += 0.4;
          reasons.push('belongs to same bearing');
        }
      }

      // Check sibling context similarity
      if (context.siblings && context.siblings.length > 0) {
        const siblingTags = context.siblings
          .filter((s: any) => s.kind === 'analet' && s.data?.tags)
          .flatMap((s: any) => s.data.tags);
        
        const analetTags = analet.tags || [];
        const commonTags = analetTags.filter((tag: string) => siblingTags.includes(tag));
        
        if (siblingTags.length > 0) {
          const tagSimilarity = commonTags.length / siblingTags.length;
          similarity += tagSimilarity * 0.3;
          if (commonTags.length > 0) {
            reasons.push(`shares tags: ${commonTags.join(', ')}`);
          }
        }
      }

      // Check statement similarity with siblings
      if (context.siblings && context.siblings.length > 0) {
        const siblingStatements = context.siblings
          .filter((s: any) => s.kind === 'analet' && s.data?.statement)
          .map((s: any) => s.data.statement);
        
        let maxStatementSimilarity = 0;
        for (const siblingStatement of siblingStatements) {
          const statementSimilarity = this.calculateTextSimilarity(analet.statement, siblingStatement);
          maxStatementSimilarity = Math.max(maxStatementSimilarity, statementSimilarity);
        }
        
        similarity += maxStatementSimilarity * 0.3;
        if (maxStatementSimilarity > 0.3) {
          reasons.push('similar statement content');
        }
      }

      if (similarity > 0) {
        results.push({
          analet,
          similarity,
          reason: reasons.join(', ') || 'structural similarity'
        });
      }
    }
    return results
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, maxResults);
  }

  /**
   * Calculate text similarity using simple word overlap
   */
  private calculateTextSimilarity(text1: string, text2: string): number {
    if (!text1 || !text2) return 0;

    const words1 = text1.toLowerCase().split(/\s+/);
    const words2 = text2.toLowerCase().split(/\s+/);
    
    const set1 = new Set(words1);
    const set2 = new Set(words2);
    
    const intersection = new Set([...set1].filter(x => set2.has(x)));
    const union = new Set([...set1, ...set2]);
    
    return intersection.size / union.size;
  }

  /**
   * Generate a short English description from nearest analets for preview purposes.
   */
  private createPreviewDescription(nearestAnalets: Array<{ id: number; statement: string }>): string {
    if (!nearestAnalets || nearestAnalets.length === 0) return 'No nearby analyses found.';
    const bullets = nearestAnalets.slice(0, 3).map((a, i) => `- ${a.statement}`).join('\n');
    return `This spot corresponds to analyses similar to:\n${bullets}\nSuggest a related analysis idea building on these.`;
  }
}
