/**
 * Configuration types for Meridian application settings
 */

export interface UMAPConfig {
  implementation: 'custom' | 'umap-js';
  nNeighbors?: number;
  minDist?: number;
  spread?: number;
  nEpochs?: number;
  learningRate?: number;
  randomSeed?: number;
}

export interface TelemetryConfig {
  rrwebEnabled: boolean;
  maskAllInputs?: boolean;
}

export interface UIConfig {
  gridLayout: boolean;
  viewMode: 'full' | 'map' | 'canvas' | 'tree';
}

export interface MeridianConfig {
  umap: UMAPConfig;
  telemetry?: TelemetryConfig;
  ui?: UIConfig;
}

export const DEFAULT_CONFIG: MeridianConfig = {
  umap: {
    implementation: 'umap-js', // Default to UMAP-JS implementation
    nNeighbors: 5,
    minDist: 0.1,
    spread: 1,
    nEpochs: 200,
    learningRate: 1.0,
    randomSeed: 42
  },
  telemetry: {
    rrwebEnabled: false,
    maskAllInputs: true
  },
  ui: {
    gridLayout: false,
    viewMode: 'full'
  }
};