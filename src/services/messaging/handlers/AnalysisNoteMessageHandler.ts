/**
 * AnalysisNoteMessageHandler - Handles all analysis note-related operations
 * Provides CRUD operations for text-based analysis notes
 */

import { BaseMessageHandler } from '../BaseMessageHandler';
import { MessageContext } from '../types';
import { AnalysisNote } from '../../../types/analet';

export class AnalysisNoteMessageHandler extends BaseMessageHandler {
  private notes: AnalysisNote[] = [];
  private nextNoteId: number = 1;

  constructor() {
    super([
      'create-analysis-note',
      'update-analysis-note',
      'delete-analysis-note',
      'get-analysis-notes',
      'restore-analysis-note',
      'create-note-from-cell',
      'create-note',
      'create-blank-note',
      'create-map-note',
      'clear-all-notes'
    ]);
  }

  public async initialize(context: MessageContext): Promise<void> {
    await super.initialize(context);
    await this.loadNotesFromState();
    this.log('info', 'Initialized AnalysisNoteMessageHandler');
  }

  public async handle(messageType: string, data: any, context: MessageContext): Promise<void> {
    const timestamp = Date.now();
    const handlerId = `handler-${timestamp}-${Math.random().toString(36).substr(2, 9)}`;
    try {
      switch (messageType) {
        case 'create-analysis-note':
          await this.handleCreateNote(data);
          break;
        case 'update-analysis-note':
          await this.handleUpdateNote(data);
          break;
        case 'delete-analysis-note':
          await this.handleDeleteNote(data);
          break;
        case 'get-analysis-notes':
          await this.handleGetNotes(data);
          break;
        case 'restore-analysis-note':
          await this.handleRestoreNote(data);
          break;
        case 'create-note-from-cell':
          await this.handleCreateNoteFromCell(data);
          break;
        case 'create-note':
          await this.handleCreateBlankNote(data);
          break;
        case 'create-blank-note':
          await this.handleCreateBlankNoteOnly(data);
          break;
        case 'create-map-note':
          await this.handleCreateMapNote(data);
          break;
        case 'clear-all-notes':
          await this.handleClearAllNotes(data);
          break;
        default:
          throw new Error(`Unknown message type: ${messageType}`);
      }
    } catch (error) {
      console.error('[msg-receive] AnalysisNoteMessageHandler.handle error:', { handlerId, messageType, error });
      await this.sendError(messageType, error instanceof Error ? error : 'Unknown error', data);
    }
  }

  private async handleCreateNote(data: any): Promise<void> {
    const validation = this.validateData(data, ['content']);
    if (!validation.isValid) {
      throw new Error(validation.error);
    }

    const typeValidation = this.validateTypes(data, [
      { field: 'content', type: 'string' },
      { field: 'tags', type: 'object', optional: true },
      { field: 'parentId', type: 'string', optional: true },
      { field: 'anchor', type: 'object', optional: true }
    ]);
    if (!typeValidation.isValid) {
      throw new Error(typeValidation.error);
    }

    const now = new Date().toISOString();
    const note: AnalysisNote = {
      id: this.nextNoteId++,
      content: data.content.trim(),
      type: 'note',
      status: 'active',
      createdAt: now,
      updatedAt: now,
      tags: data.tags || [],
      parentId: data.parentId,
      anchor: data.anchor
    };

    this.notes.push(note);
    await this.saveNotesToState();

    this.log('info', `Created analysis note: ${note.content.substring(0, 50)}...`);
    await this.sendMessage('analysis-note-created', { note });
    await this.sendMessage('analysis-notes-updated', { notes: this.getActiveNotes() });
  }

