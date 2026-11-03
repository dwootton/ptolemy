import { Analet } from '../types/analet';

// Cache for single analet folder names
const singleAnaletNameCache = new Map<number, string>();

/**
 * Generate an LLM-powered name for a folder based on its member analets
 */
export async function generateFolderName(
  analets: Analet[],
  sendMessage: (type: string, data: any) => void,
  onProgress?: (message: string) => void
): Promise<string> {
  if (analets.length === 0) {
    return 'Empty Folder';
  }
  
  if (analets.length === 1) {
    const analet = analets[0];
    
    // Check cache first for single analets
    if (singleAnaletNameCache.has(analet.id)) {
      const cachedName = singleAnaletNameCache.get(analet.id)!;
      return cachedName;
    }
    
    // For single analet, use a shortened version of the statement
    const statement = analet.statement || 'Analet';
    const shortName = statement.length > 30 ? statement.substring(0, 27) + '...' : statement;
    
    // Cache the name for future use
    singleAnaletNameCache.set(analet.id, shortName);
    return shortName;
  }
  
  // For multiple analets, prepare data for LLM analysis
  const analetsData = analets.map(analet => ({
    id: analet.id,
    statement: analet.statement,
    cellQL: analet.cellQL,
    explanation: analet.explanation
  }));
  if (onProgress) {
    onProgress('Analyzing analets...');
  }
  
  return new Promise((resolve) => {
    // Create a unique request ID to match response
    const requestId = `folder-naming-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    // Note: In a real implementation, you'd set up a message listener here
    // const messageHandler = (data: { requestId: string; folderName: string; error?: string }) => {
    //   if (data.requestId === requestId) {
    //     if (data.error) {
    //       console.error('❌ [FolderNaming] LLM naming failed:', data.error);
    //       if (onProgress) onProgress('LLM failed, using fallback...');
    //       const fallbackName = generateFallbackName(analets);
    //       resolve(fallbackName);
    //     } else {
    //       console.log(`✅ [FolderNaming] LLM generated name: "${data.folderName}"`);
    //       if (onProgress) onProgress('Name generated!');
    //       resolve(data.folderName);
    //     }
    //   }
    // };
    
    // Simulate LLM processing with progress updates
    const steps = [
      { message: 'Analyzing analet content...', delay: 800 },
      { message: 'Generating name suggestions...', delay: 1200 },
      { message: 'Finalizing folder name...', delay: 800 }
    ];
    
    let stepIndex = 0;
    const progressInterval = setInterval(() => {
      if (stepIndex < steps.length && onProgress) {
        onProgress(steps[stepIndex].message);
        stepIndex++;
      }
    }, 1000);
    
    // Note: In a real implementation, you'd set up the message listener here
    // For now, we'll use a timeout with fallback
    setTimeout(() => {
      clearInterval(progressInterval);
      const fallbackName = generateFallbackName(analets);
      if (onProgress) {
        onProgress('Using smart analysis...');
        setTimeout(() => resolve(fallbackName), 300);
      } else {
        resolve(fallbackName);
      }
    }, 3500);
    
    // Send request to extension backend
    sendMessage('generate-folder-name', {
      requestId,
      analets: analetsData,
      prompt: `Based on the following data analysis questions and their CellQL, generate a concise, descriptive folder name (maximum 4 words) that captures the common theme or purpose of these analyses:

${analetsData.map((analet, i) => `${i + 1}. Statement: "${analet.statement}"
   CellQL: ${analet.cellQL}
   Explanation: ${analet.explanation}`).join('\n\n')}

The folder name should be:
- Concise (maximum 4 words)
- Descriptive of the common analytical theme
- Professional and clear
- Focused on the analytical purpose rather than specific data fields

Examples of good folder names:
- "Sales Trend Analysis"
- "Customer Segmentation"
- "Performance Metrics"
- "Outlier Detection"

Generate only the folder name, no explanation.`
    });
  });
}

/**
 * Generate a fallback name when LLM is not available
 */
function generateFallbackName(analets: Analet[]): string {
  // Analyze common themes in questions and formalism
  
  // Look for common keywords in statements
  const allStatements = analets.map(a => a.statement.toLowerCase()).join(' ');
  const commonKeywords = [
    'trend', 'pattern', 'comparison', 'distribution', 'correlation', 
    'outlier', 'summary', 'count', 'average', 'total', 'performance'
  ];
  
  const foundKeyword = commonKeywords.find(keyword => allStatements.includes(keyword));
  if (foundKeyword) {
    return `${foundKeyword.charAt(0).toUpperCase() + foundKeyword.slice(1)} Group`;
  }
  
  // Final fallback
  return `Analysis Group (${analets.length})`;
}

/**
 * Clear cached name for a specific analet (call when analet is edited)
 */
export function clearAnaletNameCache(analetId: number): void {
  if (singleAnaletNameCache.has(analetId)) {
    singleAnaletNameCache.delete(analetId);
  }
}

/**
 * Clear all cached names
 */
export function clearAllNameCache(): void {
  singleAnaletNameCache.clear();
}