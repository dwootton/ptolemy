/**
 * UMAP-JS wrapper service for Meridian
 * Alternative UMAP implementation using the umap-js library
 * with fixed random seed for deterministic embeddings
 */

import { UMAP as UMAPJs } from 'umap-js';
import { Analet } from '../types/analet';
import { ConstraintService } from './ConstraintService';

export interface UMAPJsResult {
  x: number;
  y: number;
}

export interface UMAPJsDimensions {
  width: number;
  height: number;
  padding?: number;
}

export interface UMAPJsParameters {
  nNeighbors?: number;
  minDist?: number;
  spread?: number;
  nEpochs?: number;
  learningRate?: number;
  randomSeed?: number;
}

export interface UMAPJsProjectionOptions {
  dimensions: UMAPJsDimensions;
  params?: UMAPJsParameters;
  constraintService?: ConstraintService;
}

/**
 * Persisted UMAP model interface for out-of-sample transforms
 */
export interface FittedUmapModel {
  /** The underlying fitted umap-js instance */
  umap: UMAPJs;
  /** Normalization bounds captured from the original fit */
  bounds: {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    /** Uniform scale derived from original fit */
    scale: number;
    /** Offsets used to center within padded dimensions */
    offsetX: number;
    offsetY: number;
  };
  /** Dimensions (including padding) for normalization */
  dimensions: UMAPJsDimensions;
  /**
   * Transform new embeddings (without refitting) into the 2D UMAP space
   */
  transform(embeddings: number[][]): number[][];
  /**
   * Normalize raw 2D points using the original fit's bounds to map to screen coordinates
   */
  normalize(points: number[][]): UMAPJsResult[];
}

/**
 * Extract embeddings from analets that have valid embedding data
 */
export function extractEmbeddingsJs(analets: Analet[]): {
  embeddings: number[][];
  validAnalets: Analet[];
} {
  // Filter out analets with invalid embeddings, but log a warning with IDs
  const validAnalets = analets.filter(analet => Array.isArray(analet.embedding) && analet.embedding.length > 0);
  const invalidAnalets = analets.filter(analet => !analet.embedding || analet.embedding.length === 0);
  if (invalidAnalets.length > 0) {
    console.warn(`⚠️ [UMAP-JS Utils] Skipping ${invalidAnalets.length} analets with missing embeddings. IDs: ${invalidAnalets.map(a => a.id).join(', ')}`);
  }

  const embeddings = validAnalets.map(analet => analet.embedding!);
  return { embeddings, validAnalets };
}

/**
 * Validate embeddings array
 */