  private async handleUpdateNote(data: any): Promise<void> {
    const validation = this.validateData(data, ['id']);
    if (!validation.isValid) {
      throw new Error(validation.error);
    }

    const note = this.notes.find(n => n.id === data.id && n.status === 'active');
    if (!note) {
      throw new Error(`Analysis note not found: ${data.id}`);
    }

    // Update fields if provided
    if (data.content !== undefined) {
      note.content = data.content.trim();
    }
    if (data.anchor !== undefined) {
      // Shallow merge anchor object
      note.anchor = {
        ...(note.anchor || {}),
        ...(data.anchor || {})
      } as any;
    }
    if (data.tags !== undefined) {
      note.tags = data.tags;
    }
    if (data.parentId !== undefined) {
      note.parentId = data.parentId;
    }

    note.updatedAt = new Date().toISOString();
    await this.saveNotesToState();

    this.log('info', `Updated analysis note: ${note.content.substring(0, 50)}...`);
    await this.sendMessage('analysis-note-updated', { note });
    await this.sendMessage('analysis-notes-updated', { notes: this.getActiveNotes() });
  }

  private async handleDeleteNote(data: any): Promise<void> {
    const validation = this.validateData(data, ['id']);
    if (!validation.isValid) {
      throw new Error(validation.error);
    }

    const note = this.notes.find(n => n.id === data.id && n.status === 'active');
    if (!note) {
      throw new Error(`Analysis note not found: ${data.id}`);
    }

    note.status = 'deleted';
    note.updatedAt = new Date().toISOString();
    await this.saveNotesToState();

    this.log('info', `Deleted analysis note: ${note.id}`);
    await this.sendMessage('analysis-note-deleted', { noteId: note.id });
    await this.sendMessage('analysis-notes-updated', { notes: this.getActiveNotes() });
  }

  private async handleGetNotes(data: any): Promise<void> {
    const activeNotes = this.getActiveNotes();
    await this.sendMessage('analysis-notes-loaded', { notes: activeNotes });
  }

  private async handleRestoreNote(data: any): Promise<void> {
    const validation = this.validateData(data, ['id']);
    if (!validation.isValid) {
      throw new Error(validation.error);
    }

    const note = this.notes.find(n => n.id === data.id && n.status === 'deleted');
    if (!note) {
      throw new Error(`Deleted analysis note not found: ${data.id}`);
    }

    note.status = 'active';
    note.updatedAt = new Date().toISOString();
    await this.saveNotesToState();

    this.log('info', `Restored analysis note: ${note.id}`);
    await this.sendMessage('analysis-note-restored', { note });
    await this.sendMessage('analysis-notes-updated', { notes: this.getActiveNotes() });
  }

  private async handleCreateNoteFromCell(data: any): Promise<void> {
    const validation = this.validateData(data, ['notebookPath', 'cellIndex']);
    if (!validation.isValid) {
      throw new Error(validation.error);
    }
    // First try to get currently selected analet from webview
    let parentAnalet = await this.getCurrentlySelectedAnalet();
    // If no current selection, fall back to finding analet associated with this cell
    if (!parentAnalet) {
      parentAnalet = await this.findAnaletForCell(data.notebookPath, data.cellIndex);
    }

    const now = new Date().toISOString();
    const note: AnalysisNote = {
      id: this.nextNoteId++,
      content: '', // Start with blank content as requested
      type: 'note',
      status: 'active',
      createdAt: now,
      updatedAt: now,
      tags: parentAnalet ? ['from-cell'] : ['from-cell', 'orphaned'],
      parentId: parentAnalet ? `analet-${parentAnalet.id}` : 'root'
    };
    this.notes.push(note);
    await this.saveNotesToState();

    // Create an edge in the hierarchy system so the note appears in the tree
    const noteId = `note-${note.id}`;
    const parentId = parentAnalet ? `analet-${parentAnalet.id}` : 'item:root';

    try {
      // Use the hierarchy message handler to create the edge
      await this.sendMessage('edges-add', {
        edges: [{
          parentId: parentId,
          childId: noteId,
          type: 'contains'
        }]
      });
    } catch (error) {
      console.error('❌ [AnalysisNoteMessageHandler] Failed to create edge for note:', error);
    }

    this.log('info', `Created note from cell: ${note.id} (parent: ${note.parentId})`);
    await this.sendMessage('analysis-note-created', { note });
    await this.sendMessage('analysis-notes-updated', { notes: this.getActiveNotes() });

    // Also send message to open the note editor
    await this.sendMessage('open-note-editor', { note });
  }

