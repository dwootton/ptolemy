/**
 * Hook for managing map notes - notes that are positioned directly on the analysis map
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { AnalysisNote } from '../../../types/analet';
import { useMessageHandler } from '../../../hooks/useMessageHandler';

export interface UseMapNotesReturn {
  mapNotes: AnalysisNote[];
  allNotes: AnalysisNote[]; // Add allNotes to access analet notes too
  selectedNoteId: number | null;
  setSelectedNoteId: (id: number | null) => void;
  createMapNote: (content: string, position: { x: number; y: number }) => Promise<void>;
  updateMapNote: (note: AnalysisNote) => Promise<void>;
  deleteMapNote: (noteId: number) => Promise<void>;
  moveMapNote: (noteId: number, position: { x: number; y: number }) => Promise<void>;
}

export function useMapNotes(): UseMapNotesReturn {
  const [allNotes, setAllNotes] = useState<AnalysisNote[]>([]);
  const [selectedNoteId, setSelectedNoteId] = useState<number | null>(null);
  const { sendMessage, onMessage } = useMessageHandler();

  // Filter to only map notes (notes with position and no parentId)
  const mapNotes = useMemo(() => {
    const filtered = allNotes.filter(note => 
      note.position && 
      !note.parentId && 
      note.status === 'active'
    );
    return filtered;
  }, [allNotes]);

  // Load notes on mount
  useEffect(() => {
    sendMessage('get-analysis-notes');
  }, [sendMessage]);

  // Listen for notes updates
  useEffect(() => {
    const handleNotesUpdated = (event: CustomEvent) => {
      const { notes } = event.detail;
      if (Array.isArray(notes)) {
        setAllNotes(notes);
      }
    };

    window.addEventListener('analysisNotesUpdated', handleNotesUpdated as EventListener);
    
    return () => {
      window.removeEventListener('analysisNotesUpdated', handleNotesUpdated as EventListener);
    };
  }, []);

  // Also hydrate from broader note messages used by analysis list
  useEffect(() => {
    const onLoaded = onMessage('analysis-notes-loaded', (data: any) => {
      if (Array.isArray(data?.notes)) {
        setAllNotes(data.notes);
      }
    });

    const onCreated = onMessage('analysis-note-created', (data: any) => {
      if (data?.note) {
        setAllNotes(prev => [...prev, data.note]);
      }
    });

    return () => { onLoaded(); onCreated(); };
  }, [onMessage]);

  // React to backend-driven notes updates and deletions (e.g., purge clears all)
  useEffect(() => {
    const onUpdated = onMessage('analysis-notes-updated', (data: any) => {
      if (Array.isArray(data?.notes)) {
        setAllNotes(data.notes);
        // Keep window event consumers in sync
        try {
          window.dispatchEvent(new CustomEvent('analysisNotesUpdated', {
            detail: { notes: data.notes }
          }));
        } catch {}
      }
    });

    const onDeleted = onMessage('analysis-note-deleted', (data: any) => {
      const id = data?.noteId;
      if (typeof id === 'number') {
        setAllNotes(prev => prev.filter(n => n.id !== id));
      }
    });

    return () => { onUpdated(); onDeleted(); };
  }, [onMessage]);

  // Summary diagnostics for analet-attached notes
  useEffect(() => {
    // const analetAttachedCount = allNotes.filter(n => typeof n.parentId === 'string' && n.parentId.startsWith('analet-')).length;
  }, [allNotes]);

  // Listen for individual note updates
  useEffect(() => {
    const cleanup = onMessage('analysis-note-updated', (data: any) => {
      if (data?.note) {
        setAllNotes(prev => {
          const updated = prev.map(n => n.id === data.note.id ? data.note : n);
          return updated;
        });
      }
    });

    return cleanup;
  }, [onMessage]);

  // Listen for note creation responses - removed duplicate handling
  // The analysis-notes-updated message from backend already updates the global state
  // This prevents duplicate notes from appearing

  const createMapNote = useCallback(async (content: string, position: { x: number; y: number }) => {
    await sendMessage('create-map-note', {
      content,
      position,
      type: 'note',
      status: 'active',
    });
  }, [sendMessage]);

  const updateMapNote = useCallback(async (note: AnalysisNote) => {
    await sendMessage('update-analysis-note', {
      id: note.id,
      content: note.content,
      position: note.position,
    });

    // Update local state optimistically
    setAllNotes(prev => prev.map(n => n.id === note.id ? note : n));
  }, [sendMessage]);

  const deleteMapNote = useCallback(async (noteId: number) => {
    await sendMessage('delete-analysis-note', { id: noteId });
    
    // Update local state optimistically
    setAllNotes(prev => prev.filter(n => n.id !== noteId));
    
    if (selectedNoteId === noteId) {
      setSelectedNoteId(null);
    }
  }, [sendMessage, selectedNoteId]);

  const moveMapNote = useCallback(async (noteId: number, position: { x: number; y: number }) => {
    const note = allNotes.find(n => n.id === noteId);
    if (!note) return;

    const updatedNote = { ...note, position };
    await updateMapNote(updatedNote);
  }, [allNotes, updateMapNote]);

  return {
    mapNotes,
    allNotes,  // Add allNotes to the return
    selectedNoteId,
    setSelectedNoteId,
    createMapNote,
    updateMapNote,
    deleteMapNote,
    moveMapNote,
  };
}
