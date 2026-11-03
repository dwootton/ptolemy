import React, { useMemo } from 'react';
import { Analet } from '../../../types/analet';

interface Point {
  x: number;
  y: number;
}

interface TightBubbleSetProps {
  analets: Analet[];
  color: { r: number; g: number; b: number; a: number };
  sigma?: number;
  threshold?: number;
}

// MST computation for connecting analets
function computeMST(points: Point[]): [number, number][] {
  if (points.length < 2) return [];
  
  const edges: [number, number][] = [];
  const visited = new Set<number>();
  visited.add(0);
  
  while (visited.size < points.length) {
    let minDist = Infinity;
    let bestEdge: [number, number] | null = null;
    
    for (const i of visited) {
      for (let j = 0; j < points.length; j++) {
        if (!visited.has(j)) {
          const dist = Math.sqrt(
            (points[i].x - points[j].x) ** 2 + (points[i].y - points[j].y) ** 2
          );
          if (dist < minDist) {
            minDist = dist;
            bestEdge = [i, j];
          }
        }
      }
    }
    
    if (bestEdge) {
      edges.push(bestEdge);
      visited.add(bestEdge[1]);
    }
  }
  
  return edges;
}

export const TightBubbleSet: React.FC<TightBubbleSetProps> = ({
  analets,
  color,
  sigma = 2.5, // Using specified parameter
  threshold = 0.36 // Using specified parameter
}) => {
  // Convert analets to points
  const points = useMemo(() => 
    analets.map(analet => ({
      x: analet.location?.x || 0,
      y: analet.location?.y || 0
    })),
    [analets]
  );

  const edges = useMemo(() => computeMST(points), [points]);
  const filterId = useMemo(() => "tight-bubble-" + Math.random().toString(36).substr(2, 9), []);
  
  if (points.length === 0) return null;

  const gaussianMax = 1.0;
  const slope = 50;

  return (
    <>
      <defs>
        <filter id={filterId} filterUnits="userSpaceOnUse" x="-50%" y="-50%" width="200%" height="200%">
          {/* Use SourceAlpha for tighter control */}
          <feGaussianBlur in="SourceAlpha" stdDeviation={sigma} result="blur" />
          
          {/* Sharp threshold for tight boundaries */}
          <feComponentTransfer in="blur" result="sharp">
            <feFuncA type="linear" slope={slope / gaussianMax} intercept={-threshold * slope + 0.5} />
          </feComponentTransfer>
          
          {/* Apply color */}
          <feComponentTransfer in="sharp">
            <feFuncR type="linear" intercept={color.r / 255} slope="0" />
            <feFuncG type="linear" intercept={color.g / 255} slope="0" />
            <feFuncB type="linear" intercept={color.b / 255} slope="0" />
            <feFuncA type="table" tableValues={`0 ${color.a}`} />
          </feComponentTransfer>
        </filter>
      </defs>
      
      <g filter={`url(#${filterId})`}>
        {/* Draw MST edges */}
        {edges.map(([i, j], idx) => {
          // Calculate stroke width based on distance
          const dist = Math.sqrt(
            (points[i].x - points[j].x) ** 2 + 
            (points[i].y - points[j].y) ** 2
          );
          
          let strokeWidth;
          if (dist <= 150) {
            // For short connections, use thin strokes
            strokeWidth = 3;
          } else {
            // For long connections, slightly thicker but still tight
            strokeWidth = 8;
          }
          
          return (
            <line
              key={idx}
              x1={points[i].x}
              y1={points[i].y}
              x2={points[j].x}
              y2={points[j].y}
              stroke="black"
              strokeWidth={strokeWidth}
              strokeLinecap="round"
            />
          );
        })}
        
        {/* Draw circles around nodes for coverage */}
        {points.map((point, idx) => {
          const nodeRadius = 8 + 4; // Analet radius + 4px padding to avoid overlap
          
          return (
            <circle
              key={`node-${idx}`}
              cx={point.x}
              cy={point.y}
              r={nodeRadius}
              fill="black"
            />
          );
        })}
      </g>
    </>
  );
};

// Utility to convert hex to rgba
export const hexToRgba = (hex: string, alpha: number = 1.0) => {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return { r, g, b, a: alpha };
};