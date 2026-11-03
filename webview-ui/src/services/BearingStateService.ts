/**
 * Service for managing bearing-related state operations
 */

import { Bearing, VariableModification } from '../types/analet';
import { MessageService } from './MessageService';

export class BearingStateService {
  private static instance: BearingStateService;
  
  private _bearings: Bearing[] = [];
  private _variableModifications: { [variableName: string]: VariableModification } = {};
  private readonly STORAGE_KEY_BEARINGS = 'meridian-bearings';
  private readonly STORAGE_KEY_MODIFICATIONS = 'meridian-variable-modifications';

  private constructor() {
    this.loadBearings();
    this.loadVariableModifications();
    this.setupMessageHandlers();
  }

  private setupMessageHandlers(): void {
    const messageService = MessageService.getInstance();
    
    // Handle bearing embedding responses
    messageService.onInternalMessage('bearing-embedding-response', (data: any) => {
      if (data.success && data.bearingId && data.embedding) {
        const bearing = this.getBearingById(data.bearingId);
        if (bearing) {
          const updatedBearing = { ...bearing, embedding: data.embedding };
          this.updateBearing(updatedBearing);
        } else {
          // Fallback: update via StateService (single source of truth for UI)
          import('./StateService')
            .then(({ StateService }) => {
              const stateService = StateService.getInstance();
              stateService.updateBearingEmbedding(data.bearingId, data.embedding);
            })
            .catch((e) => {
              console.warn(`🧭 [BearingStateService] Failed fallback update via StateService for bearing ${data.bearingId}:`, e);
            });
        }
        // Dispatch a specific event for embedding generation regardless of path
        try {
          window.dispatchEvent(new CustomEvent('bearing-embedding-generated', { 
            detail: { bearingId: data.bearingId, success: true } 
          }));
        } catch {}
      } else if (!data.success) {
        console.error('🧭 [BearingStateService] Bearing embedding generation failed:', data.error);
        // Dispatch failure event
        window.dispatchEvent(new CustomEvent('bearing-embedding-generated', { 
          detail: { bearingId: data.bearingId, success: false, error: data.error } 
        }));
      }
    });
  }

  public static getInstance(): BearingStateService {
    if (!BearingStateService.instance) {
      BearingStateService.instance = new BearingStateService();
    }
    return BearingStateService.instance;
  }

  // Bearings management
  public getBearings(): Bearing[] {
    return [...this._bearings];
  }

  public setBearings(bearings: Bearing[]): void {
    this._bearings = [...bearings];
    this.saveBearings();
    window.dispatchEvent(new CustomEvent('bearingsUpdated', { detail: { action: 'set', count: this._bearings.length } }));
  }

  public addBearing(bearing: Bearing): void {
    const existingIndex = this._bearings.findIndex(b => b.id === bearing.id);
    if (existingIndex >= 0) {
      this._bearings[existingIndex] = bearing;
    } else {
      this._bearings.push(bearing);
    }
    this.saveBearings();
    window.dispatchEvent(new CustomEvent('bearingsUpdated', { detail: { action: 'add', id: bearing.id } }));
  }

  public removeBearing(bearingId: number): void {
    this._bearings = this._bearings.filter(b => b.id !== bearingId);
    this.saveBearings();
    window.dispatchEvent(new CustomEvent('bearingsUpdated', { detail: { action: 'remove', id: bearingId } }));
  }

  public getBearingById(bearingId: number): Bearing | undefined {
    return this._bearings.find(b => b.id === bearingId);
  }

  public updateBearing(updatedBearing: Bearing): void {
    const index = this._bearings.findIndex(b => b.id === updatedBearing.id);
    if (index >= 0) {
      this._bearings[index] = updatedBearing;
      this.saveBearings();
      window.dispatchEvent(new CustomEvent('bearingsUpdated', { detail: { action: 'update', id: updatedBearing.id } }));
    }
  }

  // Variable modifications management
  public getVariableModifications(): { [variableName: string]: VariableModification } {
    return { ...this._variableModifications };
  }

  public setVariableModifications(modifications: { [variableName: string]: VariableModification }): void {
    this._variableModifications = { ...modifications };
    this.saveVariableModifications();
  }

  public getVariableModification(variableName: string): VariableModification | undefined {
    return this._variableModifications[variableName];
  }

