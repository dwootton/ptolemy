/**
 * Unified Messaging System
 * 
 * This module provides a clean, modular replacement for the monolithic MessageService.
 * It uses a domain-driven architecture with focused handlers for different concerns.
 */

// Core infrastructure
export { MessageRouter } from './MessageRouter';
export { BaseMessageHandler } from './BaseMessageHandler';
export { MessageServiceFactory } from './MessageServiceFactory';

// Types
export * from './types';

// Domain handlers
export * from './handlers';

// Default export for easy migration
export { MessageServiceFactory as ModularMessageService } from './MessageServiceFactory';