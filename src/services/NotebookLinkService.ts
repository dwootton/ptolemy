import * as vscode from 'vscode';
import * as path from 'path';
import { JupyterNotebookService } from './JupyterNotebookService';
import { Analet } from '../types/analet';
import { TelemetryService } from './TelemetryService';

/**
 * Link record representing the connection between an analet and a notebook cell
 */
export interface NotebookCellLink {
  analetId: number;
  notebookPath: string;
  cellId: string; // Primary identifier - Jupyter cell ID
  cellIndex?: number; // Secondary/cached for quick access
  contentHash?: string; // Tertiary fallback for moved cells
  lastSeen: string;
  lastModified: string;
}

/**
 * Recent cell activity for targeted sync operations
 */
export interface RecentCellActivity {
  notebookPath: string;
  cellId: string; // Use cell ID instead of index
  cellIndex?: number; // Cache for convenience
  contentHash?: string;
  lastActivity: string;
  activityType: 'selection' | 'edit' | 'execution' | 'directory_scan';
}

/**
 * Cell identity resolution result
 */
export interface CellIdentity {
  cellId: string;
  cellIndex: number;
  contentHash?: string;
  found: boolean;
  method: 'cellId' | 'contentHash' | 'index' | 'notFound';
}

/**
 * NotebookLinkService - Single source of truth for analet-cell mappings
 * 
 * Responsibilities:
 * - Maintain persistent links between analets and notebook cells using stable cell IDs
 * - Track recent cell activity for targeted sync operations
 * - Enforce 1:1 mapping between analets and cells
 * - Provide robust cell identity resolution with fallback strategies
 * - Provide fast lookups for cell→analet and analet→cell
 */
export class NotebookLinkService {
  private static instance: NotebookLinkService;
  private links = new Map<number, NotebookCellLink>(); // analetId → link
  private cellToAnalet = new Map<string, number>(); // cellKey → analetId
  private recentActivity: RecentCellActivity[] = [];
  private readonly maxRecentActivities = 100;
  private readonly context: vscode.ExtensionContext;

