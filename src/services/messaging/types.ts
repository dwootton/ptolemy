/**
 * Core types for the unified messaging system
 */

import * as vscode from 'vscode';
import { StateManagementService } from '../StateManagementService';

export interface Message {
  type: string;
  command?: string;
  data?: any;
  messageId?: string;
}

export type MessageHandler = (data: any) => void;

export interface MessageContext {
  webview: vscode.Webview;
  stateService: StateManagementService;
  messageRouter: any; // Will be MessageRouter, but avoiding circular reference
  analetStore?: any;
  telemetryService?: any;
  openAIService?: any;
}

export interface DomainMessageHandler {
  /**
   * Check if this handler can process the given message type
   */
  canHandle(messageType: string): boolean;
  
  /**
   * Handle the message
   */
  handle(messageType: string, data: any, context: MessageContext): Promise<void>;
  
  /**
   * Get list of all message types this handler supports
   */
  getHandledMessageTypes(): string[];
  
  /**
   * Optional: Initialize the handler (for setup that requires context)
   */
  initialize?(context: MessageContext): Promise<void>;
  
  /**
   * Optional: Cleanup resources
   */
  dispose?(): void;
}

export interface PendingRequest {
  resolve: (value: any) => void;
  reject: (reason: any) => void;
}

export interface ActiveOperation {
  id: string;
  type: 'analets' | 'notebooks' | 'concept-axes' | 'concept';
  startTime: number;
  abortController?: AbortController;
}

/**
 * Standard response format for message handlers
 */
export interface MessageResponse {
  success: boolean;
  data?: any;
  error?: string;
  messageType?: string;
}

/**
 * Message validation result
 */
export interface ValidationResult {
  isValid: boolean;
  error?: string;
}