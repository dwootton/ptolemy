import { Analet } from '../types/analet';

/**
 * Generate a short, opaque label from an analet question
 * Maximum 2-3 words, removes articles and prepositions
 * Examples:
 * - "What is the correlation between price and sales?" → "Price Correlation"
 * - "How does user behavior change over time?" → "User Behavior"
 * - "Is there a relationship between age and income?" → "Age Income"
 */
export function generateShortLabel(analet: Analet): string {
  const statement = analet.statement || `Analet ${analet.id}`;
  
  // Remove common question words and articles
  const stopWords = new Set([
    'what', 'how', 'why', 'when', 'where', 'who', 'which', 'whose',
    'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'from', 'up', 'about', 'into', 'through', 'during',
    'before', 'after', 'above', 'below', 'between', 'among', 'against',
    'there', 'does', 'do', 'did', 'will', 'would', 'could', 'should',
    'may', 'might', 'must', 'can', 'have', 'has', 'had'
  ]);
  
  // Extract meaningful words
  const words = statement
    .toLowerCase()
    .replace(/[?!.,:;]/g, '') // Remove punctuation
    .split(/\s+/) // Split on whitespace
    .filter(word => word.length > 2 && !stopWords.has(word)) // Filter out short words and stop words
    .map(word => word.charAt(0).toUpperCase() + word.slice(1)); // Capitalize first letter
  
  // Handle different cases
  if (words.length === 0) {
    return `Analysis ${analet.id}`;
  }
  
  if (words.length === 1) {
    return `${words[0]} Analysis`;
  }
  
  if (words.length === 2) {
    return words.join(' ');
  }
  
  // For 3+ words, try to create meaningful combinations
  if (words.length >= 3) {
    // Look for common analysis patterns
    const analysisWords = ['correlation', 'relationship', 'trend', 'pattern', 'analysis', 'comparison', 'distribution'];
    const hasAnalysisWord = words.some(word => analysisWords.some(analysis => word.toLowerCase().includes(analysis)));
    
    if (hasAnalysisWord) {
      // Take first word + analysis type
      const analysisWord = words.find(word => analysisWords.some(analysis => word.toLowerCase().includes(analysis)));
      const firstWord = words[0];
      if (analysisWord && firstWord !== analysisWord) {
        return `${firstWord} ${analysisWord}`;
      }
    }
    
    // Default: take first two meaningful words
    return words.slice(0, 2).join(' ');
  }
  
  return words.join(' ');
}

/**
 * Generate labels for multiple analets with deduplication
 * Ensures no two analets have the same label by adding numbers if needed
 */
export function generateUniqueLabels(analets: Analet[]): Map<number, string> {
  const labelMap = new Map<number, string>();
  const usedLabels = new Set<string>();
  
  for (const analet of analets) {
    let baseLabel = generateShortLabel(analet);
    let finalLabel = baseLabel;
    let counter = 1;
    
    // Handle duplicates by adding numbers
    while (usedLabels.has(finalLabel)) {
      counter++;
      finalLabel = `${baseLabel} ${counter}`;
    }
    
    labelMap.set(analet.id, finalLabel);
    usedLabels.add(finalLabel);
  }
  
  return labelMap;
}

/**
 * Get a cached label for an analet, generating if needed
 */
const labelCache = new Map<number, string>();

export function getCachedLabel(analet: Analet): string {
  if (labelCache.has(analet.id)) {
    return labelCache.get(analet.id)!;
  }
  
  const label = generateShortLabel(analet);
  labelCache.set(analet.id, label);
  return label;
}

/**
 * Clear the label cache (useful when analets are updated)
 */
export function clearLabelCache(): void {
  labelCache.clear();
} 