import { Analet } from '../types/analet';
import { DetectedCluster } from './clusterDetection';

export interface LabelPosition {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ForceNode {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fixed: boolean;
  type: 'analet' | 'cluster' | 'analet-label';
  priority: number; // Higher priority = more important
  targetX?: number; // For anchoring labels to their analets/clusters
  targetY?: number;
  anchorDistance?: number; // Preferred distance from anchor
}

/**
 * Force-directed layout for positioning labels without overlap
 * Uses a physics simulation to position labels optimally
 */
export function forceDirectedLabeling(
  analets: Analet[],
  clusters: DetectedCluster[],
  analetLabels: Map<number, string>,
  clusterLabels: Map<string, string>,
  maxDistance: number = 30
): {
  analetLabelPositions: Map<number, LabelPosition>;
  clusterLabelPositions: Map<string, LabelPosition>;
} {
  // Create force nodes
  const nodes: ForceNode[] = [];
  
  // 1. Add analet nodes (highest priority, fixed positions)
  analets.forEach(analet => {
    const x = analet.location?.x || 0;
    const y = analet.location?.y || 0;
    const radius = 8; // Unified radius for all analets
    
    nodes.push({
      id: `analet-${analet.id}`,
      x,
      y,
      width: radius * 2,
      height: radius * 2,
      fixed: true,
      type: 'analet',
      priority: 100
    });
  });
  
  // 2. Add cluster nodes (high priority, fixed positions)
  clusters.forEach(cluster => {
    nodes.push({
      id: `cluster-${cluster.id}`,
      x: cluster.center.x,
      y: cluster.center.y,
      width: cluster.radius * 2,
      height: cluster.radius * 2,
      fixed: true,
      type: 'cluster',
      priority: 90
    });
  });
  
  // 3. Add analet label nodes (medium priority, can move)
  analets.forEach(analet => {
    const label = analetLabels.get(analet.id);
    if (label) {
      const labelWidth = estimateTextWidth(label, 9);
      const labelHeight = 12;
      const analetX = analet.location?.x || 0;
      const analetY = analet.location?.y || 0;
      
      // Start label position further below analet to avoid overlap
      const startX = analetX;
      const startY = analetY + 25;
      
      nodes.push({
        id: `analet-label-${analet.id}`,
        x: startX,
        y: startY,
        width: labelWidth,
        height: labelHeight,
        fixed: false,
        type: 'analet-label',
        priority: 70,
        targetX: analetX,
        targetY: analetY,
        anchorDistance: 25
      });
    }
  });
  
  // 4. Add cluster label nodes (lower priority, can move)
  clusters.forEach(cluster => {
    const label = clusterLabels.get(cluster.id);
    if (label) {
      const labelWidth = estimateTextWidth(label, 12);
      const labelHeight = 16;
      
      // Start label position above cluster center
      const startX = cluster.center.x;
      const startY = cluster.center.y - cluster.radius - 25;
      
      nodes.push({
        id: `cluster-label-${cluster.id}`,
        x: startX,
        y: startY,
        width: labelWidth,
        height: labelHeight,
        fixed: false,
        type: 'cluster',
        priority: 60,
        targetX: cluster.center.x,
        targetY: cluster.center.y,
        anchorDistance: cluster.radius + 25
      });
    }
  });
  
  // Run force simulation
  const finalNodes = runForceSimulation(nodes, maxDistance);
  
  // Extract positions
  const analetLabelPositions = new Map<number, LabelPosition>();
  const clusterLabelPositions = new Map<string, LabelPosition>();
  
  finalNodes.forEach(node => {
    if (node.type === 'analet-label') {
      const analetId = parseInt(node.id.replace('analet-label-', ''));
      analetLabelPositions.set(analetId, {
        x: node.x,
        y: node.y,
        width: node.width,
        height: node.height
      });
    } else if (node.type === 'cluster' && node.id.startsWith('cluster-label-')) {
      const clusterId = node.id.replace('cluster-label-', '');
      clusterLabelPositions.set(clusterId, {
        x: node.x,
        y: node.y,
        width: node.width,
        height: node.height
      });
    }
  });
  return { analetLabelPositions, clusterLabelPositions };
}

/**
 * Run physics simulation to position labels
 */
function runForceSimulation(nodes: ForceNode[], maxDistance: number): ForceNode[] {
  const iterations = 100;
  const coolingFactor = 0.95;
  let temperature = 1.0;
  
  // Copy nodes to avoid mutation
  const simNodes = nodes.map(node => ({ ...node }));
  
  for (let iter = 0; iter < iterations; iter++) {
    // Apply forces
    simNodes.forEach(node => {
      if (node.fixed) return;
      
      let fx = 0;
      let fy = 0;
      
      // 1. Anchor force - pull labels toward their targets
      if (node.targetX !== undefined && node.targetY !== undefined && node.anchorDistance !== undefined) {
        const targetDistance = node.anchorDistance;
        const dx = node.targetX - node.x;
        const dy = node.targetY - node.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        if (distance > targetDistance) {
          // Pull toward target if too far
          const pullStrength = 0.1;
          fx += (dx / distance) * pullStrength * (distance - targetDistance);
          fy += (dy / distance) * pullStrength * (distance - targetDistance);
        } else if (distance < targetDistance * 0.5) {
          // Push away if too close
          const pushStrength = 0.05;
          fx -= (dx / distance) * pushStrength * (targetDistance * 0.5 - distance);
          fy -= (dy / distance) * pushStrength * (targetDistance * 0.5 - distance);
        }
      }
      
      // 2. Repulsion forces from other nodes
      simNodes.forEach(other => {
        if (other.id === node.id) return;
        
        const dx = node.x - other.x;
        const dy = node.y - other.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        if (distance < maxDistance && distance > 0) {
          const repulsionStrength = calculateRepulsionStrength(node, other);
          const force = repulsionStrength / (distance * distance);
          
          fx += (dx / distance) * force;
          fy += (dy / distance) * force;
        }
      });
      
      // 3. Boundary forces to keep labels within reasonable bounds
      const boundaryStrength = 0.02;
      if (node.targetX !== undefined && node.targetY !== undefined) {
        const maxOffset = maxDistance * 3;
        if (Math.abs(node.x - node.targetX) > maxOffset) {
          fx -= (node.x - node.targetX) * boundaryStrength;
        }
        if (Math.abs(node.y - node.targetY) > maxOffset) {
          fy -= (node.y - node.targetY) * boundaryStrength;
        }
      }
      
      // Apply forces with damping
      const damping = 0.8;
      node.x += fx * temperature * damping;
      node.y += fy * temperature * damping;
    });
    
    // Cool down the system
    temperature *= coolingFactor;
  }
  
  // Filter out labels that are too far from their anchors
  return simNodes.filter(node => {
    if (node.fixed) return true;
    if (node.targetX === undefined || node.targetY === undefined) return true;
    
    const dx = node.x - node.targetX;
    const dy = node.y - node.targetY;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    return distance <= maxDistance;
  });
}

/**
 * Calculate repulsion strength between two nodes based on their types and priorities
 */
function calculateRepulsionStrength(node1: ForceNode, node2: ForceNode): number {
  const basePriority1 = node1.priority / 100;
  const basePriority2 = node2.priority / 100;
  
  // Higher priority nodes repel more strongly
  const priorityMultiplier = (basePriority1 + basePriority2);
  
  // Different node types have different repulsion strengths
  let typeMultiplier = 1.0;
  
  if (node1.type === 'analet' || node2.type === 'analet') {
    typeMultiplier = 3.0; // Stronger repulsion from analets to prevent overlap
  } else if (node1.type === 'cluster' || node2.type === 'cluster') {
    typeMultiplier = 1.5; // Medium repulsion from clusters
  } else {
    typeMultiplier = 1.0; // Normal repulsion between labels
  }
  
  return 50 * priorityMultiplier * typeMultiplier;
}

/**
 * Estimate text width in pixels
 */
function estimateTextWidth(text: string, fontSize: number): number {
  // Rough estimation: average character width is ~0.6 * fontSize
  return text.length * fontSize * 0.6;
}

/**
 * Check if a label position is within the proximity limit of its anchor
 */
export function isWithinProximity(
  labelPos: LabelPosition,
  anchorX: number,
  anchorY: number,
  maxDistance: number
): boolean {
  const labelCenterX = labelPos.x + labelPos.width / 2;
  const labelCenterY = labelPos.y + labelPos.height / 2;
  
  const dx = labelCenterX - anchorX;
  const dy = labelCenterY - anchorY;
  const distance = Math.sqrt(dx * dx + dy * dy);
  
  return distance <= maxDistance;
}

/**
 * Filter visible labels based on proximity to their anchors
 */
export function filterLabelsByProximity<T>(
  labelPositions: Map<T, LabelPosition>,
  anchors: Map<T, { x: number; y: number }>,
  maxDistance: number
): Set<T> {
  const visibleLabels = new Set<T>();
  
  labelPositions.forEach((position, key) => {
    const anchor = anchors.get(key);
    if (anchor && isWithinProximity(position, anchor.x, anchor.y, maxDistance)) {
      visibleLabels.add(key);
    }
  });
  
  return visibleLabels;
}