/**
 * SemanticLayerService - Handles semantic layer operations (conceptual statements, variable modifications)
 */

import { ConceptualStatement, VariableModification, SemanticLayer, Bearing } from '../../types/analet';

export class SemanticLayerService {
  private static instance: SemanticLayerService;
  
  private _conceptualStatements: ConceptualStatement[] = [];
  private _variableModifications: { [variableName: string]: VariableModification } = {};
  private _bearings: Bearing[] = [];

  private constructor() {
    this.loadBearings();
  }

  public static getInstance(): SemanticLayerService {
    if (!SemanticLayerService.instance) {
      SemanticLayerService.instance = new SemanticLayerService();
    }
    return SemanticLayerService.instance;
  }

  // === CONCEPTUAL STATEMENTS ===
  
  public getConceptualStatements(): ConceptualStatement[] {
    return this._conceptualStatements;
  }

  public setConceptualStatements(statements: ConceptualStatement[]): void {
    this._conceptualStatements = statements;
    this.saveConceptualStatements();
  }

  public addConceptualStatement(statement: ConceptualStatement): void {
    this._conceptualStatements.unshift(statement);
    this.saveConceptualStatements();
  }

  public updateConceptualStatement(statementId: number, text: string): void {
    const index = this._conceptualStatements.findIndex(s => s.id === statementId);
    if (index !== -1) {
      this._conceptualStatements[index].text = text;
      this.saveConceptualStatements();
    }
  }

  // === VARIABLE MODIFICATIONS ===

  public getVariableModifications(): { [variableName: string]: VariableModification } {
    return this._variableModifications;
  }

  public setVariableModification(variableName: string, modification: VariableModification): void {
    this._variableModifications[variableName] = modification;
    this.saveVariableModifications();
  }

  public setVariableModifications(
    modifications: { [variableName: string]: VariableModification },
    merge: boolean = true
  ): void {
    if (merge) {
      this._variableModifications = {
        ...this._variableModifications,
        ...modifications
      };
    } else {
      this._variableModifications = { ...modifications };
    }
    this.saveVariableModifications();
  }

  public updateVariableField(variableName: string, field: keyof VariableModification, value: any): void {
    if (!this._variableModifications[variableName]) {
      this._variableModifications[variableName] = {
        name: variableName,
        comments: []
      };
    }
    (this._variableModifications[variableName] as any)[field] = value;
    this.saveVariableModifications();
  }

  // === VALUE COMMENTS ===

  public getValueComments(columnName: string, rawValue: string): any[] {
    if (!this._variableModifications[columnName]?.valueComments) {
      return [];
    }
    return this._variableModifications[columnName].valueComments![rawValue] || [];
  }

  public saveValueComments(columnName: string, rawValue: string, comments: any[]): void {
    if (!this._variableModifications[columnName]) {
      this._variableModifications[columnName] = {
        name: columnName,
        comments: [],
        valueComments: {},
        conceptualStatementReferences: []
      };
    }

    if (!this._variableModifications[columnName].valueComments) {
      this._variableModifications[columnName].valueComments = {};
    }

    this._variableModifications[columnName].valueComments![rawValue] = comments;
    this.saveVariableModifications();
  }

  // === BEARINGS ===

  public getBearings(): Bearing[] {
    return this._bearings;
  }

  public addBearing(bearing: Bearing): void {
    this._bearings.unshift(bearing);
    this.saveBearings();
    this.dispatchBearingEvent('add', bearing.id);
  }

  public updateBearing(bearingId: number, statement: string): void {
    const index = this._bearings.findIndex(b => b.id === bearingId);
    if (index !== -1) {
      this._bearings[index].statement = statement;
      this.saveBearings();
      this.dispatchBearingEvent('update', bearingId);
    }
  }

  public deleteBearing(bearingId: number): void {
    this._bearings = this._bearings.filter(b => b.id !== bearingId);
    this.saveBearings();
    this.dispatchBearingEvent('remove', bearingId);
  }

