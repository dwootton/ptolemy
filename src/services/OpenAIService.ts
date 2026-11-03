/**
 * DUMMY OpenAIService - Forces compilation errors for migration
 * 
 * This file exists solely to break any remaining imports of the old OpenAIService.
 * All functionality has been moved to NewOpenAIService and domain-specific adapters.
 * 
 * If you see an error from importing this file, you need to:
 * 1. Replace imports with NewOpenAIService from 'src/services/llm/NewOpenAIService'
 * 2. Move domain logic into adapters
 * 3. Use adapter.generateContext() methods instead of direct OpenAI calls
 */

// This intentionally breaks any code trying to use the old service
export class OpenAIService {
  static getInstance(): never {
    throw new Error('OpenAIService has been deprecated. Use NewOpenAIService and push domain logic into adapters.');
  }
}

// Also break common imports
export const generateStakeholders = () => {
  throw new Error('generateStakeholders moved to FramingAdapter');
};

export const generateAnalysisGoals = () => {
  throw new Error('generateAnalysisGoals moved to FramingAdapter'); 
};

export const generateAnaletIdeasForGoals = () => {
  throw new Error('generateAnaletIdeasForGoals moved to FramingAdapter');
};

export const convertAnaletIdeasToDSL = () => {
  throw new Error('convertAnaletIdeasToDSL moved to FramingAdapter');
};

export const generateDatasetAnalyses = () => {
  throw new Error('generateDatasetAnalyses moved to FramingAdapter');
};

export const generateRandomAnaletsFromSavedContext = () => {
  throw new Error('generateRandomAnaletsFromSavedContext moved to StatementAdapter');
};

export const generateEmbeddings = () => {
  throw new Error('generateEmbeddings available in NewOpenAIService');
};

export const generateCompletion = () => {
  throw new Error('generateCompletion replaced by NewOpenAIService.chatText/chatStructured');
};

export const evaluateAnaletChange = () => {
  throw new Error('evaluateAnaletChange should use NewOpenAIService.chatStructured');
};

export const testConnection = () => {
  throw new Error('testConnection available in NewOpenAIService');
};