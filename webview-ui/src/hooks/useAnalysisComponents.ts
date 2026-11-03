import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnalysisComponent, Analet, Bearing, AnalysisNote, isMaterializedAnalet } from '../types/analet';
import { MessageService } from '../services/MessageService';
import { StateService } from '../services/StateService';
import { BearingStateService } from '../services/BearingStateService';
import { AnaletStateService } from '../services/AnaletStateService';

export interface UseAnalysisComponentsReturn {
  components: AnalysisComponent[];
  visible: AnalysisComponent[];
  trainingSet: AnalysisComponent[];
  updateLocation: (component: AnalysisComponent, x: number, y: number) => void;
}

export function useAnalysisComponents(): UseAnalysisComponentsReturn {
  const stateService = StateService.getInstance();
  const analetState = AnaletStateService.getInstance();
  const bearingState = BearingStateService.getInstance();

  const [analets, setAnalets] = useState<Analet[]>([]);
  const [bearings, setBearings] = useState<Bearing[]>([]);
  const [notes, setNotes] = useState<AnalysisNote[]>([]);

  // Load from services
  useEffect(() => {
    setAnalets(stateService.getAvailableAnalets());
    // Prefer StateService bearings (single source of truth), fallback to BearingStateService if needed
    const currentBearings = stateService.getBearings ? stateService.getBearings() : bearingState.getBearings();
    setBearings(currentBearings);

    // Request initial notes from backend
    const messageService = MessageService.getInstance();
    messageService.sendMessage('get-analysis-notes');

    const onAnaletsUpdated = () => setAnalets(stateService.getAvailableAnalets());
    const onBearingsUpdated = () => {
      // Pull from both sources and merge by id to avoid stale divergence
      const primary = stateService.getBearings ? stateService.getBearings() : [];
      const secondary = bearingState.getBearings();
      const mergedMap = new Map<number, Bearing>();
      primary.forEach(b => mergedMap.set(b.id, b));
      secondary.forEach(b => {
        const existing = mergedMap.get(b.id);
        mergedMap.set(b.id, { ...b, ...(existing || {}) });
      });
      const merged = Array.from(mergedMap.values());
      setBearings(merged);
    };

    const onNotesLoaded = (e: any) => {
      const data = e?.detail || {};
      if (Array.isArray(data.notes)) setNotes(data.notes);
    };
    const onNotesUpdated = (e: any) => {
      const data = e?.detail || {};
      if (Array.isArray(data.notes)) setNotes(data.notes);
    };
    const onNoteCreated = (e: any) => {
      const data = e?.detail || {};
      if (data?.note) setNotes(prev => [...prev, data.note]);
    };
    const onNoteDeleted = (data: any) => {
      const id = data?.noteId;
      if (typeof id === 'number') setNotes(prev => prev.filter(n => n.id !== id));
    };
    const onNoteUpdated = (data: any) => {
      const note = data?.note as AnalysisNote | undefined;
      if (note) setNotes(prev => prev.map(n => n.id === note.id ? note : n));
    };

    window.addEventListener('analetsUpdated', onAnaletsUpdated);
    window.addEventListener('bearingsUpdated', onBearingsUpdated);
    window.addEventListener('analysisNotesUpdated', onNotesUpdated as any);
    window.addEventListener('analysisNoteCreated', onNoteCreated as any);
    const offLoaded = messageService.onMessage('analysis-notes-loaded', onNotesLoaded);
    const offUpdated = messageService.onMessage('analysis-notes-updated', onNoteUpdated);
    const offDeleted = messageService.onMessage('analysis-note-deleted', onNoteDeleted);
    const offNoteUpdated = messageService.onMessage('analysis-note-updated', onNoteUpdated);

    const onBearingEmbeddingGenerated = (_e: any) => {
      // Trigger reload from service/state
      const b = stateService.getBearings ? stateService.getBearings() : bearingState.getBearings();
      setBearings(b);
    };
    window.addEventListener('bearing-embedding-generated', onBearingEmbeddingGenerated as any);
    return () => {
      window.removeEventListener('analetsUpdated', onAnaletsUpdated);
      window.removeEventListener('bearingsUpdated', onBearingsUpdated);
      window.removeEventListener('analysisNotesUpdated', onNotesUpdated as any);
      window.removeEventListener('analysisNoteCreated', onNoteCreated as any);
      window.removeEventListener('bearing-embedding-generated', onBearingEmbeddingGenerated as any);
      offLoaded();
      offUpdated();
      offDeleted();
      offNoteUpdated();
    };
  }, [stateService, bearingState]);

  const components: AnalysisComponent[] = useMemo(() => {
    const a = analets.map(a => ({ kind: 'analet' as const, entity: a }));
    const b = bearings.map(b => ({ kind: 'bearing' as const, entity: b }));
    const n = notes.map(n => ({ kind: 'note' as const, entity: n }));
    // Strategic debug: detect title/embedding changes
    try {
      void analets.slice(0, 5).map(a => ({ id: a.id, q: a.statement, elen: a.embedding?.length || 0, ehead: (a.embedding || []).slice(0, 3) }));
    } catch {}
    return [...a, ...b, ...n];
  }, [analets, bearings, notes]);

  // Visible excludes non-materialized analets; bearings and notes always visible
  const visible = useMemo(() => {
    return components.filter(c => 
      c.kind === 'bearing' || 
      c.kind === 'note' || 
      isMaterializedAnalet(c.entity as Analet)
    );
  }, [components]);

  // Training set includes anything with an embedding: framing analets and bearings included
  const trainingSet = useMemo(() => {
    return components.filter(c => {
      // Notes don't have embeddings
      if (c.kind === 'note') return false;
      const entity = c.entity as Analet | Bearing;
      return Array.isArray(entity.embedding) && (entity.embedding?.length || 0) > 0;
    });
  }, [components]);

  const updateLocation = useCallback((component: AnalysisComponent, x: number, y: number) => {
    if (component.kind === 'analet') {
      const analet = component.entity as Analet;
      const updated: Analet = { ...analet, location: { ...(analet.location || {}), x, y } };
      // StateService does not expose updateAnalet; use AnaletStateService
      analetState.updateAnalet(updated);
      // Emit event to notify subscribers without forcing App re-render
      window.dispatchEvent(new CustomEvent('analetsUpdated'));
    } else if (component.kind === 'bearing') {
      const bearing = component.entity as Bearing;
      const updated: Bearing = { ...bearing, location: { ...(bearing.location || {}), x, y } };
      // StateService.updateBearing signature differs; use BearingStateService here
      bearingState.updateBearing(updated);
      window.dispatchEvent(new CustomEvent('bearingsUpdated'));
    }
    // Notes don't have locations, so we ignore them
  }, [stateService, analetState, bearingState]);

  return { components, visible, trainingSet, updateLocation };
}

// Helper to adapt union to analet-like items for UMAP training
export function componentsToAnaletsForTraining(trainingSet: AnalysisComponent[]): Analet[] {
  return trainingSet
    .filter(c => c.kind !== 'note') // Filter out notes as they don't have embeddings
    .map(c => {
      if (c.kind === 'analet') return c.entity as Analet;
      // Synthesize minimal analet-like shape for bearings
      const b = c.entity as Bearing;
      return {
        id: Number(`9${b.id}`), // avoid collision; synthetic id space
        statement: b.statement,
        embedding: b.embedding,
        type: 'framing',
        source: 'explorer',
        location: b.location,
        tags: b.tags,
      } as Analet;
    });
}


