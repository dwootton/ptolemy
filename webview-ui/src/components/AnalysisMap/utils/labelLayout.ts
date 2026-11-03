export interface BaseLabelInput {
  id: number;
  text: string;
  anchorX: number; // bottom-center anchor x (in map coords)
  anchorY: number; // bottom-center anchor y (in map coords)
  isSelected?: boolean;
}

export interface PlacedLabel {
  id: number;
  text: string;
  x: number; // final anchor x (bottom-center)
  y: number; // final anchor y (bottom-center)
  isSelected?: boolean;
}

// Note: we intentionally removed overlap checking to keep labels close to nodes

export function estimateLineCount(text: string, maxCharsPerLine: number): number {
  // Simple word-based wrapping estimate
  const words = text.split(/\s+/).filter(Boolean);
  let lines = 1;
  let current = 0;
  for (const w of words) {
    const len = w.length;
    if (current === 0) {
      current = len;
    } else if (current + 1 + len <= maxCharsPerLine) {
      current += 1 + len;
    } else {
      lines += 1;
      current = len;
    }
  }
  return Math.max(1, lines);
}

/**
 * Greedy label layout: try a sequence of offset candidates per label and pick the first non-overlapping.
 * Assumptions: fixed labelWidth and estimated height from text length, small font size.
 */
export function computeLabelLayout(
  inputs: BaseLabelInput[],
  options?: {
    labelWidth?: number; // px max width used to estimate wrapping
    lineHeight?: number; // px height per text line
    charWidth?: number;  // px approximate character width for width estimate
    maxCharsPerLine?: number;
    nodeRadius?: number;
    minGap?: number; // px minimal gap between node edge and label bottom
    maxGap?: number; // px maximum gap between node edge and label bottom
  }
): PlacedLabel[] {
  const labelWidth = options?.labelWidth ?? 200;
  const lineHeight = options?.lineHeight ?? 12;
  const charWidth = options?.charWidth ?? 7;
  const maxCharsPerLine = options?.maxCharsPerLine ?? Math.max(8, Math.floor(labelWidth / charWidth));
  const nodeRadius = options?.nodeRadius ?? 2;
  const minGap = options?.minGap ?? 2;  // at least 2px away
  const maxGap = options?.maxGap ?? 2; // at most 20px away

  type BBox = { left: number; right: number; top: number; bottom: number };
  const boxes: BBox[] = [];
  const placed: PlacedLabel[] = [];

  const intersects = (a: BBox, b: BBox): boolean => {
    return !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
  };

  const estimateBoxFromCenter = (cx: number, cy: number, text: string): { box: BBox; bottomY: number; width: number; height: number } => {
    // Estimate width from characters up to labelWidth
    const estWidth = Math.min(labelWidth, Math.ceil(text.length * charWidth));
    const lines = estimateLineCount(text, maxCharsPerLine);
    const height = Math.max(lineHeight, lines * lineHeight);
    const left = cx - estWidth / 2;
    const right = cx + estWidth / 2;
    const top = cy - height / 2;
    const bottom = cy + height / 2;
    return { box: { left, right, top, bottom }, bottomY: bottom, width: estWidth, height };
  };

  // Angles in degrees, prioritize straight above then sweep clockwise/counterclockwise
  const angles: number[] = [90, 60, 120, 45, 135, 30, 150, 0, 180, 330, 210, 300, 240, 270];
  const gaps: number[] = Array.from(new Set([minGap, Math.min(4, maxGap), Math.min(8, maxGap), maxGap]));

  // Place selected first to give them priority
  const sorted = [...inputs].sort((a, b) => (b.isSelected ? 1 : 0) - (a.isSelected ? 1 : 0));

  for (const item of sorted) {
    // Precompute label height for gap→radius conversion
    const lines = estimateLineCount(item.text, maxCharsPerLine);
    const labelHeight = Math.max(lineHeight, lines * lineHeight);
    let placedThis = false;
    for (const gap of gaps) {
      const radius = nodeRadius + gap + labelHeight / 2;
      for (const deg of angles) {
        const rad = (deg * Math.PI) / 180;
        const dx = Math.cos(rad) * radius;
        const dy = Math.sin(rad) * radius;
        // Center of label on the ring around the analet center
        const cx = item.anchorX + dx;
        const cy = item.anchorY - dy;
        const { box: bbox, bottomY } = estimateBoxFromCenter(cx, cy, item.text);
        let collision = false;
        for (const b of boxes) {
          if (intersects(bbox, b)) { collision = true; break; }
        }
        if (!collision) {
          boxes.push(bbox);
          placed.push({ id: item.id, text: item.text, x: cx, y: bottomY, isSelected: item.isSelected });
          placedThis = true;
          break;
        }
      }
      if (placedThis) break;
    }
    // If no non-overlapping spot found, skip rendering per spec
  }

  return placed;
}


