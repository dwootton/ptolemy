import { Analet } from "../types/analet";
import { ConstraintService } from "../services/ConstraintService";
import {
  runUMAPJsProjection,
  UMAPJsProjectionOptions,
  UMAPJsDimensions,
  UMAPJsParameters
} from "../services/umapjs";
import { StateService } from "../services/StateService";

export interface UMAPResult {
  x: number;
  y: number;
}

export interface UMAPDimensions {
  width: number;
  height: number;
  padding?: number;
}

export interface UMAPParameters {
  nNeighbors?: number;
  minDist?: number;
  spread?: number;
  nEpochs?: number;
  learningRate?: number;
  randomSeed?: number;
}

export interface UMAPProjectionOptions {
  dimensions: UMAPDimensions;
  params?: UMAPParameters;
  constraintService?: ConstraintService;
}

/**
 * Extract embeddings from analets that have valid embedding data
 */
export function extractEmbeddings(analets: Analet[]): {
  embeddings: number[][];
  validAnalets: Analet[];
} {
  // Filter out analets with invalid embeddings, but log a warning with IDs
  const validAnalets = analets.filter(analet => Array.isArray(analet.embedding) && analet.embedding.length > 0);
  const invalidAnalets = analets.filter(analet => !analet.embedding || analet.embedding.length === 0);
  if (invalidAnalets.length > 0) {
    console.warn(`⚠️ [UMAP Utils] Skipping ${invalidAnalets.length} analets with missing embeddings. IDs: ${invalidAnalets.map(a => a.id).join(', ')}`);
  }
  const embeddings = validAnalets.map(analet => analet.embedding!);
  return { embeddings, validAnalets };
}

/**
 * Validate embeddings array
 */
export function validateEmbeddings(embeddings: number[][]): boolean {
  if (embeddings.length === 0) return false;

  const firstLength = embeddings[0].length;
  if (firstLength === 0) return false;

  // Check all embeddings have same length and contain valid numbers
  return embeddings.every(embedding =>
    embedding.length === firstLength &&
    embedding.every(value => typeof value === 'number' && !isNaN(value))
  );
}

/**
 * Create and configure UMAP instance with constraint support
 */
export function createUMAP(_params: UMAPParameters = {}): any {
  throw new Error('Custom UMAP implementation removed - use UMAP-JS implementation instead');
}

/**
 * Project embeddings to 2D using UMAP with constraint support
 */
export function projectEmbeddings(
  _embeddings: number[][],
  _validAnalets: Analet[],
  _dimensions: UMAPDimensions,
  _params: UMAPParameters = {},
  _constraintService?: ConstraintService
): number[][] {
  throw new Error('Custom UMAP projectEmbeddings removed - use runUMAPJsProjection instead');
}

/**
 * Handle edge cases for small datasets
 */
export function handleSmallDataset(
  count: number,
  dimensions: UMAPDimensions
): UMAPResult[] {
  const { width, height, padding = 20 } = dimensions;

  if (count === 0) {
    return [];
  }

  if (count === 1) {
    return [{ x: width / 2, y: height / 2 }];
  }

  if (count === 2) {
    const centerY = height / 2;
    const spacing = (width - 2 * padding) / 3;
    return [
      { x: padding + spacing, y: centerY },
      { x: padding + 2 * spacing, y: centerY }
    ];
  }

  // For 3+ items, use grid layout as fallback
  return createGridLayout(count, dimensions);
}

/**
 * Create grid layout as fallback
 */
export function createGridLayout(
  count: number,
  dimensions: UMAPDimensions
): UMAPResult[] {
  const { width, height, padding = 20 } = dimensions;
  const availableWidth = width - 2 * padding;
  const availableHeight = height - 2 * padding;

  const cols = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);

  const cellWidth = availableWidth / cols;
  const cellHeight = availableHeight / rows;

  const results: UMAPResult[] = [];

  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / cols);
    const col = i % cols;

    results.push({
      x: padding + col * cellWidth + cellWidth / 2,
      y: padding + row * cellHeight + cellHeight / 2
    });
  }

  return results;
}

/**
 * Apply constraint positions to already-projected coordinates
 */
export function applyConstraintsToResults(
  results: UMAPResult[],
  validAnalets: Analet[],
  constraintService?: ConstraintService
): UMAPResult[] {
  if (!constraintService) return results;

  const constrainedResults = [...results];
  let constraintsApplied = 0;

  validAnalets.forEach((analet, index) => {
    const constraintPosition = constraintService.getConstraintPosition(analet.id);
    if (constraintPosition) {
      constrainedResults[index] = { ...constraintPosition };
      constraintsApplied++;
    }
  });


  return constrainedResults;
}

/**
 * Main UMAP projection function with constraint support and implementation switching
 */
export function runUMAPProjection(
  analets: Analet[],
  options: UMAPProjectionOptions
): { results: UMAPResult[]; validAnalets: Analet[] } {
  // Get the configured UMAP implementation
  const stateService = StateService.getInstance();
  const umapImplementation = stateService.getUMAPImplementation();
  if (analets.length === 0) {
    return { results: [], validAnalets: [] };
  }

  // Route to appropriate implementation
  if (umapImplementation === 'umap-js') {

    return runUMAPJsProjectionWrapper(analets, options);
  } else {
    return runCustomUMAPProjection(analets, options);
  }
}

/**
 * Wrapper for umap-js implementation
 */
function runUMAPJsProjectionWrapper(
  analets: Analet[],
  options: UMAPProjectionOptions
): { results: UMAPResult[]; validAnalets: Analet[] } {
  const { dimensions, params = {}, constraintService } = options;

  // Convert to umap-js format
  const umapJsOptions: UMAPJsProjectionOptions = {
    dimensions: dimensions as UMAPJsDimensions,
    params: params as UMAPJsParameters,
    constraintService
  };

  try {
    const { results: umapJsResults, validAnalets } = runUMAPJsProjection(analets, umapJsOptions);
    // Convert UMAPJsResult[] to UMAPResult[] (they have the same interface)
    const results: UMAPResult[] = umapJsResults;
    return { results, validAnalets };
  } catch (error) {
    console.error('❌ [UMAP Utils] UMAP-JS projection failed, falling back to custom implementation:', error);
    return runCustomUMAPProjection(analets, options);
  }
}

/**
 * Original custom UMAP implementation (deprecated - falls back to grid layout)
 */
function runCustomUMAPProjection(
  analets: Analet[],
  options: UMAPProjectionOptions
): { results: UMAPResult[]; validAnalets: Analet[] } {
  console.warn('⚠️ [UMAP Utils] Custom UMAP implementation removed, falling back to grid layout');

  const { dimensions, constraintService } = options;
  const { validAnalets } = extractEmbeddings(analets);

  if (validAnalets.length === 0) {
    console.warn('⚠️ [UMAP Utils] No valid embeddings found');
    return { results: [], validAnalets: [] };
  }

  // Handle small datasets with special cases
  if (validAnalets.length <= 2) {
    const results = handleSmallDataset(validAnalets.length, dimensions);
    const constrainedResults = applyConstraintsToResults(results, validAnalets, constraintService);
    return { results: constrainedResults, validAnalets };
  }

  // Use grid layout fallback
  const results = createGridLayout(validAnalets.length, dimensions);
  const constrainedResults = applyConstraintsToResults(results, validAnalets, constraintService);
  return { results: constrainedResults, validAnalets };
}


