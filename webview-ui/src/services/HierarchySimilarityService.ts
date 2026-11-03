import { TreeNode } from './HierarchyService';
import { Analet } from '../types/analet';

export interface HierarchySimilarityResult {
  analet: Analet;
  similarity: number;
  reason: string;
}

export interface HierarchyContext {
  path: string[];
  depth: number;
  parent?: TreeNode;
  siblings: TreeNode[];
  ancestors: TreeNode[];
  ordinalDistances: OrdinalDistance[];
}

export interface OrdinalDistance {
  targetId: string;
  targetTitle: string;
  targetKind: 'analet' | 'bearing' | 'note';
  distance: number;
  relationship: 'sibling' | 'ancestor' | 'descendant';
  description: string; // e.g., "1 level from analet <topic>", "same level as xyz"
}

export class HierarchySimilarityService {
  private static instance: HierarchySimilarityService;

  public static getInstance(): HierarchySimilarityService {
    if (!HierarchySimilarityService.instance) {
      HierarchySimilarityService.instance = new HierarchySimilarityService();
    }
    return HierarchySimilarityService.instance;
  }

  /**
   * Find analets similar to the current hierarchy position
   */
  public findSimilarAnalets(
    context: HierarchyContext,
    allAnalets: Analet[],
    maxResults: number = 5
  ): HierarchySimilarityResult[] {
    const results: HierarchySimilarityResult[] = [];

    for (const analet of allAnalets) {
      const similarity = this.calculateSimilarity(analet, context);
      if (similarity > 0) {
        results.push({
          analet,
          similarity,
          reason: this.getSimilarityReason(analet, context)
        });
      }
    }

    return results
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, maxResults);
  }

  /**
   * Calculate structural similarity between an analet and hierarchy context
   */
  private calculateSimilarity(analet: Analet, context: HierarchyContext): number {
    let similarity = 0;

    // 1. Parent similarity (40% weight)
    if (context.parent) {
      const parentSimilarity = this.calculateParentSimilarity(analet, context.parent);
      similarity += parentSimilarity * 0.4;
    }

    // 2. Sibling similarity (30% weight)
    const siblingSimilarity = this.calculateSiblingSimilarity(analet, context.siblings);
    similarity += siblingSimilarity * 0.3;

    // 3. Depth similarity (20% weight)
    const depthSimilarity = this.calculateDepthSimilarity(analet, context.depth);
    similarity += depthSimilarity * 0.2;

    // 4. Ancestor similarity (10% weight)
    const ancestorSimilarity = this.calculateAncestorSimilarity(analet, context.ancestors);
    similarity += ancestorSimilarity * 0.1;

    return Math.min(similarity, 1.0);
  }

  /**
   * Calculate similarity based on parent context
   */
  private calculateParentSimilarity(analet: Analet, parent: TreeNode): number {
    if (parent.kind === 'bearing' && parent.data) {
      const bearing = parent.data as any;
      
      // Check if analet belongs to this bearing (using tags or other indicators)
      // For now, we'll use tag similarity as a proxy for bearing membership
      const bearingTags = bearing.tags || [];
      const analetTags = analet.tags || [];
      const commonTags = bearingTags.filter((tag: string) => analetTags.includes(tag));
      
      if (bearingTags.length > 0) {
        return commonTags.length / bearingTags.length;
      }
    }

    if (parent.kind === 'analet' && parent.data) {
      const parentAnalet = parent.data as Analet;
      
      // Check for derivation relationship
      if (analet.parentAnaletId === parentAnalet.id) {
        return 1.0;
      }

      // Check statement similarity
      return this.calculateTextSimilarity(analet.statement, parentAnalet.statement);
    }

    return 0;
  }

  /**
   * Calculate similarity based on sibling context
   */
  private calculateSiblingSimilarity(analet: Analet, siblings: TreeNode[]): number {
    if (siblings.length === 0) return 0.5; // Neutral score for no siblings

    let totalSimilarity = 0;
    let validSiblings = 0;

    for (const sibling of siblings) {
      if (sibling.kind === 'analet' && sibling.data) {
        const siblingAnalet = sibling.data as Analet;
        
        // Check tag similarity
        const analetTags = analet.tags || [];
        const siblingTags = siblingAnalet.tags || [];
        const commonTags = analetTags.filter(tag => siblingTags.includes(tag));
        
        let tagSimilarity = 0;
        if (analetTags.length > 0 && siblingTags.length > 0) {
          tagSimilarity = commonTags.length / Math.max(analetTags.length, siblingTags.length);
        }

        // Check statement similarity
        const statementSimilarity = this.calculateTextSimilarity(analet.statement, siblingAnalet.statement);

        totalSimilarity += (tagSimilarity + statementSimilarity) / 2;
        validSiblings++;
      }
    }

    return validSiblings > 0 ? totalSimilarity / validSiblings : 0;
  }

  /**
   * Calculate similarity based on hierarchy depth
   */
  private calculateDepthSimilarity(_analet: Analet, _targetDepth: number): number {
    // For now, assume all analets are at similar depths
    // This could be enhanced with actual depth tracking
    return 0.8; // High similarity for depth
  }

  /**
   * Calculate similarity based on ancestor context
   */
  private calculateAncestorSimilarity(analet: Analet, ancestors: TreeNode[]): number {
    if (ancestors.length === 0) return 0.5;

    let totalSimilarity = 0;
    let validAncestors = 0;

    for (const ancestor of ancestors) {
      if (ancestor.kind === 'bearing' && ancestor.data) {
        const bearing = ancestor.data as any;
        
        // Check tag similarity with ancestor bearing
        const bearingTags = bearing.tags || [];
        const analetTags = analet.tags || [];
        const commonTags = bearingTags.filter((tag: string) => analetTags.includes(tag));
        
        if (bearingTags.length > 0) {
          totalSimilarity += commonTags.length / bearingTags.length;
        }
        validAncestors++;
      }
    }

    return validAncestors > 0 ? totalSimilarity / validAncestors : 0;
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
   * Get human-readable reason for similarity
   */
  private getSimilarityReason(analet: Analet, context: HierarchyContext): string {
    const reasons: string[] = [];

    if (context.parent?.kind === 'bearing' && context.parent.data) {
      const bearing = context.parent.data as any;
      const bearingTags = bearing.tags || [];
      const analetTags = analet.tags || [];
      const commonTags = bearingTags.filter((tag: string) => analetTags.includes(tag));
      
      if (commonTags.length > 0) {
        reasons.push('shares tags with parent bearing');
      }
    }

    if (context.parent?.kind === 'analet' && context.parent.data) {
      const parentAnalet = context.parent.data as Analet;
      if (analet.parentAnaletId === parentAnalet.id) {
        reasons.push('derived from parent');
      }
    }

    const analetTags = analet.tags || [];
    const siblingTags = context.siblings
      .filter(s => s.kind === 'analet' && s.data)
      .flatMap(s => (s.data as Analet).tags || []);
    
    const commonTags = analetTags.filter(tag => siblingTags.includes(tag));
    if (commonTags.length > 0) {
      reasons.push(`shares tags: ${commonTags.join(', ')}`);
    }

    if (reasons.length === 0) {
      reasons.push('structural similarity');
    }

    return reasons.join(', ');
  }

  /**
   * Calculate ordinal distances for a given hierarchy position
   * Only includes same-level siblings and direct lineage (ancestors up to root)
   */
  public calculateOrdinalDistances(
    currentPath: string[],
    _currentDepth: number,
    siblings: TreeNode[],
    ancestors: TreeNode[]
  ): OrdinalDistance[] {
    const distances: OrdinalDistance[] = [];

    // Add same-level siblings
    siblings.forEach((sibling) => {
      if (sibling.id !== currentPath[currentPath.length - 1]) {
        // For analets, use the statement instead of title to get the actual analysis idea
        const displayTitle = sibling.kind === 'analet' && sibling.data?.statement 
          ? sibling.data.statement 
          : sibling.title;
        
        distances.push({
          targetId: sibling.id,
          targetTitle: displayTitle,
          targetKind: sibling.kind === 'folder' ? 'analet' : sibling.kind as 'analet' | 'bearing' | 'note',
          distance: 0, // Same level
          relationship: 'sibling',
          description: `same level as ${sibling.kind} "${displayTitle}"`
        });
      }
    });

    // Add ancestors (direct lineage up to root)
    ancestors.forEach((ancestor, index) => {
      const distance = index + 1; // 1 level up, 2 levels up, etc.
      
      // For analets, use the statement instead of title to get the actual analysis idea
      const displayTitle = ancestor.kind === 'analet' && ancestor.data?.statement 
        ? ancestor.data.statement 
        : ancestor.title;
      
      distances.push({
        targetId: ancestor.id,
        targetTitle: displayTitle,
        targetKind: ancestor.kind === 'folder' ? 'analet' : ancestor.kind as 'analet' | 'bearing' | 'note',
        distance,
        relationship: 'ancestor',
        description: `${distance} level${distance > 1 ? 's' : ''} from ${ancestor.kind} "${displayTitle}"`
      });
    });

    return distances;
  }

  /**
   * Generate a preview idea based on hierarchy context using ordinal distances
   */
  public async generateHierarchyPreview(
    context: HierarchyContext,
    _similarAnalets: Analet[]
  ): Promise<string> {
    // For now, return a simple placeholder that will be replaced by the LLM-generated shortName
    // when the actual analet is created. The preview should just indicate the position.
    const siblings = context.ordinalDistances.filter(d => d.relationship === 'sibling');
    const ancestors = context.ordinalDistances.filter(d => d.relationship === 'ancestor');
    
    if (ancestors.length > 0 && siblings.length > 0) {
      return 'New Analysis';
    } else if (ancestors.length > 0) {
      return 'Extension';
    } else if (siblings.length > 0) {
      return 'Comparison';
    } else {
      return 'New Analysis';
    }
  }

  /**
   * Compute hybrid similarity between two analets using cosine(text) and jaccard(variables)
   */
  public computeAnaletSimilarity(a: Analet, b: Analet): { cosine: number; jaccard: number; score: number } {
    const textA = `${a.cellQL || ''} ${a.semantic_hints_text || ''}`;
    const textB = `${b.cellQL || ''} ${b.semantic_hints_text || ''}`;
    const cosine = this.cosineSimilarity(textA, textB);

    const varsA = new Set<string>(Array.isArray(a.variables_used) ? a.variables_used.map((x: string) => String(x).toLowerCase()) : []);
    const varsB = new Set<string>(Array.isArray(b.variables_used) ? b.variables_used.map((x: string) => String(x).toLowerCase()) : []);
    const jaccard = this.jaccardIndex(varsA, varsB);

    const alpha = this.getAlpha();
    const score = alpha * cosine + (1 - alpha) * jaccard;
    return { cosine, jaccard, score };
  }

  public findSimilarAnaletsById(targetId: number, allAnalets: Analet[], k: number = 10): Array<{ id: number; cosine: number; jaccard: number; score: number; title: string; snippet: string }>{
    const target = allAnalets.find(a => a.id === targetId);
    if (!target) return [];
    const ranked = allAnalets
      .filter(a => a.id !== targetId)
      .map(a => {
        const { cosine, jaccard, score } = this.computeAnaletSimilarity(target, a);
        return {
          id: a.id,
          cosine,
          jaccard,
          score,
          title: a.shortName || a.statement.slice(0, 80),
          snippet: (a.cellQL || '').slice(0, 160)
        };
      })
      .sort((x, y) => y.score - x.score)
      .slice(0, k);
    return ranked;
  }

  private cosineSimilarity(textA: string, textB: string): number {
    const tfA = this.termFreq(textA);
    const tfB = this.termFreq(textB);
    const vocab = new Set<string>([...Object.keys(tfA), ...Object.keys(tfB)]);
    let dot = 0, normA = 0, normB = 0;
    for (const t of vocab) {
      const a = tfA[t] || 0;
      const b = tfB[t] || 0;
      dot += a * b;
      normA += a * a;
      normB += b * b;
    }
    if (normA === 0 || normB === 0) return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  private termFreq(text: string): Record<string, number> {
    const tf: Record<string, number> = {};
    const tokens = (text || '').toLowerCase().match(/[a-z0-9_]+/g) || [];
    for (const tok of tokens) tf[tok] = (tf[tok] || 0) + 1;
    return tf;
  }

  private jaccardIndex(a: Set<string>, b: Set<string>): number {
    if (a.size === 0 && b.size === 0) return 0;
    let inter = 0;
    for (const v of a) if (b.has(v)) inter++;
    const union = new Set([...a, ...b]).size;
    return union === 0 ? 0 : inter / union;
  }

  private getAlpha(): number {
    try {
      const raw = window.localStorage.getItem('similarity_alpha');
      const val = raw ? parseFloat(raw) : 0.5;
      return Number.isNaN(val) ? 0.5 : Math.min(1, Math.max(0, val));
    } catch {
      return 0.5;
    }
  }
}
