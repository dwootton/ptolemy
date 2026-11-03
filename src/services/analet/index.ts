/**
 * Barrel export for the new unified analet architecture
 * 
 * This module provides a clean, adapter-pattern based approach to analet management
 * that replaces the previous complex multi-service architecture.
 */

// Core domain services
import { AnaletController } from './domain/AnaletController';
import { UnifiedAnaletRepository, type AnaletRepository } from './domain/AnaletRepository';

import { UnifiedStateSyncService, type StateSyncService } from './domain/StateSyncService';

// Input adapters
import { StatementAdapter } from './adapters/StatementAdapter';
import { NotebookAdapter } from './adapters/NotebookAdapter';
import { FramingAdapter } from './adapters/FramingAdapter';
import { EmbeddingAdapter } from './adapters/EmbeddingAdapter';
import { DerivationAdapter } from './adapters/DerivationAdapter';
import { FocusAdapter } from './adapters/FocusAdapter';
import { HierarchyAdapter } from './adapters/HierarchyAdapter';
import { BaseAnaletInputAdapter, type AnaletInputAdapter } from './adapters/base/AnaletInputAdapter';

// Export everything
export {
  AnaletController,
  UnifiedAnaletRepository, 
  type AnaletRepository,

  UnifiedStateSyncService,
  type StateSyncService,
  StatementAdapter,
  NotebookAdapter,
  FramingAdapter,
  EmbeddingAdapter,
  DerivationAdapter,
  FocusAdapter,
  BaseAnaletInputAdapter,
  type AnaletInputAdapter
};

// Types
export * from './types';

/**
 * Factory function to create a fully configured AnaletController
 */
export function createAnaletController(
  stateService: any, // StateManagementService
  messageService?: any, // ExtensionMessageService
  analetStore?: any // AnaletStore
): AnaletController {
  // Create core services
  const repository = new UnifiedAnaletRepository(stateService, analetStore);
  const stateSync = new UnifiedStateSyncService(stateService, messageService);
  
  // Create controller with new architecture (no CoreGenerationService)
  const controller = new AnaletController(repository, stateSync);
  
  // Register adapters
  controller.registerAdapter('from_statement', new StatementAdapter());
  controller.registerAdapter('from_notebook', new NotebookAdapter());
  controller.registerAdapter('from_framing', new FramingAdapter());
  controller.registerAdapter('from_embedding', new EmbeddingAdapter());
  controller.registerAdapter('from_derivation', new DerivationAdapter());
  controller.registerAdapter('from_focus', new FocusAdapter());
  controller.registerAdapter('from_hierarchy', new HierarchyAdapter());
  return controller;
}

/**
 * Legacy compatibility - wrapper around promoteFramingAnalets
 * This replaces the old "random generation" which was actually promotion
 */
export async function promoteRandomAnalets(
  controller: AnaletController, 
  count: number = 5
): Promise<any[]> {
  return await controller.promoteFramingAnalets(count);
}