  public setVariableModification(variableName: string, modification: VariableModification): void {
    this._variableModifications[variableName] = modification;
    this.saveVariableModifications();
  }

  public removeVariableModification(variableName: string): void {
    delete this._variableModifications[variableName];
    this.saveVariableModifications();
  }

  public hasVariableModification(variableName: string): boolean {
    return variableName in this._variableModifications;
  }

  // Search and filter methods
  public searchBearings(query: string): Bearing[] {
    const lowerQuery = query.toLowerCase();
    return this._bearings.filter(bearing => 
      bearing.statement?.toLowerCase().includes(lowerQuery) ||
      bearing.tags?.some(tag => tag.toLowerCase().includes(lowerQuery))
    );
  }

  public getBearingsByTags(tags: string[]): Bearing[] {
    return this._bearings.filter(bearing => 
      bearing.tags?.some(tag => tags.includes(tag))
    );
  }

  // Utility methods
  public getBearingCount(): number {
    return this._bearings.length;
  }

  public getVariableModificationCount(): number {
    return Object.keys(this._variableModifications).length;
  }

  public hasBearings(): boolean {
    return this._bearings.length > 0;
  }

  public hasVariableModifications(): boolean {
    return Object.keys(this._variableModifications).length > 0;
  }

  public getAllVariableNames(): string[] {
    return Object.keys(this._variableModifications);
  }

  public getModifiedVariableNames(): string[] {
    return Object.keys(this._variableModifications).filter(
      name => this._variableModifications[name].isDescriptionHumanEdited || 
              this._variableModifications[name].isUnitHumanEdited
    );
  }

  // Persistence methods
  private saveBearings(): void {
    try {
      const serializedBearings = JSON.stringify(this._bearings);
      localStorage.setItem(this.STORAGE_KEY_BEARINGS, serializedBearings);
    } catch (error) {
      console.error('Failed to save bearings to localStorage:', error);
    }
  }

  private loadBearings(): void {
    try {
      const serializedBearings = localStorage.getItem(this.STORAGE_KEY_BEARINGS);
      if (serializedBearings) {
        this._bearings = JSON.parse(serializedBearings);
      }
    } catch (error) {
      console.error('Failed to load bearings from localStorage:', error);
      this._bearings = [];
    }
  }

  private saveVariableModifications(): void {
    try {
      const serializedModifications = JSON.stringify(this._variableModifications);
      localStorage.setItem(this.STORAGE_KEY_MODIFICATIONS, serializedModifications);
    } catch (error) {
      console.error('Failed to save variable modifications to localStorage:', error);
    }
  }

  private loadVariableModifications(): void {
    try {
      const serializedModifications = localStorage.getItem(this.STORAGE_KEY_MODIFICATIONS);
      if (serializedModifications) {
        this._variableModifications = JSON.parse(serializedModifications);
      }
    } catch (error) {
      console.error('Failed to load variable modifications from localStorage:', error);
      this._variableModifications = {};
    }
  }

  // Bulk operations
  public bulkUpdateBearings(updates: Array<{ id: number; updates: Partial<Bearing> }>): void {
    updates.forEach(({ id, updates: bearingUpdates }) => {
      const bearing = this.getBearingById(id);
      if (bearing) {
        const updatedBearing = { ...bearing, ...bearingUpdates };
        this.updateBearing(updatedBearing);
      }
    });
  }

  public bulkDeleteBearings(bearingIds: number[]): void {
    bearingIds.forEach(id => this.removeBearing(id));
  }

  // State export/import
  public getSerializableState() {
    return {
      bearings: this._bearings,
      variableModifications: this._variableModifications,
    };
  }

  public loadFromSerializableState(state: any): void {
    if (state.bearings) {
      this._bearings = state.bearings;
    }
    if (state.variableModifications) {
      this._variableModifications = state.variableModifications;
    }
  }

  // Reset state
  public reset(): void {
    this._bearings = [];
    this._variableModifications = {};
    this.saveBearings();
    this.saveVariableModifications();
  }

  // Clear storage
  public clearStorage(): void {
    localStorage.removeItem(this.STORAGE_KEY_BEARINGS);
    localStorage.removeItem(this.STORAGE_KEY_MODIFICATIONS);
    this.reset();
  }
}