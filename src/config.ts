import * as vscode from 'vscode';

export interface ExtensionConfig {
  // Add configuration properties here as needed
  debugMode: boolean;
}

export class ConfigManager {
  private static instance: ConfigManager;
  private config: vscode.WorkspaceConfiguration;

  private constructor() {
    this.config = vscode.workspace.getConfiguration('meridian');
  }

  public static getInstance(): ConfigManager {
    if (!ConfigManager.instance) {
      ConfigManager.instance = new ConfigManager();
    }
    return ConfigManager.instance;
  }

  public getConfig(): ExtensionConfig {
    return {
      debugMode: this.config.get<boolean>('debugMode', false),
    };
  }

  public get<T>(key: string, defaultValue: T): T {
    return this.config.get<T>(key, defaultValue);
  }

  public async update(key: string, value: any, target?: vscode.ConfigurationTarget): Promise<void> {
    await this.config.update(key, value, target);
  }

  public refresh(): void {
    this.config = vscode.workspace.getConfiguration('meridian');
  }
} 