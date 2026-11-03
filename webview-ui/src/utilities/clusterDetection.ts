import { Analet } from '../types/analet';

export interface ClusterPoint {
  x: number;
  y: number;
  analet: Analet;
}

export interface DetectedCluster {
  id: string;
  points: ClusterPoint[];
  center: { x: number; y: number };
  radius: number;
  suggestedName?: string;
}

/**
 * Simple DBSCAN-like clustering for detecting analet clusters
 */
export function detectClusters(
  analets: Analet[],
  minClusterSize: number = 3,
  maxDistance: number = 80
): DetectedCluster[] {
  const points: ClusterPoint[] = analets.map(analet => ({
    x: analet.location?.x || 0,
    y: analet.location?.y || 0,
    analet
  }));

  const visited = new Set<number>();
  const clusters: DetectedCluster[] = [];
  let clusterId = 0;

  for (let i = 0; i < points.length; i++) {
    if (visited.has(i)) continue;

    const neighbors = getNeighbors(points, i, maxDistance);
    
    if (neighbors.length >= minClusterSize - 1) { // -1 because neighbors doesn't include the point itself
      // Start a new cluster
      const cluster: ClusterPoint[] = [];
      const queue = [i];
      
      while (queue.length > 0) {
        const currentIdx = queue.pop()!;
        if (visited.has(currentIdx)) continue;
        
        visited.add(currentIdx);
        cluster.push(points[currentIdx]);
        
        const currentNeighbors = getNeighbors(points, currentIdx, maxDistance);
        for (const neighborIdx of currentNeighbors) {
          if (!visited.has(neighborIdx)) {
            queue.push(neighborIdx);
          }
        }
      }
      
      if (cluster.length >= minClusterSize) {
        const center = calculateClusterCenter(cluster);
        const radius = calculateClusterRadius(cluster, center);
        
        clusters.push({
          id: `cluster-${clusterId++}`,
          points: cluster,
          center,
          radius: Math.max(radius, 30), // Minimum radius for visibility
          suggestedName: generateClusterName(cluster.map(p => p.analet))
        });
      }
    }
  }
  // post-processing step retained for future metrics (no-op)

  return clusters;
}

/**
 * Find neighbors within distance threshold
 */
function getNeighbors(points: ClusterPoint[], centerIdx: number, maxDistance: number): number[] {
  const center = points[centerIdx];
  const neighbors: number[] = [];
  
  for (let i = 0; i < points.length; i++) {
    if (i === centerIdx) continue;
    
    const distance = Math.sqrt(
      Math.pow(points[i].x - center.x, 2) + 
      Math.pow(points[i].y - center.y, 2)
    );
    
    if (distance <= maxDistance) {
      neighbors.push(i);
    }
  }
  
  return neighbors;
}

/**
 * Calculate the center point of a cluster
 */
function calculateClusterCenter(cluster: ClusterPoint[]): { x: number; y: number } {
  const sumX = cluster.reduce((sum, point) => sum + point.x, 0);
  const sumY = cluster.reduce((sum, point) => sum + point.y, 0);
  
  return {
    x: sumX / cluster.length,
    y: sumY / cluster.length
  };
}

/**
 * Calculate the radius needed to encompass all points in the cluster
 */
function calculateClusterRadius(cluster: ClusterPoint[], center: { x: number; y: number }): number {
  let maxDistance = 0;
  
  for (const point of cluster) {
    const distance = Math.sqrt(
      Math.pow(point.x - center.x, 2) + 
      Math.pow(point.y - center.y, 2)
    );
    maxDistance = Math.max(maxDistance, distance);
  }
  
  return maxDistance + 15; // Add padding
}

/**
 * Generate a suggested name for the cluster based on common themes
 */
