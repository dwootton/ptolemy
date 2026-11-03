/**
 * DatasetStateService - Handles dataset-related state operations
 */

import { DatasetInfo } from '../../components/DatasetLoader';

export class DatasetStateService {
  private static instance: DatasetStateService;
  private readonly STORAGE_KEY = 'meridian-dataset';

  private _datasetInfo: DatasetInfo | null = null;
  private _hasDataset: boolean = false;
  private isClearing = false;

  private constructor() {}

  public static getInstance(): DatasetStateService {
    if (!DatasetStateService.instance) {
      DatasetStateService.instance = new DatasetStateService();
    }
    return DatasetStateService.instance;
  }

  // Getters
  public getDatasetInfo(): DatasetInfo | null {
    return this._datasetInfo;
  }

  public getHasDataset(): boolean {
    return this._hasDataset;
  }

  // Set dataset information
  public setDataset(dataset: DatasetInfo, skipPersistence: boolean = false): void {
    this._datasetInfo = dataset;
    this._hasDataset = true;
    
    this.saveDatasetToStorage(dataset);
    
    // Only persist to extension if not already coming from extension
    if (!skipPersistence) {
      this.persistDatasetToExtension(dataset);
    }
  }

  // Clear dataset information
  public clearDataset(): void {
    if (this.isClearing) {
      return;
    }
    this.isClearing = true;
    
    this._datasetInfo = null;
    this._hasDataset = false;
    this.clearDatasetFromStorage();
    
    // Also clear from backend persistence
    this.sendClearDatasetMessage().finally(() => {
      this.isClearing = false;
    });
  }

  // Send dataset data request to backend
  public async requestDatasetData(): Promise<void> {
    try {
      const { MessageService } = await import('../MessageService');
      const messageService = MessageService.getInstance();
      messageService.sendMessage('get-dataset-data');
    } catch (error) {
      console.warn('Failed to request dataset data:', error);
    }
  }

  // Persist dataset to extension's StateManagementService
  private async persistDatasetToExtension(dataset: DatasetInfo): Promise<void> {
    try {
      const { MessageService } = await import('../MessageService');
      const messageService = MessageService.getInstance();
      messageService.sendMessage('analyze-dataset', { dataset });
    } catch (error) {
      console.warn('Failed to persist dataset to extension:', error);
    }
  }

  private async sendClearDatasetMessage(): Promise<void> {
    try {
      const { MessageService } = await import('../MessageService');
      const messageService = MessageService.getInstance();
      messageService.sendMessage('clear-dataset');
    } catch (error) {
      console.warn('Failed to send clear-dataset message:', error);
    }
  }

  private saveDatasetToStorage(dataset: DatasetInfo): void {
    try {
      // Remove data to avoid localStorage size limits, keep metadata only
      const { data, ...datasetWithoutData } = dataset;
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(datasetWithoutData));
    } catch (e) {
      console.warn('❌ [DatasetState] Failed to save dataset to localStorage:', e);
    }
  }

  private clearDatasetFromStorage(): void {
    try {
      localStorage.removeItem(this.STORAGE_KEY);
    } catch (e) {
      console.warn('❌ [DatasetState] Failed to clear dataset from storage:', e);
    }
  }

  // Initialize dataset state from storage
  public initializeFromStorage(): void {
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY);
      if (stored) {
        const dataset = JSON.parse(stored);
        this._datasetInfo = dataset;
        this._hasDataset = true;
      }
    } catch (error) {
      console.warn('Failed to initialize dataset from storage:', error);
    }
  }

  // Clear all state
  public clearAllState(): void {
    this._datasetInfo = null;
    this._hasDataset = false;
    this.clearDatasetFromStorage();
  }
}