export function validateEmbeddingsJs(embeddings: number[][]): boolean {
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
 * Create and configure UMAP-JS instance
 */
export function createUMAPJs(params: UMAPJsParameters = {}): UMAPJs {
  const umapParams = {
    nNeighbors: params.nNeighbors || 3,
    minDist: params.minDist || 0.1,
    spread: params.spread || 1,
    nComponents: 2,
    nEpochs: params.nEpochs || 200,
    randomSeed: params.randomSeed || 42
  };
  // Seed the random number generator for deterministic results
  const seed = umapParams.randomSeed;

  // Create a seedable random number generator (mulberry32)
  let a = seed;
  const seededRandom = () => {
    a |= 0;
    a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };

  // Create umap-js instance with fixed seed
  const umap = new UMAPJs({
    nNeighbors: umapParams.nNeighbors,
    minDist: umapParams.minDist,
    spread: umapParams.spread,
    nComponents: umapParams.nComponents,
    nEpochs: umapParams.nEpochs,
    random: seededRandom
  });
  return umap;
}

/**
 * Project embeddings to 2D using UMAP-JS
 */
export function projectEmbeddingsJs(
  embeddings: number[][],
  _validAnalets: Analet[],
  _dimensions: UMAPJsDimensions,
  params: UMAPJsParameters = {},
  _constraintService?: ConstraintService
): number[][] {

  if (!validateEmbeddingsJs(embeddings)) {
    throw new Error('Invalid embeddings provided');
  }

  // Performance timing disabled for now
  // const startTime = performance.now();
  const umap = createUMAPJs(params);

  // Note: umap-js doesn't support constraints like our custom implementation
  // If constraints are needed, they would need to be applied post-processing

  // Fit and transform the embeddings - THIS IS WHERE THE RE-PROJECTION HAPPENS

  const result = umap.fit(embeddings);

  // const endTime = performance.now();
  return result;
}

/**
 * Compute normalization outputs and bounds from raw projected coordinates
 */
function computeNormalizationJs(
  projectedData: number[][],
  dimensions: UMAPJsDimensions
): { normalizedResults: UMAPJsResult[]; bounds: { minX: number; maxX: number; minY: number; maxY: number; scale: number; offsetX: number; offsetY: number } } {
  const { width, height, padding = 20 } = dimensions;
  const targetWidth = width - 2 * padding;
  const targetHeight = height - 2 * padding;

  const xs = projectedData.map(point => point[0]);
  const ys = projectedData.map(point => point[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const rangeX = maxX - minX || 1;
  const rangeY = maxY - minY || 1;
  const scale = Math.min(targetWidth / rangeX, targetHeight / rangeY);
  const scaledWidth = rangeX * scale;
  const scaledHeight = rangeY * scale;
  const offsetX = (targetWidth - scaledWidth) / 2;
  const offsetY = (targetHeight - scaledHeight) / 2;

  const normalizedResults = projectedData.map(point => ({
    x: padding + offsetX + ((point[0] - minX) * scale),
    y: padding + offsetY + ((point[1] - minY) * scale)
  }));

  return { normalizedResults, bounds: { minX, maxX, minY, maxY, scale, offsetX, offsetY } };
}

/**
 * Normalize using previously computed bounds (for out-of-sample points)
 */
function normalizeUsingBoundsJs(
  projectedData: number[][],
  dimensions: UMAPJsDimensions,
  bounds: { minX: number; maxX: number; minY: number; maxY: number; scale: number; offsetX: number; offsetY: number }
): UMAPJsResult[] {
  const { padding = 20 } = dimensions;
  const { minX, minY, scale, offsetX, offsetY } = bounds;
  return projectedData.map(point => ({
    x: padding + offsetX + ((point[0] - minX) * scale),
    y: padding + offsetY + ((point[1] - minY) * scale)
  }));
}

/**
 * Handle edge cases for small datasets
 */
export function handleSmallDatasetJs(
  count: number,
  dimensions: UMAPJsDimensions
): UMAPJsResult[] {
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
  return createGridLayoutJs(count, dimensions);
}

/**
 * Create grid layout as fallback
 */
export function createGridLayoutJs(
  count: number,
  dimensions: UMAPJsDimensions
): UMAPJsResult[] {
  const { width, height, padding = 20 } = dimensions;
  const availableWidth = width - 2 * padding;
  const availableHeight = height - 2 * padding;

  const cols = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);

  const cellWidth = availableWidth / cols;
  const cellHeight = availableHeight / rows;

  const results: UMAPJsResult[] = [];

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
export function applyConstraintsToResultsJs(
  results: UMAPJsResult[],
  validAnalets: Analet[],
  constraintService?: ConstraintService
): UMAPJsResult[] {
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
 * Normalize projected coordinates to target dimensions
 */
function normalizeCoordinatesJs(
  projectedData: number[][],
  dimensions: UMAPJsDimensions
): UMAPJsResult[] {
  if (projectedData.length === 0) {
    return [];
  }

  return computeNormalizationJs(projectedData, dimensions).normalizedResults;
}

/**
 * Main UMAP-JS projection function
 */
export function runUMAPJsProjection(
  analets: Analet[],
  options: UMAPJsProjectionOptions
): { results: UMAPJsResult[]; validAnalets: Analet[] } {

  const { dimensions, params = {}, constraintService } = options;

  if (analets.length === 0) {
    return { results: [], validAnalets: [] };
  }

  const { embeddings, validAnalets } = extractEmbeddingsJs(analets);


  if (validAnalets.length === 0) {
    console.warn('⚠️ [UMAP-JS Utils] No valid embeddings found');
    return { results: [], validAnalets: [] };
  }

  // Handle small datasets with special cases
  if (validAnalets.length <= 2) {
    const results = handleSmallDatasetJs(validAnalets.length, dimensions);
    const constrainedResults = applyConstraintsToResultsJs(results, validAnalets, constraintService);

    return { results: constrainedResults, validAnalets };
  }

  try {
    // Project embeddings using UMAP-JS - THIS IS THE CRITICAL STEP THAT CAUSES RE-LAYOUT
    const projectedData = projectEmbeddingsJs(embeddings, validAnalets, dimensions, params, constraintService);
    // Normalize to target dimensions
    const normalizedResults = normalizeCoordinatesJs(projectedData, dimensions);
    // Apply any constraint overrides (ensures constraint positions are exactly preserved)
    const results = applyConstraintsToResultsJs(normalizedResults, validAnalets, constraintService);
    return { results, validAnalets };

  } catch (error) {
    console.error('❌ [UMAP-JS Utils] Projection failed, falling back to grid layout:', error);
    const results = createGridLayoutJs(validAnalets.length, dimensions);
    const constrainedResults = applyConstraintsToResultsJs(results, validAnalets, constraintService);
    return { results: constrainedResults, validAnalets };
  }
}

/**
 * Fit once and return a persisted model that supports out-of-sample transforms,
 * along with normalized results for the current dataset.
 */
export function fitAndCreateModel(
  analets: Analet[],
  options: UMAPJsProjectionOptions
): { model: FittedUmapModel; results: UMAPJsResult[]; validAnalets: Analet[] } {

  const { dimensions, params = {}, constraintService } = options;
  const { embeddings, validAnalets } = extractEmbeddingsJs(analets);
  if (validAnalets.length === 0) {
    return {
      model: {
        umap: createUMAPJs(params),
        bounds: { minX: 0, maxX: 1, minY: 0, maxY: 1, scale: 1, offsetX: 0, offsetY: 0 },
        dimensions,
        transform: (_e: number[][]) => [],
        normalize: (_p: number[][]) => []
      },
      results: [],
      validAnalets: []
    };
  }

  // Handle tiny datasets
  if (validAnalets.length <= 2) {
    const results = handleSmallDatasetJs(validAnalets.length, dimensions);
    const constrainedResults = applyConstraintsToResultsJs(results, validAnalets, constraintService);
    const dummy = createUMAPJs(params);
    const model: FittedUmapModel = {
      umap: dummy,
      bounds: { minX: 0, maxX: 1, minY: 0, maxY: 1, scale: 1, offsetX: 0, offsetY: 0 },
      dimensions,
      transform: (_e) => [],
      normalize: (_p) => []
    };
    return { model, results: constrainedResults, validAnalets };
  }
  const umap = createUMAPJs(params);
  const projectedData = umap.fit(embeddings);
  const { normalizedResults, bounds } = computeNormalizationJs(projectedData, dimensions);
  const results = applyConstraintsToResultsJs(normalizedResults, validAnalets, constraintService);

  const model: FittedUmapModel = {
    umap,
    bounds,
    dimensions,
    transform: (newEmbeddings: number[][]) => umap.transform(newEmbeddings),
    normalize: (points: number[][]) => normalizeUsingBoundsJs(points, dimensions, bounds)
  };

  return { model, results, validAnalets };
}
