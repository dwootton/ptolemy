/**
 * Feature flags for conditional compilation
 * This module provides runtime feature flags based on build-time environment variables
 */

import * as vscode from 'vscode';

export class FeatureFlags {
  /**
   * Check if study mode features are enabled
   * This is set at build time via STUDY_MODE environment variable
   */
  public static get STUDY_MODE_ENABLED(): boolean {
    // Study builds are explicit; existing settings and environment opt-outs still apply.
    try {
      const cfg = vscode.workspace.getConfiguration('meridian');
      const disabled = cfg.get<boolean>('disableStudyMode', false) === true;
      if (disabled) return false;
    } catch {}
    if (process.env.DISABLE_STUDY_MODE === 'true') return false;
    return process.env.STUDY_MODE === 'true';
  }

  /**
   * Check if we're in development mode
   */
  public static get DEV_MODE(): boolean {
    return process.env.NODE_ENV === 'development';
  }

  /**
   * Log feature flag status (for debugging)
   */
  public static logStatus(): void {

  }
}

// Auto-log in development
if (FeatureFlags.DEV_MODE) {
  FeatureFlags.logStatus();
}