  private async handleCreateBlankNote(data: any): Promise<void> {
    // Create a blank note at the root or as child of selected item
    const now = new Date().toISOString();
    const finalParentId = data.parentId || 'root';
    const note: AnalysisNote = {
      id: this.nextNoteId++,
      content: '',
      type: 'note',
      status: 'active',
      createdAt: now,
      updatedAt: now,
      tags: [],
      parentId: finalParentId
    };
    this.notes.push(note);
    await this.saveNotesToState();
    // Create an edge in the hierarchy system so the note appears in the tree
    const noteId = `note-${note.id}`;
    const edgeParentId = data.parentId && data.parentId !== 'root' ? data.parentId : 'item:root';
    try {
      const edgeData = {
        edges: [{
          parentId: edgeParentId,
          childId: noteId,
          type: 'contains'
        }]
      };
      await this.sendMessage('edges-add', edgeData);
    } catch (error) {
      console.error('❌ [hyp-analysis-list] HYPOTHESIS ERROR: Failed to create edge for note:', error);
      console.error('❌ [hyp-analysis-list] Edge creation error details:', {
        message: error instanceof Error ? error.message : String(error),
        noteId,
        edgeParentId,
        originalParentId: data.parentId
      });
    }

    this.log('info', `Created new note: ${note.content || `Note ${note.id}`}`);
    await this.sendMessage('analysis-note-created', { note });
    await this.sendMessage('analysis-notes-updated', { notes: this.getActiveNotes() });

    // Open the note editor immediately for a new note
    await this.sendMessage('open-note-editor', { note });
  }

  private async handleCreateBlankNoteOnly(data: any): Promise<void> {
    // Create a blank note without any edge creation or parent handling
    const now = new Date().toISOString();

    const note: AnalysisNote = {
      id: this.nextNoteId++,
      content: '',
      type: 'note',
      status: 'active',
      createdAt: now,
      updatedAt: now,
      tags: []
    };

    this.notes.push(note);
    await this.saveNotesToState();

    this.log('info', `Created blank note: Note ${note.id}`);

    // Send the note back in the response
    await this.sendSuccess('create-blank-note', { note });

    // Update the notes list
    await this.sendMessage('analysis-notes-updated', { notes: this.getActiveNotes() });
  }

  private async getCurrentlySelectedAnalet(): Promise<any | null> {
    try {
      // Try to get the currently selected analet from UI state
      if (!this.context?.stateService) {
        return null;
      }

      const uiState = await this.context.stateService.loadUIState();
      if (uiState && uiState.selectedAnaletIds && uiState.selectedAnaletIds.length > 0) {
        // Get the first selected analet
        const selectedAnaletId = uiState.selectedAnaletIds[0];
        const analets = await this.context.stateService.getWorkspaceState('analets') as any[] | null;
        if (analets) {
          return analets.find(a => a.id === selectedAnaletId) || null;
        }
      }

      return null;
    } catch (error) {
      this.log('warn', 'Failed to get current selection', error);
      return null;
    }
  }

