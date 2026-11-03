import { useState, useEffect, useCallback, useRef } from "react";
import { Analet } from "../../types/analet";
import { SessionStateService } from "../../services/SessionStateService";

interface UseAnaletDataProps {
  sendMessage: (type: string, data: any) => void;
  onMessage: (type: string, handler: (data: any) => void) => void;
  setUsingMockData: (value: boolean) => void;
}

interface UseAnaletDataReturn {
  analets: Analet[];
  loadingState: 'idle' | 'connecting' | 'generating' | 'processing' | 'loading-cache';
  requestAnaletData: (forceGenerate?: boolean) => void;
  getLoadingMessage: () => string;
}

export function useAnaletData(props: UseAnaletDataProps): UseAnaletDataReturn {
  const [analets, setAnalets] = useState<Analet[]>([]);
  const [loadingState, setLoadingState] = useState<'idle' | 'connecting' | 'generating' | 'processing' | 'loading-cache'>('idle');

  // Use refs to track request state and prevent duplicate calls
  const activeRequestRef = useRef<string | null>(null);
  const loadingStateRef = useRef<'idle' | 'connecting' | 'generating' | 'processing' | 'loading-cache'>('idle');
  const sessionCheckedRef = useRef<boolean>(false);

  // Update ref when state changes
  useEffect(() => {
    loadingStateRef.current = loadingState;
  }, [loadingState]);

  // Setup message listeners using useEffect
  useEffect(() => {
    const analetsDataHandler = (data: { analets: Analet[]; usingMockData?: boolean; loadedFromCache?: boolean; success?: boolean; newAnaletsCount?: number; promotedFromFraming?: boolean }) => {

      try {
        console.log('[framing][webview] fetch-analet-data received', {
          count: (data.analets || []).length,
          loadedFromCache: !!data.loadedFromCache,
          promotedFromFraming: !!(data as any).promotedFromFraming,
          newAnaletsCount: (data as any).newAnaletsCount
        });
      } catch {}
      // Debug: Check if analets have embeddings
      if (data.analets && data.analets.length > 0) {
        const analetsWithEmbeddings = data.analets.filter((a: any) => a.embedding && a.embedding.length > 0);
        if (analetsWithEmbeddings.length === 0) {
          console.warn('⚠️ [useAnaletData] NO ANALETS HAVE EMBEDDINGS - UMAP will not work!');
        }
      }

      props.setUsingMockData(data.usingMockData || false);
      setAnalets(data.analets || []);

      // Persist to session state for future sessions
      if (data.analets && data.analets.length > 0) {
        const sessionService = SessionStateService.getInstance();
        sessionService.setAnalets(data.analets);
      }

      // Always set idle on any fetch-analet-data to avoid UI being stuck if status is missed
      setLoadingState('idle');
      activeRequestRef.current = null;
    };

    const analysisStatusHandler = (data: { state: 'connecting' | 'generating' | 'processing' | 'loading-cache' | 'idle' }) => {
      try { console.log('[framing][webview] analysis-status', data.state); } catch {}
      setLoadingState(data.state);

      // Clear active request when backend signals completion
      if ((data as any).state === 'idle') {
        activeRequestRef.current = null;
      }
    };

    const cacheLoadingStatusHandler = (data: { state: 'loading-cache' | 'cache-found' | 'cache-empty' }) => {
      try { console.log('[framing][webview] cache-loading-status', data.state); } catch {}
      if (data.state === 'loading-cache') {
        setLoadingState('loading-cache');
      } else if (data.state === 'cache-empty') {
        // Cache is empty, proceed with generation
        setLoadingState('connecting');
      }
    };

    const off1 = props.onMessage('fetch-analet-data', analetsDataHandler) as unknown as (() => void) | void;
    const off2 = props.onMessage('analysis-status', analysisStatusHandler) as unknown as (() => void) | void;
    const off3 = props.onMessage('cache-loading-status', cacheLoadingStatusHandler) as unknown as (() => void) | void;

    return () => {
      try { if (typeof off1 === 'function') off1(); } catch {}
      try { if (typeof off2 === 'function') off2(); } catch {}
      try { if (typeof off3 === 'function') off3(); } catch {}
    };
  }, [props.onMessage]);

  // Check session state for cached analets on mount
  useEffect(() => {
    if (sessionCheckedRef.current) return;

    const sessionService = SessionStateService.getInstance();
    const sessionAnalets = sessionService.getAnalets();

    if (sessionAnalets.length > 0) {
      setAnalets(sessionAnalets);
      setLoadingState('idle');

      // Also sync them back to session in case they need updating
      sessionService.setAnalets(sessionAnalets);
    }

    sessionCheckedRef.current = true;
  }, []);

  // Memoize requestAnaletData with proper dependency management
  const requestAnaletData = useCallback((forceGenerate: boolean = false) => {
    try {
      // Study guard: if we already have analets in study mode, do not trigger backend generation
      const { StudyConfigurationService } = require('../../services/StudyConfigurationService');
      const studySvc = StudyConfigurationService.getInstance();
      const isStudy = studySvc.isStudyMode ? studySvc.isStudyMode() : (studySvc.getConfiguration?.()?.isStudyMode === true);
      if (isStudy) {
        const { StateService } = require('../../services/StateService');
        const svc = StateService.getInstance();
        const haveAnalets = (svc.getAvailableAnalets() || []).length > 0;
        if (haveAnalets && !forceGenerate) {
          try { console.log('[framing][webview] study guard: skip generate (analets exist)'); } catch {}
          return;
        }
      }
    } catch {}
    const callId = Math.random().toString(36).substr(2, 9);
    // Check if we already have an active request
    if (activeRequestRef.current) {
      try { console.log('[framing][webview] requestAnaletData skipped; active request in-flight'); } catch {}
      return;
    }

    // Check if we're already loading using the ref (current state)
    if (loadingStateRef.current !== 'idle') {
      try { console.log('[framing][webview] requestAnaletData skipped; loadingStateRef=', loadingStateRef.current); } catch {}
      return;
    }

    try {
      // Set active request
      activeRequestRef.current = callId;
      try { console.log('[framing][webview] requestAnaletData -> generate-analyses', { forceGenerate, callId }); } catch {}
      // Dataset context is now handled in the backend
      const messageData = { forceGenerate };

      if (forceGenerate) {
        // Skip cache check and generate fresh data
        setLoadingState('connecting');
        props.sendMessage('generate-analyses', messageData);
      } else {
        // Try to load from cache first
        setLoadingState('loading-cache');
        props.sendMessage('generate-analyses', messageData);
      }
    } catch (error) {
      console.error(`❌ [useAnaletData] Error requesting analet data - ID: ${callId}:`, error);
      setLoadingState('idle');
      activeRequestRef.current = null;
    }
  }, [props.sendMessage]); // Keep stable dependency

  // Memoize getLoadingMessage to prevent unnecessary re-renders
  const getLoadingMessage = useCallback(() => {
    switch (loadingState) {
      case 'loading-cache':
        return 'Loading from workspace state...';
      case 'connecting':
        return 'Connecting to OpenAI...';
      case 'generating':
        return 'Generating analyses...';
      case 'processing':
        return 'Processing results...';
      default:
        return '';
    }
  }, [loadingState]);

  return {
    analets,
    loadingState,
    requestAnaletData,
    getLoadingMessage
  };
}
