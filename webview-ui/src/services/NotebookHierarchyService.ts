import { MessageService } from './MessageService';
import { Analet } from '../types/analet';

/**
 * Represents a file or folder in the notebook hierarchy
 */
export interface NotebookFileNode {
  id: string;
  name: string;
  path: string;
  type: 'file' | 'folder' | 'notebook';
  children?: NotebookFileNode[];
  isExpanded?: boolean;
  analets?: Analet[]; // Analets associated with this notebook
  size?: number;
  lastModified?: string;
}

/**
 * Service for managing the notebook file hierarchy
 */
export class NotebookHierarchyService {
  private static instance: NotebookHierarchyService | null = null;
  private messageService: MessageService;
  private hierarchyData: NotebookFileNode[] = [];
  private expandedNodes = new Set<string>();
  private listeners: Array<(hierarchy: NotebookFileNode[]) => void> = [];

  private constructor() {
    this.messageService = MessageService.getInstance();
    this.setupMessageHandlers();
  }

  public static getInstance(): NotebookHierarchyService {
    if (!NotebookHierarchyService.instance) {
      NotebookHierarchyService.instance = new NotebookHierarchyService();
    }
    return NotebookHierarchyService.instance;
  }

  /**
   * Set up message handlers for notebook hierarchy updates
   */
  private setupMessageHandlers(): void {
    this.messageService.onMessage('notebook-hierarchy-loaded', (data: any) => {
      if (data.success && data.hierarchy) {
        this.hierarchyData = this.processHierarchyData(data.hierarchy);
        this.notifyListeners();
      } else {
        console.error('❌ [NotebookHierarchy] Failed to load hierarchy:', data.error);
      }
    });

    this.messageService.onMessage('notebook-analets-response', (data: any) => {
      if (data.success && data.notebookPath && data.analets) {
        this.updateNotebookAnalets(data.notebookPath, data.analets);
        this.notifyListeners();
      }
    });
  }

  /**
   * Process raw hierarchy data from the backend
   */
  private processHierarchyData(hierarchyData: any): NotebookFileNode[] {
    // Handle new hierarchy structure: { notebooks: [...], totalCells: number }
    const notebooks = hierarchyData.notebooks || hierarchyData;
    
    const processNotebook = (notebook: any): NotebookFileNode => {
      return {
        id: notebook.path || Math.random().toString(),
        name: notebook.name || notebook.path?.split('/').pop()?.replace('.ipynb', '') || 'Unknown',
        path: notebook.path,
        type: 'notebook' as const,
        isExpanded: this.expandedNodes.has(notebook.path),
        size: notebook.totalCells,
        analets: [], // Will be populated later if needed
        lastModified: new Date().toISOString() // Could be enhanced with real file metadata
      };
    };

    // Convert notebooks array to NotebookFileNode array
    if (Array.isArray(notebooks)) {
      return notebooks.map(processNotebook);
    } else if (Array.isArray(hierarchyData)) {
      // Fallback for old format
      return hierarchyData.map(processNotebook);
    }
    
    return [];
  }

  /**
   * Update analets for a specific notebook
   */
  private updateNotebookAnalets(notebookPath: string, analets: Analet[]): void {
    const updateNode = (nodes: NotebookFileNode[]): boolean => {
      for (const node of nodes) {
        if (node.path === notebookPath && node.type === 'notebook') {
          node.analets = analets;
          return true;
        }
        if (node.children && updateNode(node.children)) {
          return true;
        }
      }
      return false;
    };

    updateNode(this.hierarchyData);
  }

  /**
   * Load the notebook hierarchy from the backend
   */
  public async loadHierarchy(): Promise<void> {
    try {
      // Use the new dedicated hierarchy loading message
      await this.messageService.sendMessage('load-notebook-hierarchy', {});
    } catch (error) {
      console.error('❌ [NotebookHierarchy] Failed to load hierarchy:', error);
    }
  }

