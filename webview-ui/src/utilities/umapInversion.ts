import { Analet } from '../types/analet';

interface Point2D {
  x: number;
  y: number;
}

interface EmbeddingPoint {
  embedding: number[];
  position: Point2D;
}

/**
 * UMAP Inversion Utility
 * Converts 2D map coordinates back to high-dimensional embeddings
 * using nearest neighbor interpolation
 */
export class UMAPInversion {
  private embeddingPoints: EmbeddingPoint[] = [];
  private embeddingDimension: number = 0;

  constructor(analets: Analet[]) {
    this.updateAnalets(analets);
  }

  /**
   * Update the analet data for inversion
   */
  updateAnalets(analets: Analet[]): void {
    this.embeddingPoints = analets
      .filter(analet => analet.embedding && analet.embedding.length > 0 && analet.location)
      .map(analet => ({
        embedding: analet.embedding!,
        position: { x: analet.location!.x, y: analet.location!.y }
      }));

    if (this.embeddingPoints.length > 0) {
      this.embeddingDimension = this.embeddingPoints[0].embedding.length;
    }
  }

  /**
   * Convert 2D map coordinates to high-dimensional embedding
   * using weighted nearest neighbor interpolation
   */
  invertPosition(x: number, y: number, k: number = 5): number[] | null {
    if (this.embeddingPoints.length === 0 || this.embeddingDimension === 0) {
      return null;
    }

    const targetPoint = { x, y };
    // Calculate distances to all known points
    const distances = this.embeddingPoints.map(point => ({
      point,
      distance: this.euclideanDistance(targetPoint, point.position)
    }));

    // Sort by distance and take k nearest neighbors
    const nearestNeighbors = distances
      .sort((a, b) => a.distance - b.distance)
      .slice(0, Math.min(k, distances.length));
    // Handle exact match
    if (nearestNeighbors[0].distance === 0) {
      return [...nearestNeighbors[0].point.embedding];
    }

    // Calculate weights using inverse distance weighting
    const weights = nearestNeighbors.map(neighbor => {
      const distance = Math.max(neighbor.distance, 0.001); // Avoid division by zero
      return 1 / (distance * distance); // Inverse squared distance
    });

    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
    const normalizedWeights = weights.map(weight => weight / totalWeight);
    // Interpolate embedding values
    const interpolatedEmbedding = new Array(this.embeddingDimension).fill(0);
    
    for (let dim = 0; dim < this.embeddingDimension; dim++) {
      interpolatedEmbedding[dim] = nearestNeighbors.reduce((sum, neighbor, index) => {
        return sum + neighbor.point.embedding[dim] * normalizedWeights[index];
      }, 0);
    }
    return interpolatedEmbedding;
  }

  /**
   * Get the embedding dimension
   */
  getEmbeddingDimension(): number {
    return this.embeddingDimension;
  }

  /**
   * Get information about the current inversion state
   */
  getInversionInfo(): {
    numPoints: number;
    embeddingDimension: number;
    averageSpacing: number;
  } {
    if (this.embeddingPoints.length < 2) {
      return {
        numPoints: this.embeddingPoints.length,
        embeddingDimension: this.embeddingDimension,
        averageSpacing: 0
      };
    }

    // Calculate average spacing between points for quality assessment
    let totalDistance = 0;
    let pairCount = 0;

    for (let i = 0; i < this.embeddingPoints.length; i++) {
      for (let j = i + 1; j < Math.min(i + 5, this.embeddingPoints.length); j++) {
        totalDistance += this.euclideanDistance(
          this.embeddingPoints[i].position,
          this.embeddingPoints[j].position
        );
        pairCount++;
      }
    }

    return {
      numPoints: this.embeddingPoints.length,
      embeddingDimension: this.embeddingDimension,
      averageSpacing: pairCount > 0 ? totalDistance / pairCount : 0
    };
  }

  /**
   * Calculate Euclidean distance between two 2D points
   */
  private euclideanDistance(p1: Point2D, p2: Point2D): number {
    const dx = p1.x - p2.x;
    const dy = p1.y - p2.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /**
   * Estimate the quality of inversion at a given point
   * Returns a value between 0 (poor) and 1 (excellent)
   */
  estimateInversionQuality(x: number, y: number, k: number = 5): number {
    if (this.embeddingPoints.length < k) {
      return this.embeddingPoints.length / k;
    }

    const targetPoint = { x, y };
    const distances = this.embeddingPoints.map(point => 
      this.euclideanDistance(targetPoint, point.position)
    );

    distances.sort((a, b) => a - b);
    const nearestK = distances.slice(0, k);
    const maxDistance = nearestK[nearestK.length - 1];
    const avgDistance = nearestK.reduce((sum, d) => sum + d, 0) / k;

    // Quality is better when nearest neighbors are closer and more evenly distributed
    const evenness = 1 - (maxDistance - nearestK[0]) / (maxDistance + 0.001);
    const proximity = Math.exp(-avgDistance / 50); // Assumes reasonable map scale

    return (evenness + proximity) / 2;
  }
}

/**
 * Factory function to create a UMAP inversion instance
 */
export function createUMAPInversion(analets: Analet[]): UMAPInversion {
  return new UMAPInversion(analets);
} 