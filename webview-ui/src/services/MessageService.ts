import { vscode as vscodeApi } from '../vscode';

export interface Message {
  type: string;
  command?: string;
  data?: any;
  messageId?: string;
}

type MessageHandler = (data: any) => void;

export class MessageService {
  private static instance: MessageService;
  private messageHandlers: Map<string, Set<MessageHandler>>;
  private internalHandlers: Map<string, Set<MessageHandler>>;
  private pendingRequests: Map<string, {
    resolve: (value: any) => void;
    reject: (reason: any) => void;
    timeout: NodeJS.Timeout;
  }>;

  private constructor() {
    this.messageHandlers = new Map();
    this.internalHandlers = new Map();
    this.pendingRequests = new Map();
    this.initialize();
  }

  public static getInstance(): MessageService {
    if (!MessageService.instance) {
      MessageService.instance = new MessageService();
    }
    return MessageService.instance;
  }

  private initialize(): void {
    window.addEventListener('message', this.handleMessage);
  }

  // private cleanup(): void {
  //   window.removeEventListener('message', this.handleMessage);
  //   // Clear all pending requests
  //   this.pendingRequests.forEach(({ reject, timeout }) => {
  //     clearTimeout(timeout);
  //     reject(new Error('MessageService cleanup'));
  //   });
  //   this.pendingRequests.clear();
  //   this.messageHandlers.clear();
  // }

  private handleMessage = (event: MessageEvent): void => {
    const message = event.data as Message;
    const { type, command, data, messageId } = message;

    // Use either type or command field
    const messageType = type || command;
    // Debug logging for all messages to see what's coming through
    // Debug logging for notebook cell selection messages


    // Handle pending requests first
    if (messageId && this.pendingRequests.has(messageId)) {
      const { resolve, timeout } = this.pendingRequests.get(messageId)!;
      clearTimeout(timeout);
      this.pendingRequests.delete(messageId);
      resolve(data);
      return;
    }

    // Handle registered message handlers (from extension)
    if (messageType) {
      const handlers = this.messageHandlers.get(messageType);
      if (handlers) {


        handlers.forEach(handler => {

          handler(data);
        });
        return;
      }
    }

    // Handle default cases
    switch (messageType) {
      case 'extension-ready':
        break;
      // REMOVED: analet-created case - all analets now come via fetch-analet-data to prevent duplication
      case 'analet-updated':
        this.sendInternalMessage('analets-updated', data);
        window.dispatchEvent(new CustomEvent('analetUpdated', { detail: data }));
        break;
      case 'analets-generation-response':
        // Trigger UI refresh for new generated analets
        this.sendInternalMessage('analets-updated', data);
        window.dispatchEvent(new CustomEvent('analetsUpdated', { detail: data }));
        break;
      case 'cluster-name-response':
        break;
      case 'scroll-to-analet-response':
        // TODO: Implement analet highlighting/scrolling
        break;
      case 'notebook-cell-open-response':
        break;
      case 'semantic-layer-export-response':
        break;
      case 'column-descriptions-response':
        break;
      case 'embeddings-response':
        break;
      case 'embedding-description-response':
        break;
      case 'bearing-embedding-response':
        // Bubble to internal handlers to let state services update specific bearing
        this.sendInternalMessage('bearing-embedding-response', data);
        break;
      case 'derive-analet-response':
        if (data.success) {
          // If a new analet was created, trigger UI refresh
          if (data.derivedAnalet) {
            window.dispatchEvent(new CustomEvent('analetsUpdated', { detail: data }));
          }
        } else {
          console.error('❌ [MessageService] Analet derivation failed:', data.error);
        }
        break;
      case 'derive-analet-error':
        console.error('❌ [MessageService] Derive analet error:', data);
        break;
      case 'perturb-analet-response':
        if (data.success) {
          // If the analet was modified, trigger UI refresh
          if (data.updatedAnalet) {
            window.dispatchEvent(new CustomEvent('analetsUpdated', { detail: data }));
          }
        } else {
          console.error('❌ [MessageService] Analet perturbation failed:', data.error);
        }
        break;
      case 'perturb-analet-error':
        console.error('❌ [MessageService] Perturb analet error:', data);
        break;
      case 'delete-analet-response':
        if (data.success) {
          // Trigger UI refresh to remove the deleted analet
          window.dispatchEvent(new CustomEvent('analetsUpdated', { detail: data }));
        } else {
          console.error('❌ [MessageService] Analet deletion failed:', data.error);
        }
        break;
      case 'delete-analet-error':
        console.error('❌ [MessageService] Delete analet error:', data);
        break;
      case 'hierarchy-state-saved':
        // Acknowledge that hierarchy state was saved by extension
        break;
      case 'value-annotations-generated':
        // Handle value annotations generated message
        break;
      case 'notebookReady':
        // Handle notebook ready message
        break;
      case 'analets-updated':
        // Trigger UI refresh for updated analets
        window.dispatchEvent(new CustomEvent('analetsUpdated', { detail: data }));
        break;
      case 'refresh-analets':
        // Centralized refresh path for analets
        try { console.log('[MessageService] refresh-analets', { source: (data as any)?.source }); } catch {}
        try {
          import('./StateService').then(mod => {
            const stateService = mod.StateService.getInstance();
            if (Array.isArray((data as any)?.analets)) {
              stateService.setAnaletsData((data as any).analets);
            } else if ((data as any)?.analet) {
              stateService.addAnalet((data as any).analet);
            }
            window.dispatchEvent(new CustomEvent('analetsUpdated', { detail: data }));
          }).catch(e => {
            console.error('❌ [MessageService] Failed handling refresh-analets:', e);
            window.dispatchEvent(new CustomEvent('analetsUpdated', { detail: data }));
          });
        } catch (e) {
          console.error('❌ [MessageService] Failed handling refresh-analets (outer):', e);
          window.dispatchEvent(new CustomEvent('analetsUpdated', { detail: data }));
        }
        break;
      case 'error':
        console.error('❌ [MessageService] Error from extension:', data);
        // Optionally show error in UI
        window.dispatchEvent(new CustomEvent('extensionError', { detail: data }));
        break;
      case 'create-note-from-cell':
        // This message comes from extension and should trigger note creation
        // Forward it back to the extension to be handled by AnalysisNoteMessageHandler
        this.sendMessage('create-note-from-cell', data);
        break;
      case 'analysis-note-created':
        // Send internal message to trigger UI updates for new note
        this.sendInternalMessage('analysis-note-created', data);
        // Trigger global event for any components listening
        window.dispatchEvent(new CustomEvent('analysisNoteCreated', { detail: data }));
        break;
      case 'analysis-notes-updated':
        // Send internal message to trigger UI refresh
        this.sendInternalMessage('analysis-notes-updated', data);
        // Trigger global event for analysis list updates
        window.dispatchEvent(new CustomEvent('analysisNotesUpdated', { detail: data }));
        break;
      case 'open-note-editor':
        // Send internal message to trigger note editor opening
        this.sendInternalMessage('open-note-editor', data);
        // Trigger global event to open inline editor
        window.dispatchEvent(new CustomEvent('openNoteEditor', { detail: data }));
        break;
      case 'analysis-notes-loaded':
        // Send internal message to update notes state
        this.sendInternalMessage('analysis-notes-loaded', data);
        // Trigger global event for initial notes loading
        window.dispatchEvent(new CustomEvent('analysisNotesUpdated', { detail: data }));
        break;
      case 'create-blank-note':
        // This is actually a response to a request, but it's coming as a message
        // Send internal message for any components listening
        this.sendInternalMessage('create-blank-note', data);
        // Trigger global event
        window.dispatchEvent(new CustomEvent('createBlankNoteResponse', { detail: data }));
        break;
      case 'edges-add':

        // Send internal message to update hierarchy
        this.sendInternalMessage('edges-add', data);
        // Trigger global event for hierarchy updates
        window.dispatchEvent(new CustomEvent('hierarchyEdgesAdded', { detail: data }));
        break;
      default:
    }
  };