  public updateBearingEmbedding(bearingId: number, embedding: number[]): void {
    const index = this._bearings.findIndex(b => b.id === bearingId);
    if (index !== -1) {
      this._bearings[index] = { ...this._bearings[index], embedding };
      this.saveBearings();
      this.dispatchBearingEvent('embedding', bearingId);
    }
  }

  public updateBearingLocation(bearingId: number, location: { x: number; y: number }): void {
    const index = this._bearings.findIndex(b => b.id === bearingId);
    if (index !== -1) {
      const prev = this._bearings[index];
      this._bearings[index] = {
        ...prev,
        location: { id: prev.location?.id || `bearing-${bearingId}`, x: location.x, y: location.y },
        isFixed: true,
        fixedPosition: { x: location.x, y: location.y },
        constraintStrength: 1.0
      };
      this.saveBearings();
      this.dispatchBearingEvent('location', bearingId);
    }
  }

  // === LOAD/SAVE/EXPORT ===

  public async loadSemanticLayer(): Promise<void> {
    try {
      const { MessageService } = await import('../MessageService');
      const messageService = MessageService.getInstance();
      
      messageService.sendMessage('load-semantic-layer');
    } catch (error) {
      console.error('❌ [SemanticLayer] Failed to load semantic layer:', error);
    }
  }

  public async exportSemanticLayerYAML(datasetName: string = 'unknown'): Promise<void> {
    try {
      const { MessageService } = await import('../MessageService');
      const messageService = MessageService.getInstance();
      
      // Build semantic layer data
      const semanticLayer: SemanticLayer = {
        id: `semantic-layer-${Date.now()}`,
        datasetName,
        conceptualStatements: this._conceptualStatements,
        variableModifications: this._variableModifications,
        createdAt: new Date().toISOString(),
        lastModified: new Date().toISOString(),
        version: '1.0'
      };
      
      messageService.sendMessage('export-semantic-layer-yaml', {
        semanticLayer
      });
    } catch (error) {
      console.error('Failed to export semantic layer:', error);
    }
  }

  // === PRIVATE METHODS ===

  private async saveConceptualStatements(): Promise<void> {
    try {
      const { MessageService } = await import('../MessageService');
      const messageService = MessageService.getInstance();
      
      messageService.sendMessage('save-conceptual-statements', {
        statements: this._conceptualStatements
      });
    } catch (error) {
      console.error('Failed to save conceptual statements:', error);
    }
  }

  private async saveVariableModifications(): Promise<void> {
    try {
      const { MessageService } = await import('../MessageService');
      const messageService = MessageService.getInstance();
      
      messageService.sendMessage('save-variable-modifications', {
        modifications: this._variableModifications
      });
    } catch (error) {
      console.error('Failed to save variable modifications:', error);
    }
  }

  private saveBearings(): void {
    try {
      localStorage.setItem('meridian-bearings', JSON.stringify(this._bearings));
    } catch (error) {
      console.error('Failed to save bearings to localStorage:', error);
    }
  }

  private loadBearings(): void {
    try {
      const stored = localStorage.getItem('meridian-bearings');
      if (stored) {
        this._bearings = JSON.parse(stored);
      }
    } catch (error) {
      console.error('Failed to load bearings from localStorage:', error);
      this._bearings = [];
    }
  }

  private dispatchBearingEvent(action: string, id: number): void {
    try {
      window.dispatchEvent(new CustomEvent('bearingsUpdated', { detail: { action, id } }));
    } catch (error) {
      // Ignore event dispatch errors
    }
  }

  // Update semantic layer from backend
  public updateFromBackend(data: any): void {
    if (data.conceptualStatements) {
      this._conceptualStatements = data.conceptualStatements;
    }
    if (data.variableModifications) {
      this._variableModifications = data.variableModifications;
    }
  }

  // Clear all state
  public clearAllState(): void {
    this._conceptualStatements = [];
    this._variableModifications = {};
    this._bearings = [];
    localStorage.removeItem('meridian-bearings');
  }
}