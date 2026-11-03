/**
 * NewOpenAIService - Minimal LLM interface with core functionality only
 *
 * This service provides only the essential OpenAI API functionality:
 * - chatStructured: For structured outputs with Zod schemas
 * - chatText: For plain text completions
 *
 * All domain-specific logic should live in adapters/components, not here.
 */
const modelItem = 'gpt-4.1-mini'// 'gpt-5-mini-2025-08-07'; //


import OpenAI from 'openai';
import { zodResponseFormat } from 'openai/helpers/zod';
import { ZodSchema } from 'zod';
import { getOpenAIKey } from '../../config/apiKey';

export interface ChatStructuredOptions<T> {
  system: string;
  user: string;
  schema: ZodSchema<T>;
  model?: string;
  maxTokens?: number;
}

export interface ChatTextOptions {
  system: string;
  user: string;
  model?: string;
  maxTokens?: number;
}

export class NewOpenAIService {
  private static instance: NewOpenAIService;
  private client: OpenAI;
  private readonly MAX_RETRIES = 3;
  private readonly RETRY_DELAY_BASE = 1000; // 1 second base delay

  private constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  public static getInstance(apiKey?: string): NewOpenAIService {
    if (!NewOpenAIService.instance) {
      const resolvedKey = apiKey || getOpenAIKey();
      if (!resolvedKey) {
        throw new Error('OpenAI API key not configured. Set meridian.openaiApiKey or OPENAI_API_KEY.');
      }
      NewOpenAIService.instance = new NewOpenAIService(resolvedKey);
    }
    return NewOpenAIService.instance;
  }

  /**
   * Chat completion with structured output using Zod schema
   */
  public async chatStructured<T>(options: ChatStructuredOptions<T>): Promise<T> {
    const { system, user, schema, model = modelItem, maxTokens = 15000 } = options;

    const operationName = `ChatStructured[${schema.constructor.name || 'schema'}]`;
    const startTime = Date.now();
    const caller = this.getCallerInfo();
    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= this.MAX_RETRIES; attempt++) {
      const attemptStart = Date.now();
      try {
        const response = await this.client.beta.chat.completions.parse({
          model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user }
          ],
          max_completion_tokens: maxTokens,
          response_format: zodResponseFormat(schema, 'response'),
        });

        const parsed = response.choices[0]?.message?.parsed;
        if (!parsed) {
          throw new Error('No parsed content received from OpenAI');
        }

        const elapsed = Date.now() - attemptStart;
        const totalElapsed = Date.now() - startTime;
        return parsed;

      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        const attemptElapsed = Date.now() - attemptStart;
        console.error(`❌ [NewOpenAI] ${operationName} - Attempt ${attempt} failed after ${attemptElapsed}ms:`, error);
        console.error(`❌ [NewOpenAI] Error details:`, {
          name: lastError.name,
          message: lastError.message,
          stack: lastError.stack?.split('\n').slice(0, 3)
        });

        // Don't retry on the last attempt
        if (attempt === this.MAX_RETRIES) break;

        // Exponential backoff with jitter
        const delay = this.RETRY_DELAY_BASE * Math.pow(2, attempt - 1) + Math.random() * 1000;
        await this.sleep(delay);
      }
    }

    const totalElapsed = Date.now() - startTime;
    console.error(`💥 [NewOpenAI] ${operationName} failed after ${this.MAX_RETRIES} attempts | total ${totalElapsed}ms. Last error: ${lastError?.message}`);
    throw new Error(`${operationName} failed after ${this.MAX_RETRIES} attempts. Last error: ${lastError?.message}`);
  }

  /**
   * Chat completion with plain text output
   */
  public async chatText(options: ChatTextOptions): Promise<string> {
    const { system, user, model = modelItem, maxTokens = 15000 } = options;

    const operationName = 'ChatText';
    const startTime = Date.now();
    const caller = this.getCallerInfo();
    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= this.MAX_RETRIES; attempt++) {
      const attemptStart = Date.now();
      try {
        const response = await this.client.chat.completions.create({
          model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user }
          ],
          max_completion_tokens: maxTokens,
        });

        const content = response.choices[0]?.message?.content;
        if (!content) {
          throw new Error('No content received from OpenAI');
        }

        const elapsed = Date.now() - attemptStart;
        const totalElapsed = Date.now() - startTime;
        return content;

      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        const attemptElapsed = Date.now() - attemptStart;
        console.error(`❌ [NewOpenAI] ${operationName} - Attempt ${attempt} failed after ${attemptElapsed}ms:`, error);
        console.error(`❌ [NewOpenAI] Error details:`, {
          name: lastError.name,
          message: lastError.message,
          stack: lastError.stack?.split('\n').slice(0, 3)
        });

        // Don't retry on the last attempt
        if (attempt === this.MAX_RETRIES) break;

        // Exponential backoff with jitter
        const delay = this.RETRY_DELAY_BASE * Math.pow(2, attempt - 1) + Math.random() * 1000;
        await this.sleep(delay);
      }
    }

    const totalElapsed = Date.now() - startTime;
    console.error(`💥 [NewOpenAI] ${operationName} failed after ${this.MAX_RETRIES} attempts | total ${totalElapsed}ms. Last error: ${lastError?.message}`);
    throw new Error(`${operationName} failed after ${this.MAX_RETRIES} attempts. Last error: ${lastError?.message}`);
  }

  /**
   * Generate embeddings (kept for backward compatibility)
   */
  public async generateEmbeddings(texts: string[]): Promise<number[][]> {
    const operationName = 'GenerateEmbeddings';
    const startTime = Date.now();
    const caller = this.getCallerInfo();
    try {
      const response = await this.client.embeddings.create({
        model: 'text-embedding-3-small',
        input: texts,
        encoding_format: 'float',
      });

      const embeddings = response.data.map((item: any) => item.embedding);
      const elapsed = Date.now() - startTime;
      return embeddings;
    } catch (error) {
      const elapsed = Date.now() - startTime;
      console.error(`❌ [NewOpenAI] ${operationName} failed in ${elapsed}ms:`, error);
      console.error(`❌ [NewOpenAI] Error details:`, {
        name: (error as Error).name,
        message: (error as Error).message,
        stack: (error as Error).stack?.split('\n').slice(0, 3)
      });
      throw error;
    }
  }

  /**
   * Test connection to OpenAI
   */
  public async testConnection(): Promise<boolean> {
    try {
      await this.client.models.list();
      return true;
    } catch (error) {
      console.error('NewOpenAI connection test failed. Check your API key and network connection.');
      return false;
    }
  }

  // --- Private helper methods ---

  private getCallerInfo(): string {
    try {
      const stack = new Error().stack?.split('\n').slice(2) || [];
      const callerLine = stack.find(l => !l.includes('NewOpenAIService')) || stack[0] || '';
      return callerLine.trim();
    } catch {
      return 'unknown-caller';
    }
  }

  private preview(text: unknown, limit: number = 200): string {
    try {
      const str = typeof text === 'string' ? text : JSON.stringify(text);
      return str.length > limit ? str.slice(0, limit) + '…' : str;
    } catch {
      return '';
    }
  }

  private isLengthError(error: Error): boolean {
    return (
      (error as any)?.name === 'LengthFinishReasonError' ||
      /length limit|finish reason|Could not parse response content/i.test(error?.message || '') ||
      /max_completion_tokens|max_completion_tokens/i.test(error?.message || '')
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
