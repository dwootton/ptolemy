/**
 * Service for managing analet-related state operations
 */

import { Analet, ConceptualStatement } from '../types/analet';
import { createAnaletFilter } from '../utilities/filterParser';

export class AnaletStateService {
  private static instance: AnaletStateService;
  
  private _selectedAnalets: Analet[] = [];
  private _availableAnalets: Analet[] = [];
  private _conceptualStatements: ConceptualStatement[] = [];
  private constructor() {
    // Initialize service
  }

  public static getInstance(): AnaletStateService {
    if (!AnaletStateService.instance) {
      AnaletStateService.instance = new AnaletStateService();
    }
    return AnaletStateService.instance;
  }

  // Selected analets management
  public getSelectedAnalets(): Analet[] {
    return [...this._selectedAnalets];
  }

  public setSelectedAnalets(analets: Analet[]): void {
    this._selectedAnalets = [...analets];
  }

  public addSelectedAnalet(analet: Analet): void {
    if (!this._selectedAnalets.find(a => a.id === analet.id)) {
      this._selectedAnalets.push(analet);
    }
  }

  public removeSelectedAnalet(analetId: number): void {
    this._selectedAnalets = this._selectedAnalets.filter(a => a.id !== analetId);
  }

  public clearSelectedAnalets(): void {
    this._selectedAnalets = [];
  }

  public isAnaletSelected(analetId: number): boolean {
    return this._selectedAnalets.some(a => a.id === analetId);
  }

  // Available analets management
  public getAvailableAnalets(): Analet[] {
    return [...this._availableAnalets];
  }

  public setAvailableAnalets(analets: Analet[]): void {
    this._availableAnalets = [...analets];
  }

  public addAvailableAnalet(analet: Analet): void {
    const existingIndex = this._availableAnalets.findIndex(a => a.id === analet.id);
    if (existingIndex >= 0) {
      this._availableAnalets[existingIndex] = analet;
    } else {
      this._availableAnalets.push(analet);
    }
  }

  public removeAvailableAnalet(analetId: number): void {
    this._availableAnalets = this._availableAnalets.filter(a => a.id !== analetId);
  }

  public getAnaletById(analetId: number): Analet | undefined {
    return this._availableAnalets.find(a => a.id === analetId);
  }

  public updateAnalet(updatedAnalet: Analet): void {
    const index = this._availableAnalets.findIndex(a => a.id === updatedAnalet.id);
    if (index >= 0) {
      this._availableAnalets[index] = updatedAnalet;
    }

    const selectedIndex = this._selectedAnalets.findIndex(a => a.id === updatedAnalet.id);
    if (selectedIndex >= 0) {
      this._selectedAnalets[selectedIndex] = updatedAnalet;
    }
  }

  // Conceptual statements management
  public getConceptualStatements(): ConceptualStatement[] {
    return [...this._conceptualStatements];
  }

  public setConceptualStatements(statements: ConceptualStatement[]): void {
    this._conceptualStatements = [...statements];
  }

  public addConceptualStatement(statement: ConceptualStatement): void {
    const existingIndex = this._conceptualStatements.findIndex(s => s.id === statement.id);
    if (existingIndex >= 0) {
      this._conceptualStatements[existingIndex] = statement;
    } else {
      this._conceptualStatements.push(statement);
    }
  }

  public removeConceptualStatement(statementId: number): void {
    this._conceptualStatements = this._conceptualStatements.filter(s => s.id !== statementId);
  }

  public getConceptualStatementById(statementId: number): ConceptualStatement | undefined {
    return this._conceptualStatements.find(s => s.id === statementId);
  }

  // Utility methods
  public getAnaletCount(): number {
    return this._availableAnalets.length;
  }

  public getSelectedAnaletCount(): number {
    return this._selectedAnalets.length;
  }

  public hasAnalets(): boolean {
    return this._availableAnalets.length > 0;
  }

  public hasSelectedAnalets(): boolean {
    return this._selectedAnalets.length > 0;
  }

  // Search and filter methods
  public searchAnalets(query: string): Analet[] {
    if (!query.trim()) {
      return this._availableAnalets;
    }
    
    const filterFn = createAnaletFilter(query);
    return this._availableAnalets.filter(filterFn);
  }

  public getAnaletsByTag(tag: string): Analet[] {
    return this._availableAnalets.filter(analet => 
      analet.tags?.includes(tag)
    );
  }

  public getAnaletsByTags(tags: string[]): Analet[] {
    return this._availableAnalets.filter(analet => 
      analet.tags?.some(tag => tags.includes(tag))
    );
  }

  public getAllTags(): string[] {
    const allTags = new Set<string>();
    this._availableAnalets.forEach(analet => {
      analet.tags?.forEach(tag => allTags.add(tag));
    });
    return Array.from(allTags).sort();
  }

  // Bulk operations
  public bulkUpdateAnalets(updates: Array<{ id: number; updates: Partial<Analet> }>): void {
    updates.forEach(({ id, updates: analetUpdates }) => {
      const analet = this.getAnaletById(id);
      if (analet) {
        const updatedAnalet = { ...analet, ...analetUpdates };
        this.updateAnalet(updatedAnalet);
      }
    });
  }

  public bulkDeleteAnalets(analetIds: number[]): void {
    analetIds.forEach(id => {
      this.removeAvailableAnalet(id);
      this.removeSelectedAnalet(id);
    });
  }

  // State persistence helpers
  public getSerializableState() {
    return {
      selectedAnalets: this._selectedAnalets,
      availableAnalets: this._availableAnalets,
      conceptualStatements: this._conceptualStatements,
    };
  }

  public loadFromSerializableState(state: any): void {
    if (state.selectedAnalets) {
      this._selectedAnalets = state.selectedAnalets;
    }
    if (state.availableAnalets) {
      this._availableAnalets = state.availableAnalets;
    }
    if (state.conceptualStatements) {
      this._conceptualStatements = state.conceptualStatements;
    }
  }

  // Reset state
  public reset(): void {
    this._selectedAnalets = [];
    this._availableAnalets = [];
    this._conceptualStatements = [];
  }
}