  private async findAnaletForCell(notebookPath: string, cellIndex: number): Promise<any | null> {
    // This would need to integrate with the notebook metadata system to find associated analets
    // For now, we'll return null and handle gracefully
    // In a full implementation, this would query the StateManagementService for analets
    // that have notebook metadata matching this cell

    if (!this.context?.stateService) {
      return null;
    }

    try {
      // This is a simplified implementation - in reality you'd need to query
      // the analet storage for items with matching notebook metadata
      const analets = await this.context.stateService.getWorkspaceState('analets') as any[] | null;
      if (!analets) return null;

      return analets.find(analet =>
        analet.notebookCellMetadata?.filePath === notebookPath &&
        analet.notebookCellMetadata?.cellIndex === cellIndex
      ) || null;
    } catch (error) {
      this.log('warn', 'Failed to find analet for cell', error);
      return null;
    }
  }

  private getActiveNotes(): AnalysisNote[] {
    return this.notes.filter(note => note.status === 'active');
  }

  private async loadNotesFromState(): Promise<void> {
    if (!this.context?.stateService) {
      this.log('warn', 'No state service available for loading notes');
      return;
    }

    try {
      const storedNotes = await this.context.stateService.getWorkspaceState('analysis-notes') as AnalysisNote[] | null;
      if (storedNotes && Array.isArray(storedNotes)) {
        this.notes = storedNotes;
        // Set next ID based on existing notes
        this.nextNoteId = Math.max(...this.notes.map(n => n.id), 0) + 1;
        this.log('info', `Loaded ${this.notes.length} analysis notes from state`);
      } else {
        this.notes = [];
        this.nextNoteId = 1;
      }
    } catch (error) {
      this.log('error', 'Failed to load notes from state', error);
      this.notes = [];
      this.nextNoteId = 1;
    }
  }

  private async saveNotesToState(): Promise<void> {
    if (!this.context?.stateService) {
      this.log('warn', 'No state service available for saving notes');
      return;
    }

    try {
      await this.context.stateService.getContext().workspaceState.update('analysis-notes', this.notes);
      this.log('info', `Saved ${this.notes.length} analysis notes to state`);
    } catch (error) {
      this.log('error', 'Failed to save notes to state', error);
      throw error;
    }
  }

  private async handleClearAllNotes(data: any): Promise<void> {
    try {
      this.log('info', `Clearing all notes (${this.notes.length} notes)`);

      // Clear in-memory notes
      this.notes = [];
      this.nextNoteId = 1;

      // Clear from persistent storage
      await this.saveNotesToState();
      this.log('info', 'All analysis notes cleared successfully');

      // Notify frontend that notes have been updated (cleared)
      await this.sendMessage('analysis-notes-updated', { notes: [] });

      // Send success response
      await this.sendSuccess('clear-all-notes', { cleared: true });
    } catch (error) {
      console.error('❌ [AnalysisNoteMessageHandler] Failed to clear all notes:', error);
      this.log('error', 'Failed to clear all notes', error);
      throw error;
    }
  }

  private async handleCreateMapNote(data: any): Promise<void> {
    const timestamp = Date.now();
    const creationId = `create-${timestamp}-${Math.random().toString(36).substr(2, 9)}`;
    const validation = this.validateData(data, ['content', 'position']);
    if (!validation.isValid) {
      throw new Error(`Invalid data: ${validation.error}`);
    }

    // Validate position structure
    if (!data.position || typeof data.position.x !== 'number' || typeof data.position.y !== 'number') {
      throw new Error('Position must be an object with numeric x and y properties');
    }

    const noteId = this.nextNoteId++;
    const note: AnalysisNote = {
      id: noteId,
      content: data.content,
      type: 'note',
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      position: {
        x: data.position.x,
        y: data.position.y
      },
      // No parentId for map notes - they are standalone
    };
    this.notes.push(note);
    await this.saveNotesToState();

    const activeNotes = this.getActiveNotes();
    await this.sendMessage('analysis-notes-updated', { notes: activeNotes });

    // Send specific response for map note creation
    await this.sendMessage('create-map-note-response', { note });
    this.log('info', `Created map note with ID ${note.id} at position (${note.position!.x}, ${note.position!.y})`);
  }

  public dispose(): void {
    this.notes = [];
    super.dispose();
  }
}
