import * as vscode from 'vscode';
import { EnvironmentService } from '../services/EnvironmentService';

/**
 * Securely retrieves the OpenAI API key from environment or VS Code settings.
 * Shows user-friendly error messages with actionable instructions if key is missing.
 *
 * @returns The OpenAI API key or undefined if not available
 */
export function getOpenAIKey(): string | undefined {
  const key = EnvironmentService.getInstance().getOpenAIApiKey();
  if (key) return key;

  // No API key found - show appropriate error message based on environment
  if (isCodespaces()) {
    vscode.window.showErrorMessage(
      'Missing OpenAI API key. In GitHub Codespaces, add a personal secret named OPENAI_API_KEY. ' +
      'Go to GitHub → Settings → Codespaces → Repository access → Select this repo → New secret. ' +
      'Then reload VS Code window (Developer: Reload Window).',
      'Open Codespaces Secrets'
    ).then(selection => {
      if (selection === 'Open Codespaces Secrets') {
        vscode.env.openExternal(vscode.Uri.parse('https://github.com/settings/codespaces'));
      }
    });
  } else {
    vscode.window.showErrorMessage(
      'Missing OpenAI API key. Please set it in VS Code settings (meridian.openaiApiKey) or ' +
      'add OPENAI_API_KEY to your environment variables. Get your key from https://platform.openai.com/api-keys',
      'Open Settings'
    ).then(selection => {
      if (selection === 'Open Settings') {
        vscode.commands.executeCommand('workbench.action.openSettings', 'meridian.openaiApiKey');
      }
    });
  }

  return undefined;
}

/**
 * Detects if the extension is running in GitHub Codespaces
 */
function isCodespaces(): boolean {
  return !!(
    process.env.CODESPACES ||
    process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN ||
    process.env.CODESPACE_NAME
  );
}

/**
 * Validates that an API key has the expected OpenAI format
 * @param key The API key to validate
 * @returns true if the key appears to be a valid OpenAI key format
 */
export function isValidApiKeyFormat(key: string): boolean {
  // Use a basic sanity check; the API determines whether the key is valid.
  return key.length >= 20 && key.startsWith('sk-');
}

/**
 * Test the API key by making a minimal request to OpenAI
 * @param key The API key to test
 * @returns Promise that resolves to true if key works, false otherwise
 */
export async function testApiKey(key: string): Promise<boolean> {
  try {
    const { NewOpenAIService } = await import('../services/llm/NewOpenAIService');
    const openaiService = NewOpenAIService.getInstance(key);
    return await openaiService.testConnection();
  } catch {
    console.error('[OpenAI] API key test failed.');
    return false;
  }
}