function generateClusterName(analets: Analet[]): string {
  
  // Extract all meaningful terms from questions, explanations, and formalisms
  const allText = analets.map(a => `${a.statement} ${a.explanation} ${a.cellQL}`).join(' ').toLowerCase();
  
  
  // Enhanced keyword detection with scoring
  const keywordCategories = {
    'Statistical Analysis': {
      keywords: ['average', 'mean', 'median', 'standard deviation', 'variance', 'distribution', 'normal', 'statistics', 'statistical'],
      weight: 3
    },
    'Trend Analysis': {
      keywords: ['trend', 'pattern', 'time series', 'seasonal', 'growth', 'decline', 'change over time', 'temporal'],
      weight: 3
    },
    'Comparison Study': {
      keywords: ['compare', 'comparison', 'versus', 'vs', 'difference', 'contrast', 'relative', 'between'],
      weight: 2
    },
    'Data Quality': {
      keywords: ['outlier', 'anomaly', 'missing', 'null', 'clean', 'quality', 'validation', 'duplicate'],
      weight: 2
    },
    'Performance Metrics': {
      keywords: ['performance', 'kpi', 'metric', 'score', 'rating', 'efficiency', 'effectiveness'],
      weight: 2
    },
    'Customer Analysis': {
      keywords: ['customer', 'client', 'user', 'segment', 'persona', 'behavior', 'satisfaction'],
      weight: 2
    },
    'Sales & Revenue': {
      keywords: ['sales', 'revenue', 'profit', 'income', 'earnings', 'financial', 'commercial'],
      weight: 2
    },
    'Product Analysis': {
      keywords: ['product', 'item', 'category', 'brand', 'inventory', 'catalog'],
      weight: 2
    },
    'Geographic Study': {
      keywords: ['geographic', 'location', 'region', 'city', 'country', 'spatial', 'map'],
      weight: 2
    },
    'Count & Frequency': {
      keywords: ['count', 'frequency', 'number', 'total', 'sum', 'quantity'],
      weight: 1
    }
  };
  
  // Score each category
  const categoryScores: { [key: string]: number } = {};
  
  Object.entries(keywordCategories).forEach(([category, config]) => {
    let score = 0;
    config.keywords.forEach(keyword => {
      const regex = new RegExp(`\\b${keyword}\\b`, 'gi');
      const matches = allText.match(regex) || [];
      score += matches.length * config.weight;
    });
    
    if (score > 0) {
      categoryScores[category] = score;
    }
  });
  
  // Find best category
  const bestCategory = Object.entries(categoryScores)
    .sort(([,a], [,b]) => b - a)[0];
  
  if (bestCategory && bestCategory[1] >= analets.length) {
    return bestCategory[0];
  }
  
  // Look for common domain-specific terms
  const domainTerms = {
    'Diamond Analysis': ['diamond', 'carat', 'clarity', 'cut', 'color'],
    'Price Analysis': ['price', 'cost', 'expensive', 'cheap', 'value'],
    'Size Analysis': ['size', 'large', 'small', 'dimension', 'measurement'],
    'Quality Analysis': ['quality', 'grade', 'rating', 'premium', 'excellent'],
    'Correlation Study': ['correlation', 'relationship', 'association', 'connected'],
    'Filter Analysis': ['filter', 'subset', 'condition', 'criteria', 'where']
  };
  
  for (const [termName, terms] of Object.entries(domainTerms)) {
    const matchCount = terms.reduce((count, term) => {
      const regex = new RegExp(`\\b${term}\\b`, 'gi');
      return count + (allText.match(regex) || []).length;
    }, 0);
    
    if (matchCount >= analets.length * 0.6) {
      return termName;
    }
  }
  
  // Extract common noun phrases (simple approach)
  const commonNouns = extractCommonNouns(allText);
  if (commonNouns.length > 0) {
    const topNoun = commonNouns[0];
    if (topNoun.count >= analets.length * 0.7) {
      const capitalizedNoun = topNoun.word.charAt(0).toUpperCase() + topNoun.word.slice(1);
      return `${capitalizedNoun} Analysis`;
    }
  }
  
  // Fallback with size indication
  const fallbackName = analets.length >= 5 ? 'Major Analysis Group' : 
                      analets.length >= 3 ? 'Analysis Cluster' : 
                      'Small Analysis Group';
  return fallbackName;
}

/**
 * Extract common meaningful nouns from text
 */
function extractCommonNouns(text: string): { word: string; count: number }[] {
  // Simple noun extraction - look for words that appear frequently
  const words = text.toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 3); // Filter short words
  
  // Count word frequencies
  const wordCounts: { [key: string]: number } = {};
  words.forEach(word => {
    wordCounts[word] = (wordCounts[word] || 0) + 1;
  });
  
  // Filter out common stop words and get top nouns
  const stopWords = new Set(['this', 'that', 'with', 'have', 'will', 'from', 'they', 'been', 'were', 'said', 'each', 'which', 'their', 'what', 'would', 'there', 'could', 'more', 'very', 'what', 'know', 'just', 'first', 'into', 'over', 'think', 'also', 'your', 'work', 'life', 'only', 'can', 'still', 'should', 'after', 'being', 'now', 'made', 'before', 'here', 'through', 'when', 'where', 'much', 'take', 'than', 'only', 'come', 'its']);
  
  return Object.entries(wordCounts)
    .filter(([word]) => !stopWords.has(word))
    .map(([word, count]) => ({ word, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5); // Top 5 words
}

/**
 * Check if two clusters overlap significantly
 */
export function clustersOverlap(cluster1: DetectedCluster, cluster2: DetectedCluster): boolean {
  const distance = Math.sqrt(
    Math.pow(cluster1.center.x - cluster2.center.x, 2) + 
    Math.pow(cluster1.center.y - cluster2.center.y, 2)
  );
  
  return distance < (cluster1.radius + cluster2.radius) * 0.7; // 70% overlap threshold
}

/**
 * Filter out overlapping clusters, keeping the larger ones
 */
export function filterOverlappingClusters(clusters: DetectedCluster[]): DetectedCluster[] {
  const filteredClusters: DetectedCluster[] = [];
  const sortedClusters = [...clusters].sort((a, b) => b.points.length - a.points.length);
  
  for (const cluster of sortedClusters) {
    const hasOverlap = filteredClusters.some(existing => clustersOverlap(cluster, existing));
    if (!hasOverlap) {
      filteredClusters.push(cluster);
    }
  }
  return filteredClusters;
}