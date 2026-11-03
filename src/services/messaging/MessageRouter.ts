/**
 * MessageRouter - Central coordinator for domain-based message handling
 * Replaces the monolithic MessageService with a clean, modular architecture
 */

import * as vscode from 'vscode';
import { Message, MessageContext, DomainMessageHandler, PendingRequest, MessageHandler } from './types';
import { StateManagementService } from '../StateManagementService';

export class MessageRouter {
  private webview: vscode.Webview;
  private context: MessageContext;
  private handlers: DomainMessageHandler[] = [];
  private pendingRequests: Map<string, PendingRequest> = new Map();
  private messageHandlers: Map<string, Set<MessageHandler>> = new Map();

  constructor(webview: vscode.Webview, stateService: StateManagementService) {
    this.webview = webview;
    this.context = {
      webview,
      stateService,
      messageRouter: this,
      analetStore: undefined, // Will be set after initialization
      telemetryService: undefined // Will be set after initialization
    };
  }

  /**
   * Register a domain message handler
   */
  public registerHandler(handler: DomainMessageHandler): void {
    this.handlers.push(handler);
  }

  /**
   * Initialize all registered handlers
   */
  public async initialize(): Promise<void> {
    for (const handler of this.handlers) {
      if (handler.initialize) {
        try {
          await handler.initialize(this.context);
        } catch (error) {
          console.error(`❌ [MessageRouter] Failed to initialize ${handler.constructor.name}:`, error);
        }
      }
    }
  }

  /**
   * Main message handling entry point
   */
  public async handleMessage(message: Message): Promise<void> {
    const { type, command, data, messageId } = message;
    // Handle responses to pending requests
    if (messageId && this.pendingRequests.has(messageId)) {
      const { resolve } = this.pendingRequests.get(messageId)!;
      this.pendingRequests.delete(messageId);
      resolve(data);
      return;
    }

    // Determine message type
    const messageType = type || command;
    if (!messageType) {
      console.warn('⚠️ [MessageRouter] Message missing type and command:', message);
      return;
    }

    // Find appropriate handler
    const handler = this.findHandler(messageType);
    if (!handler) {
      console.warn(`⚠️ [MessageRouter] No handler found for message type: ${messageType}`);
      await this.sendMessage('error', {
        message: `Unknown message type: ${messageType}`,
        originalMessage: message
      });
      return;
    }

    // Handle the message
    try {
      await handler.handle(messageType, data, this.context);
    } catch (error) {
      console.error(`❌ [MessageRouter] Error handling ${messageType}:`, error);
      await this.sendMessage('error', {
        message: error instanceof Error ? error.message : 'Unknown error',
        messageType,
        originalMessage: message
      });
    }
  }

  /**
   * Send a message to the webview
   */
  public async sendMessage(type: string, data?: any): Promise<void> {
    const message: Message = { type, data };
    try {
      await this.webview.postMessage(message);
    } catch (error) {
      console.error(`❌ [MessageRouter] Failed to send message ${type}:`, error);
    }
  }

  /**
   * Send a request with response handling
   */
  public async sendRequest(type: string, data?: any, timeoutMs: number = 10000): Promise<any> {
    const messageId = this.generateMessageId();
    const message: Message = { type, data, messageId };

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(messageId, { resolve, reject });

      // Set timeout for request
      const timeout = setTimeout(() => {
        if (this.pendingRequests.has(messageId)) {
          this.pendingRequests.delete(messageId);
          reject(new Error(`Request timeout: ${type}`));
        }
      }, timeoutMs);

      // Send message
      Promise.resolve(this.webview.postMessage(message)).catch((error) => {
        clearTimeout(timeout);
        this.pendingRequests.delete(messageId);
        reject(error);
      });
    });
  }

  /**
   * Register handler for messages and return cleanup function
   */
  public onMessage(type: string, handler: MessageHandler): () => void {
    if (!this.messageHandlers.has(type)) {
      this.messageHandlers.set(type, new Set());
    }
    this.messageHandlers.get(type)!.add(handler);

    // Return cleanup function
    return () => {
      const handlers = this.messageHandlers.get(type);
      if (handlers) {
        handlers.delete(handler);
        if (handlers.size === 0) {
          this.messageHandlers.delete(type);
        }
      }
    };
  }

  /**
   * Find the appropriate handler for a message type
   */
  private findHandler(messageType: string): DomainMessageHandler | null {
    for (const handler of this.handlers) {
      if (handler.canHandle(messageType)) {
        return handler;
      }
    }
    return null;
  }

  /**
   * Generate unique message ID
   */
  private generateMessageId(): string {
    return Math.random().toString(36).substr(2, 9);
  }

  /**
   * Update context (useful for late initialization of services)
   */
  public updateContext(updates: Partial<MessageContext>): void {
    this.context = { ...this.context, ...updates };
  }

  /**
   * Get list of all supported message types across all handlers
   */
  public getSupportedMessageTypes(): string[] {
    const messageTypes: string[] = [];
    for (const handler of this.handlers) {
      messageTypes.push(...handler.getHandledMessageTypes());
    }
    return [...new Set(messageTypes)].sort();
  }

  /**
   * Clean up resources
   */
  public dispose(): void {
    // Clear pending requests
    for (const [messageId, { reject }] of this.pendingRequests) {
      reject(new Error('MessageRouter disposed'));
    }
    this.pendingRequests.clear();

    // Dispose handlers
    for (const handler of this.handlers) {
      if (handler.dispose) {
        try {
          handler.dispose();
        } catch (error) {
          console.error(`❌ [MessageRouter] Error disposing ${handler.constructor.name}:`, error);
        }
      }
    }

    this.handlers.length = 0;
    this.messageHandlers.clear();
  }
}