  // New: Send internal webview-only message
  public sendInternalMessage(type: string, data?: any): void {
    const handlers = this.internalHandlers.get(type);
    if (handlers) {
      handlers.forEach(handler => handler(data));
    }
  }

  // Modified: Send message to extension
  public sendMessage(type: string, data?: any): void {
    // VS Code webview API expects 'command' field instead of 'type'
    const message = { command: type, data };
    vscodeApi.postMessage(message);
  }

  public requestAnalysisDimensions(): void {
    // Dataset context is now handled in the backend
    // Just send the request without frontend dataset context
    this.sendMessage('generate-concept-axes');
  }

  public saveConceptAxes(conceptAxes: any[]): void {
    this.sendMessage('save-concept-axes', { conceptAxes });
  }

  public async sendRequest<T = any>(type: string, data?: any, timeoutMs: number = 10000): Promise<T> {
    const messageId = Math.random().toString(36).substring(2, 15);
    // VS Code webview API expects 'command' field instead of 'type'
    const message = { command: type, data, messageId };

    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(messageId);
        reject(new Error(`Request timeout: ${type}`));
      }, timeoutMs);

      this.pendingRequests.set(messageId, { resolve, reject, timeout });
      vscodeApi.postMessage(message);
    });
  }

  // Modified: Register handler for extension messages
  public onMessage(type: string, handler: MessageHandler): () => void {


    if (!this.messageHandlers.has(type)) {
      this.messageHandlers.set(type, new Set());
    }
    this.messageHandlers.get(type)!.add(handler);


    // Return cleanup function
    return () => this.offMessage(type, handler);
  }

  // New: Register handler for internal messages only
  public onInternalMessage(type: string, handler: MessageHandler): () => void {
    if (!this.internalHandlers.has(type)) {
      this.internalHandlers.set(type, new Set());
    }
    this.internalHandlers.get(type)!.add(handler);

    // Return cleanup function
    return () => this.offInternalMessage(type, handler);
  }

  public offMessage(type: string, handler: MessageHandler): void {
    const handlers = this.messageHandlers.get(type);
    if (handlers) {
      handlers.delete(handler);
      if (handlers.size === 0) {
        this.messageHandlers.delete(type);
      }
    }
  }

  // New: Remove internal message handler
  public offInternalMessage(type: string, handler: MessageHandler): void {
    const handlers = this.internalHandlers.get(type);
    if (handlers) {
      handlers.delete(handler);
      if (handlers.size === 0) {
        this.internalHandlers.delete(type);
      }
    }
  }
}