  private constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.loadPersistedLinks();
  }

  public static getInstance(context?: vscode.ExtensionContext): NotebookLinkService {
    if (!NotebookLinkService.instance) {
      if (!context) {
        throw new Error('NotebookLinkService requires context for initialization');
      }
      NotebookLinkService.instance = new NotebookLinkService(context);
    }
    return NotebookLinkService.instance;
  }

  /**
   * Create or update a link between an analet and a notebook cell
   * Uses cell ID as primary identifier with index as cached convenience
   * Enforces 1:1 mapping by removing any conflicting links
   */
  public async linkAnaletToCell(
    analetId: number,
    notebookPath: string,
    cellId: string,
    cellIndex?: number,
    contentHash?: string
  ): Promise<void> {
    // Prevent duplicates: if this cell is already linked to any analet, reuse/update that link instead of creating a new one
    const existingAnalet = await this.getAnaletByCellWithResolution(notebookPath, cellId, cellIndex, contentHash);
    if (existingAnalet !== null && existingAnalet !== analetId) {
      await this.updateLinkCellInfo(existingAnalet, cellId, cellIndex, contentHash);
      return;
    }
    const cellKey = this.getCellKey(notebookPath, cellId);
    
    // Check for existing conflicting mappings by cell ID
    const existingAnaletForCell = this.cellToAnalet.get(cellKey);
    if (existingAnaletForCell && existingAnaletForCell !== analetId) {
      this.unlinkAnalet(existingAnaletForCell);
    }

    const existingLinkForAnalet = this.links.get(analetId);
    if (existingLinkForAnalet) {
      const oldCellKey = this.getCellKey(existingLinkForAnalet.notebookPath, existingLinkForAnalet.cellId);
      this.cellToAnalet.delete(oldCellKey);
    }

    // Create the new link
    const link: NotebookCellLink = {
      analetId,
      notebookPath,
      cellId,
      cellIndex,
      contentHash,
      lastSeen: new Date().toISOString(),
      lastModified: new Date().toISOString()
    };

    this.links.set(analetId, link);
    this.cellToAnalet.set(cellKey, analetId);

    await this.persistLinks();

    // Record telemetry event for analet linking
    const telemetryService = TelemetryService.getInstance();
    telemetryService.recordAnaletEvent(
      'analet_linked',
      analetId,
      {
        notebookPath,
        cellId,
        cellIndex
      },
      'link_to_cell',
      {
        notebookPath,
        cellId,
        cellIndex,
        contentHash
      }
    );
  }

  /**
   * Remove the link for an analet
   */
  public async unlinkAnalet(analetId: number): Promise<void> {
    const link = this.links.get(analetId);
    if (!link) {
      return;
    }

    const cellKey = this.getCellKey(link.notebookPath, link.cellId);
    this.cellToAnalet.delete(cellKey);
    this.links.delete(analetId);

    await this.persistLinks();

    // Record telemetry event for analet unlinking
    const telemetryService = TelemetryService.getInstance();
    telemetryService.recordAnaletEvent(
      'analet_unlinked',
      analetId,
      {
        notebookPath: link.notebookPath,
        cellId: link.cellId,
        cellIndex: link.cellIndex
      },
      'unlink_from_cell',
      {
        notebookPath: link.notebookPath,
        cellId: link.cellId,
        cellIndex: link.cellIndex
      }
    );
  }

  /**
   * Get the analet ID linked to a specific cell by cell ID
   */
  public getAnaletByCell(notebookPath: string, cellId: string): number | null {
    const cellKey = this.getCellKey(notebookPath, cellId);
    return this.cellToAnalet.get(cellKey) || null;
  }

  /**
   * Get the analet ID linked to a cell by resolving its identity
   * This method handles fallback resolution if the direct cell ID lookup fails
   */
  public async getAnaletByCellWithResolution(
    notebookPath: string,
    cellId?: string,
    cellIndex?: number,
    contentHash?: string
  ): Promise<number | null> {
    // Try direct cell ID lookup first
    if (cellId) {
      const analetId = this.getAnaletByCell(notebookPath, cellId);
      if (analetId !== null) {
        return analetId;
      }
    }

    // If direct lookup fails, try to resolve cell identity
    const identity = await this.resolveCellIdentity(notebookPath, cellId, cellIndex, contentHash);
    
    if (identity.found) {
      // Update our link with the resolved cell ID if we found it
      const analetId = this.getAnaletByCell(notebookPath, identity.cellId);
      if (analetId !== null) {
        // Update the link with current information
        await this.updateLinkCellInfo(analetId, identity.cellId, identity.cellIndex, identity.contentHash);
        return analetId;
      }
    }

    return null;
  }

  /**
   * Get the cell link for a specific analet
   */
  public getCellByAnalet(analetId: number): NotebookCellLink | null {
    return this.links.get(analetId) || null;
  }

  /**
   * Get all current links
   */
  public getAllLinks(): NotebookCellLink[] {
    return Array.from(this.links.values());
  }

  /**
   * Record cell activity for targeted sync operations
   */
  public recordCellActivity(
    notebookPath: string,
    cellId: string,
    activityType: 'selection' | 'edit' | 'execution',
    cellIndex?: number,
    contentHash?: string
  ): void {
    const activity: RecentCellActivity = {
      notebookPath,
      cellId,
      cellIndex,
      contentHash,
      lastActivity: new Date().toISOString(),
      activityType
    };

    // Remove existing activity for this cell
    const cellKey = this.getCellKey(notebookPath, cellId);
    this.recentActivity = this.recentActivity.filter(
      a => this.getCellKey(a.notebookPath, a.cellId) !== cellKey
    );

    // Add new activity to front
    this.recentActivity.unshift(activity);

    // Trim to max size
    if (this.recentActivity.length > this.maxRecentActivities) {
      this.recentActivity = this.recentActivity.slice(0, this.maxRecentActivities);
    }
  }

  /**
   * Get recent cell activities for targeted sync
   */
  public getRecentCells(limit: number = 20, sinceMs?: number): RecentCellActivity[] {
    let activities = this.recentActivity;

    if (sinceMs) {
      const cutoff = new Date(Date.now() - sinceMs).toISOString();
      activities = activities.filter(a => a.lastActivity > cutoff);
    }

    return activities.slice(0, limit);
  }

  /**
   * Update the content hash and last seen time for a link
   */
  public async updateLinkActivity(analetId: number, contentHash?: string): Promise<void> {
    const link = this.links.get(analetId);
    if (!link) {
      return;
    }

    link.lastSeen = new Date().toISOString();
    if (contentHash) {
      link.contentHash = contentHash;
    }

    await this.persistLinks();
  }

  /**
   * Update cell information for an existing link (for identity resolution updates)
   */
  public async updateLinkCellInfo(
    analetId: number,
    cellId: string,
    cellIndex?: number,
    contentHash?: string
  ): Promise<void> {
    const link = this.links.get(analetId);
    if (!link) {
      return;
    }

    // If another analet is mapped to this cell, remove that mapping to enforce 1:1
    const targetCellKey = this.getCellKey(link.notebookPath, cellId);
    const existingAnaletForCell = this.cellToAnalet.get(targetCellKey);
    if (existingAnaletForCell && existingAnaletForCell !== analetId) {
      this.unlinkAnalet(existingAnaletForCell);
    }

    // Update cell to analet mapping if cell ID changed
    if (link.cellId !== cellId) {
      const oldCellKey = this.getCellKey(link.notebookPath, link.cellId);
      const newCellKey = this.getCellKey(link.notebookPath, cellId);
      this.cellToAnalet.delete(oldCellKey);
      this.cellToAnalet.set(newCellKey, analetId);
    }

    link.cellId = cellId;
    link.cellIndex = cellIndex;
    link.lastSeen = new Date().toISOString();
    if (contentHash) {
      link.contentHash = contentHash;
    }

    await this.persistLinks();
  }

  /**
   * Find links by notebook path
   */
  public getLinksByNotebook(notebookPath: string): NotebookCellLink[] {
    return Array.from(this.links.values()).filter(link => link.notebookPath === notebookPath);
  }

  /**
   * Clean up orphaned links (analets that no longer exist)
   */
  public async cleanupOrphanedLinks(existingAnaletIds: Set<number>): Promise<number> {
    const orphanedLinks: number[] = [];
    
    for (const [analetId, link] of this.links) {
      if (!existingAnaletIds.has(analetId)) {
        orphanedLinks.push(analetId);
      }
    }

    for (const analetId of orphanedLinks) {
      await this.unlinkAnalet(analetId);
    }
    return orphanedLinks.length;
  }

  /**
   * Find a cell by content hash (useful for tracking moved cells)
   */
  public findCellByContentHash(contentHash: string): NotebookCellLink | null {
    for (const link of this.links.values()) {
      if (link.contentHash === contentHash) {
        return link;
      }
    }
    return null;
  }

  /**
   * Resolve cell identity using multiple strategies
   * Returns the most reliable cell identification available
   */
  public async resolveCellIdentity(
    notebookPath: string,
    cellId?: string,
    cellIndex?: number,
    contentHash?: string
  ): Promise<CellIdentity> {
    try {
      const jup = JupyterNotebookService.getInstance();
      const notebookData = await jup.readNotebook(notebookPath);
      if (!notebookData) {
        return { cellId: cellId || '', cellIndex: cellIndex || 0, found: false, method: 'notFound' };
      }

      // Strategy 1: Meridian metadata cellId (stable) match
      if (cellId) {
        const byMeridian = notebookData.cells.findIndex((cell: any) => cell?.metadata?.meridian_analet?.cellId === cellId);
        if (byMeridian >= 0) {
          const cell = notebookData.cells[byMeridian];
          return {
            cellId,
            cellIndex: byMeridian,
            contentHash: jup.generateContentHash(cell.source),
            found: true,
            method: 'cellId'
          };
        }
        // Strategy 1b: raw Jupyter cell id as fallback for ID match only (not persisted)
        const byJupyterId = notebookData.cells.findIndex((cell: any) => cell.id === cellId);
        if (byJupyterId >= 0) {
          const cell = notebookData.cells[byJupyterId];
          return {
            cellId,
            cellIndex: byJupyterId,
            contentHash: jup.generateContentHash(cell.source),
            found: true,
            method: 'cellId'
          };
        }
      }

      // Strategy 2: Content hash match (for moved cells)
      if (contentHash) {
        for (let i = 0; i < notebookData.cells.length; i++) {
          const cell = notebookData.cells[i];
          const cellContentHash = jup.generateContentHash(cell.source);
          if (cellContentHash === contentHash) {
            return {
              cellId: cell?.metadata?.meridian_analet?.cellId || cell.id || `cell-${i}`,
              cellIndex: i,
              contentHash: cellContentHash,
              found: true,
              method: 'contentHash'
            };
          }
        }
      }

      // Strategy 3: No index fallback; return notFound as we avoid index-based identity

      // All strategies failed
      return { 
        cellId: cellId || '', 
        cellIndex: 0, 
        found: false, 
        method: 'notFound' 
      };

    } catch (error) {
      console.error(`❌ [NotebookLinkService] Failed to resolve cell identity for ${notebookPath}:`, error);
      return { 
        cellId: cellId || '', 
        cellIndex: 0, 
        found: false, 
        method: 'notFound' 
      };
    }
  }

  /**
   * Load notebook data from file system
   */
  // Remove local IO/hashers; use JupyterNotebookService instead

  /**
   * Generate a unique key for a cell using notebook path and cell ID
   */
  private getCellKey(notebookPath: string, cellId: string): string {
    return `${notebookPath}:${cellId}`;
  }

  /**
   * Load persisted links from workspace state
   */
  private loadPersistedLinks(): void {
    try {
      const persistedData = this.context.workspaceState.get<{
        links: NotebookCellLink[];
        recentActivity: RecentCellActivity[];
      }>('notebook-links');

      if (persistedData) {
        // Restore links
        for (const link of persistedData.links || []) {
          this.links.set(link.analetId, link);
          const cellKey = this.getCellKey(link.notebookPath, link.cellId);
          this.cellToAnalet.set(cellKey, link.analetId);
        }

        // Restore recent activity (keep only last 24 hours)
        const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        this.recentActivity = (persistedData.recentActivity || [])
          .filter(a => a.lastActivity > dayAgo)
          .slice(0, this.maxRecentActivities);
      }
    } catch (error) {
      console.error('❌ [NotebookLinkService] Failed to load persisted links:', error);
    }
  }

  /**
   * Persist links to workspace state
   */
  private async persistLinks(): Promise<void> {
    try {
      const data = {
        links: Array.from(this.links.values()),
        recentActivity: this.recentActivity
      };

      await this.context.workspaceState.update('notebook-links', data);
    } catch (error) {
      console.error('❌ [NotebookLinkService] Failed to persist links:', error);
    }
  }

  /**
   * Clear all links and activity (for testing/reset)
   */
  public async clearAll(): Promise<void> {
    this.links.clear();
    this.cellToAnalet.clear();
    this.recentActivity = [];
    await this.context.workspaceState.update('notebook-links', undefined);
  }

  /**
   * Get statistics about current links
   */
  public getStats(): {
    totalLinks: number;
    recentActivities: number;
    notebooksWithLinks: number;
  } {
    const notebooks = new Set(Array.from(this.links.values()).map(l => l.notebookPath));
    
    return {
      totalLinks: this.links.size,
      recentActivities: this.recentActivity.length,
      notebooksWithLinks: notebooks.size
    };
  }
}