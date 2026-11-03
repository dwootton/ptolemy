// Configuration constants for the Meridian extension

// ===============================================
// SIMPLIFIED 3-FLAG CONFIGURATION
// ===============================================

// 🎯 Core Workflow Controls
export const USE_CACHED_DATA = true;           // When true: Use .meridian storage + existing notebooks (fast)
export const FORCE_FRESH_CONTENT = false;      // When true: Always regenerate data ignoring cache (slow)  
export const GENERATE_AI_NOTEBOOKS = true;     // When true: Use OpenAI for notebooks, false: Use templates
export const ENABLE_SESSION_STATE_RESTORE = true;  // When true: Restore UI state between sessions (currently OFF for debugging)


// ===============================================
// CONFIGURATION MODES:
// ===============================================

// 🚀 DEVELOPMENT MODE (Current - Optimal Performance)
// USE_CACHED_DATA = true
// FORCE_FRESH_CONTENT = false  
// GENERATE_AI_NOTEBOOKS = true
// ENABLE_SESSION_STATE_RESTORE = true
// → Uses cached data when available, AI notebooks, instant loading, session continuity

// 🎯 FRESH CONTENT MODE (Full AI Regeneration)
// USE_CACHED_DATA = false
// FORCE_FRESH_CONTENT = true
// GENERATE_AI_NOTEBOOKS = true  
// ENABLE_SESSION_STATE_RESTORE = true
// → Always fresh content, full AI generation, ignores all cache, session continuity

// ===============================================
// FLAG BEHAVIOR:
// ===============================================
// USE_CACHED_DATA: When true, prioritizes cached data for fast loading
// FORCE_FRESH_CONTENT: When true, always regenerates content ignoring cache
// GENERATE_AI_NOTEBOOKS: Controls whether to use AI-generated or template notebooks
// ENABLE_SESSION_STATE_RESTORE: Controls UI state persistence between sessions

// ===============================================
// HELPER FUNCTIONS:
// ===============================================
export const shouldGenerateNewContent = () => !USE_CACHED_DATA || FORCE_FRESH_CONTENT;
export const shouldUseAINotebooks = () => GENERATE_AI_NOTEBOOKS;