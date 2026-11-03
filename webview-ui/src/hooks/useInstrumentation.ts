import { useCallback, useEffect, useRef } from 'react';
import { TelemetryService } from '../services/TelemetryService';

export interface InstrumentationHookOptions {
  category: 'analysis_map' | 'filter' | 'dataset_dictionary' | 'analysis_list' | 'settings' | 'general';
  enableHoverTracking?: boolean;
  debounceMs?: number;
}

export function useInstrumentation(options: InstrumentationHookOptions) {
  const telemetryService = TelemetryService.getInstance();
  const hoverTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastEventRef = useRef<{ action: string; timestamp: number } | null>(null);

  // Track interaction events
  const trackInteraction = useCallback((action: string, details: Record<string, any> = {}) => {
    // Simple debouncing to prevent duplicate events
    const now = Date.now();
    if (lastEventRef.current && 
        lastEventRef.current.action === action && 
        now - lastEventRef.current.timestamp < (options.debounceMs || 100)) {
      return;
    }

    lastEventRef.current = { action, timestamp: now };

    telemetryService.recordInstrumentationEvent({
      eventType: 'interaction',
      category: options.category,
      action,
      details: {
        ...details,
        url: window.location.href,
        userAgent: navigator.userAgent,
        timestamp: now
      }
    });
  }, [options.category, options.debounceMs, telemetryService]);

  // Track click events
  const trackClick = useCallback((target: string, details: Record<string, any> = {}) => {
    trackInteraction('click', {
      target,
      ...details
    });
  }, [trackInteraction]);

  // Track hover events
  const trackHover = useCallback((target: string, details: Record<string, any> = {}) => {
    if (!options.enableHoverTracking) return;

    trackInteraction('hover', {
      target,
      ...details
    });
  }, [trackInteraction, options.enableHoverTracking]);

  // Track hover start with duration tracking
  const trackHoverStart = useCallback((target: string, details: Record<string, any> = {}) => {
    if (!options.enableHoverTracking) return;

    // Clear any existing timer
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
    }

    const startTime = Date.now();
    
    // Set a timer to track hover duration
    hoverTimerRef.current = setTimeout(() => {
      trackInteraction('hover_duration', {
        target,
        duration: Date.now() - startTime,
        ...details
      });
    }, 1000); // Track hovers longer than 1 second
  }, [trackInteraction, options.enableHoverTracking]);

  // Track hover end
  const trackHoverEnd = useCallback(() => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
  }, []);

  // Track drag operations
  const trackDragStart = useCallback((target: string, position: { x: number; y: number }, details: Record<string, any> = {}) => {
    trackInteraction('drag_start', {
      target,
      startPosition: position,
      ...details
    });
  }, [trackInteraction]);

  const trackDragEnd = useCallback((target: string, startPosition: { x: number; y: number }, endPosition: { x: number; y: number }, details: Record<string, any> = {}) => {
    const distance = Math.sqrt(
      Math.pow(endPosition.x - startPosition.x, 2) + 
      Math.pow(endPosition.y - startPosition.y, 2)
    );

    trackInteraction('drag_end', {
      target,
      startPosition,
      endPosition,
      distance,
      ...details
    });
  }, [trackInteraction]);

  // Track input changes (for filters, search boxes, etc.)
  const trackInputChange = useCallback((inputType: string, value: string, details: Record<string, any> = {}) => {
    trackInteraction('input_change', {
      inputType,
      valueLength: value.length,
      hasValue: value.length > 0,
      ...details
    });
  }, [trackInteraction]);

  // Track focus events
  const trackFocus = useCallback((target: string, details: Record<string, any> = {}) => {
    trackInteraction('focus', {
      target,
      ...details
    });
  }, [trackInteraction]);

  // Track navigation events
  const trackNavigation = useCallback((action: string, details: Record<string, any> = {}) => {
    telemetryService.recordInstrumentationEvent({
      eventType: 'navigation',
      category: options.category,
      action,
      details: {
        ...details,
        url: window.location.href,
        timestamp: Date.now()
      }
    });
  }, [telemetryService, options.category]);

  // Track UI state changes
  const trackUIStateChange = useCallback((action: string, details: Record<string, any> = {}) => {
    telemetryService.recordInstrumentationEvent({
      eventType: 'ui_state',
      category: options.category,
      action,
      details: {
        ...details,
        timestamp: Date.now()
      }
    });
  }, [telemetryService, options.category]);

  // Track performance events
  const trackPerformance = useCallback((action: string, details: Record<string, any> = {}) => {
    telemetryService.recordInstrumentationEvent({
      eventType: 'performance',
      category: options.category,
      action,
      details: {
        ...details,
        timestamp: Date.now()
      }
    });
  }, [telemetryService, options.category]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (hoverTimerRef.current) {
        clearTimeout(hoverTimerRef.current);
      }
    };
  }, []);

  return {
    trackInteraction,
    trackClick,
    trackHover,
    trackHoverStart,
    trackHoverEnd,
    trackDragStart,
    trackDragEnd,
    trackInputChange,
    trackFocus,
    trackNavigation,
    trackUIStateChange,
    trackPerformance,
    isInstrumentationActive: telemetryService.isInstrumentationActive()
  };
}

// Specialized hooks for different components
export function useAnalysisMapInstrumentation() {
  return useInstrumentation({
    category: 'analysis_map',
    enableHoverTracking: true,
    debounceMs: 50
  });
}

export function useFilterInstrumentation() {
  return useInstrumentation({
    category: 'filter',
    debounceMs: 300 // Longer debounce for text input
  });
}

export function useDatasetDictionaryInstrumentation() {
  return useInstrumentation({
    category: 'dataset_dictionary',
    enableHoverTracking: true,
    debounceMs: 100
  });
}

export function useAnalysisListInstrumentation() {
  return useInstrumentation({
    category: 'analysis_list',
    enableHoverTracking: true,
    debounceMs: 100
  });
}

export function useSettingsInstrumentation() {
  return useInstrumentation({
    category: 'settings',
    debounceMs: 200
  });
}
