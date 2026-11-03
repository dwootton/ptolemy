/**
 * Feature flags for conditional compilation in the webview
 * This module provides runtime feature flags based on build-time environment variables
 */


export class FeatureFlags {
  /**
   * Check if study mode features are enabled
   * This is set at build time via VITE_STUDY_MODE environment variable
   */
  public static get STUDY_MODE_ENABLED(): boolean {
    // Study UI is included only when explicitly requested by the build.
    const envVal = import.meta.env.VITE_STUDY_MODE;
    if (String(envVal).toLowerCase() !== 'true') return false;
    const localDisable = typeof window !== 'undefined' && window.localStorage.getItem('meridian.studyMode.disable') === 'true';
    if (localDisable) return false;
    return true;
  }

  /**
   * Check if we're in development mode
   */
  public static get DEV_MODE(): boolean {
    return import.meta.env.DEV;
  }

  /**
   * Freeze analet dragging on the analysis map/canvas.
   * Defaults to false to allow drag & drop; can be forced ON via localStorage.
   * Set localStorage key 'meridian.drag.freeze' to 'true' to disable dragging.
   */
  public static get FREEZE_ANALET_DRAG(): boolean {
    try {
      const override = typeof window !== 'undefined' && window.localStorage.getItem('meridian.drag.freeze');
      if (override != null) return String(override).toLowerCase() === 'true';
    } catch {}
    return false; // default: dragging enabled
  }

  /**
   * Freeze analet drag-and-drop in the list view and enable anchored-notes mode.
   * Drag freeze defaults to false to re-enable list DnD; can be forced ON via localStorage.
   * - Set 'meridian.list.drag.freeze' to 'true' to disable analet/bearing DnD
   * - Set 'meridian.list.anchored' to 'false' to disable anchored notes behavior
   */
  public static get LIST_FREEZE_ANALET_DND(): boolean {
    try {
      const override = typeof window !== 'undefined' && window.localStorage.getItem('meridian.list.drag.freeze');
      if (override != null) return String(override).toLowerCase() === 'true';
    } catch {}
    return false; // default: DnD enabled in list
  }

  public static get LIST_ANCHORED_NOTES(): boolean {
    try {
      const override = typeof window !== 'undefined' && window.localStorage.getItem('meridian.list.anchored');
      if (override != null) return String(override).toLowerCase() !== 'false';
    } catch {}
    return true;
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
