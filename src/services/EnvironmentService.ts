import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { parse } from 'dotenv';

export class EnvironmentService {
  private static instance: EnvironmentService;
  private envVars: Record<string, string> = {};
  private initialized = false;

  private constructor() {}

  public static getInstance(): EnvironmentService {
    if (!EnvironmentService.instance) {
      EnvironmentService.instance = new EnvironmentService();
    }
    return EnvironmentService.instance;
  }

  /**
   * Initialize environment variables from .env file and VS Code settings
   */
  public initialize(extensionPath: string): void {
    if (this.initialized) return;

    try {
      const envPath = path.join(extensionPath, '.env');
      if (fs.existsSync(envPath)) {
        this.envVars = parse(fs.readFileSync(envPath));
      }

      this.initialized = true;
    } catch (error) {
      console.error('Error initializing environment service:', error);
    }
  }

  /**
   * Get an environment variable
   */
  public get(key: string): string | undefined {
    // Read settings on every call so removing a key does not retain an old value.
    if (key === 'OPENAI_API_KEY') {
      const settingsKey = vscode.workspace.getConfiguration('meridian')
        .get<string>('openaiApiKey')?.trim();
      if (settingsKey) return settingsKey;
    }

    return process.env[key]?.trim() || this.envVars[key]?.trim() || undefined;
  }

  /**
   * Get the OpenAI API key from various sources
   */
  public getOpenAIApiKey(): string | undefined {
    return this.get('OPENAI_API_KEY');
  }

  /**
   * Check if we should use mock data
   */
  public shouldUseMockData(): boolean {
    // Check VS Code setting first
    const workspaceConfig = vscode.workspace.getConfiguration('meridian');
    const vscodeMockSetting = workspaceConfig.get<boolean>('useMockData');
    if (vscodeMockSetting) {
      return true;
    }

    // Check environment variable
    const useMock = this.get('USE_MOCK_DATA');
    return useMock?.toLowerCase() === 'true' || !this.getOpenAIApiKey();
  }

  /**
   * Get OpenAI organization ID if configured
   */
  public getOpenAIOrganization(): string | undefined {
    return this.get('OPENAI_ORG_ID');
  }

  /**
   * Validate that required environment variables are present
   */
  public validateEnvironment(): { valid: boolean; missingVars: string[] } {
    const requiredVars = ['OPENAI_API_KEY'];
    const missingVars: string[] = [];

    for (const varName of requiredVars) {
      if (!this.get(varName)) {
        missingVars.push(varName);
      }
    }

    return {
      valid: missingVars.length === 0,
      missingVars
    };
  }

  /**
   * Get all loaded environment variables (for debugging)
   */
  public getLoadedVars(): Record<string, string> {
    // Return a safe copy without sensitive data
    const safeCopy: Record<string, string> = {};
    for (const [key, value] of Object.entries(this.envVars)) {
      if (key.includes('KEY') || key.includes('SECRET')) {
        safeCopy[key] = value ? '[REDACTED]' : '';
      } else {
        safeCopy[key] = value;
      }
    }
    return safeCopy;
  }
}
