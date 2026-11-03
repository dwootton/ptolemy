/**
 * BaseMessageHandler - Common functionality for domain message handlers
 */

import { DomainMessageHandler, MessageContext, ValidationResult } from './types';

export abstract class BaseMessageHandler implements DomainMessageHandler {
  protected context?: MessageContext;
  protected handledMessageTypes: string[] = [];

  constructor(messageTypes: string[]) {
    this.handledMessageTypes = messageTypes;
  }

  public canHandle(messageType: string): boolean {
    return this.handledMessageTypes.includes(messageType);
  }

  public getHandledMessageTypes(): string[] {
    return [...this.handledMessageTypes];
  }

  public async initialize(context: MessageContext): Promise<void> {
    this.context = context;
  }

  /**
   * Abstract method that subclasses must implement
   */
  public abstract handle(messageType: string, data: any, context: MessageContext): Promise<void>;

  /**
   * Helper method to send messages
   */
  protected async sendMessage(type: string, data?: any): Promise<void> {
    if (!this.context) {
      throw new Error(`${this.constructor.name}: Context not initialized`);
    }
    await this.context.messageRouter.sendMessage(type, data);
  }

  /**
   * Helper method to send error responses
   */
  protected async sendError(messageType: string, error: unknown, originalData?: any): Promise<void> {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ [${this.constructor.name}] Error in ${messageType}:`, errorMessage);

    await this.sendMessage('error', {
      message: errorMessage,
      messageType,
      originalData
    });
  }

  /**
   * Helper method to send success responses
   */
  protected async sendSuccess(responseType: string, data?: any): Promise<void> {
    await this.sendMessage(responseType, {
      success: true,
      ...data
    });
  }

  /**
   * Helper method to validate required data fields
   */
  protected validateData(data: any, requiredFields: string[]): ValidationResult {
    if (!data) {
      return {
        isValid: false,
        error: 'No data provided'
      };
    }

    for (const field of requiredFields) {
      if (!(field in data) || data[field] === undefined || data[field] === null) {
        return {
          isValid: false,
          error: `Missing required field: ${field}`
        };
      }
    }

    return { isValid: true };
  }

  /**
   * Helper method to validate data types
   */
  protected validateTypes(data: any, typeChecks: { field: string; type: string; optional?: boolean }[]): ValidationResult {
    for (const check of typeChecks) {
      if (check.optional && !(check.field in data)) {
        continue;
      }

      const value = data[check.field];
      const actualType = typeof value;

      if (actualType !== check.type) {
        return {
          isValid: false,
          error: `Field '${check.field}' must be ${check.type}, got ${actualType}`
        };
      }
    }

    return { isValid: true };
  }

  /**
   * Helper method to log handler activity
   */
  protected log(level: 'info' | 'warn' | 'error', message: string, data?: any): void {
    const prefix = `[${this.constructor.name}]`;

    switch (level) {
      case 'info':
        break;
      case 'warn':
        console.warn(`⚠️ ${prefix} ${message}`, data || '');
        break;
      case 'error':
        console.error(`❌ ${prefix} ${message}`, data || '');
        break;
    }
  }

  /**
   * Helper method to check if operation should be cancelled
   */
  protected checkCancellation(): boolean {
    // This can be extended to check for global cancellation flags
    return false;
  }

  /**
   * Helper method to handle async operations with timeout
   */
  protected async withTimeout<T>(
    operation: Promise<T>,
    timeoutMs: number,
    errorMessage: string = 'Operation timed out'
  ): Promise<T> {
    const timeout = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(errorMessage)), timeoutMs);
    });

    return Promise.race([operation, timeout]);
  }

  /**
   * Default disposal (can be overridden)
   */
  public dispose(): void {
    this.context = undefined;
  }
}