  /**
   * Load analets for a specific notebook
   */
  public async loadNotebookAnalets(notebookPath: string): Promise<void> {
    try {
      await this.messageService.sendMessage('get-notebook-analets', { notebookPath });
    } catch (error) {
      console.error('❌ [NotebookHierarchy] Failed to load notebook analets:', error);
    }
  }

  /**
   * Get the current hierarchy data
   */
  public getHierarchy(): NotebookFileNode[] {
    return this.hierarchyData;
  }

  /**
   * Toggle expansion state of a folder
   */
  public toggleExpansion(nodeId: string, forceExpanded?: boolean): void {
    if (forceExpanded !== undefined) {
      // Force a specific state
      if (forceExpanded) {
        this.expandedNodes.add(nodeId);
      } else {
        this.expandedNodes.delete(nodeId);
      }
    } else {
      // Toggle current state
      if (this.expandedNodes.has(nodeId)) {
        this.expandedNodes.delete(nodeId);
      } else {
        this.expandedNodes.add(nodeId);
      }
    }

    // Update the hierarchy data
    const updateExpansion = (nodes: NotebookFileNode[]): void => {
      for (const node of nodes) {
        if (node.id === nodeId) {
          node.isExpanded = this.expandedNodes.has(nodeId);
        }
        if (node.children) {
          updateExpansion(node.children);
        }
      }
    };

    updateExpansion(this.hierarchyData);
    this.notifyListeners();
  }

  /**
   * Check if a node is expanded
   */
  public isExpanded(nodeId: string): boolean {
    return this.expandedNodes.has(nodeId);
  }

  /**
   * Create a new notebook file
   */
  public async createNotebook(parentPath?: string, name?: string): Promise<void> {
    try {
      await this.messageService.sendMessage('create-notebook', {
        parentPath: parentPath || '',
        name: name || 'Untitled.ipynb'
      });
      
      // Reload hierarchy after creation
      await this.loadHierarchy();
    } catch (error) {
      console.error('❌ [NotebookHierarchy] Failed to create notebook:', error);
    }
  }

  /**
   * Create a new folder
   */
  public async createFolder(parentPath?: string, name?: string): Promise<void> {
    try {
      await this.messageService.sendMessage('create-folder', {
        parentPath: parentPath || '',
        name: name || 'New Folder'
      });
      
      // Reload hierarchy after creation
      await this.loadHierarchy();
    } catch (error) {
      console.error('❌ [NotebookHierarchy] Failed to create folder:', error);
    }
  }

  /**
   * Delete a file or folder
   */
  public async deleteItem(path: string): Promise<void> {
    try {
      await this.messageService.sendMessage('delete-file', { path });
      
      // Reload hierarchy after deletion
      await this.loadHierarchy();
    } catch (error) {
      console.error('❌ [NotebookHierarchy] Failed to delete item:', error);
    }
  }

  /**
   * Rename a file or folder
   */
  public async renameItem(path: string, newName: string): Promise<void> {
    try {
      await this.messageService.sendMessage('rename-file', { path, newName });
      
      // Reload hierarchy after rename
      await this.loadHierarchy();
    } catch (error) {
      console.error('❌ [NotebookHierarchy] Failed to rename item:', error);
    }
  }

  /**
   * Open a notebook or file
   */
  public async openItem(path: string): Promise<void> {
    try {
      await this.messageService.sendMessage('open-file', { path });
    } catch (error) {
      console.error('❌ [NotebookHierarchy] Failed to open item:', error);
    }
  }

  /**
   * Subscribe to hierarchy changes
   */
  public onHierarchyChanged(callback: (hierarchy: NotebookFileNode[]) => void): () => void {
    this.listeners.push(callback);
    
    // Return unsubscribe function
    return () => {
      const index = this.listeners.indexOf(callback);
      if (index > -1) {
        this.listeners.splice(index, 1);
      }
    };
  }

  /**
   * Notify all listeners of hierarchy changes
   */
  private notifyListeners(): void {
    this.listeners.forEach(listener => {
      try {
        listener([...this.hierarchyData]);
      } catch (error) {
        console.error('❌ [NotebookHierarchy] Error in hierarchy listener:', error);
      }
    });
  }
}