import * as vscode from 'vscode';
import { Analet } from '../types/analet';
import { StateManagementService, AnaletMetadata } from './StateManagementService';

export class AnaletStorageService {
  private static instance: AnaletStorageService;
  private stateService?: StateManagementService;

  private constructor() {
    // StateManagementService will be initialized when needed
  }

  public static getInstance(): AnaletStorageService {
    if (!AnaletStorageService.instance) {
      AnaletStorageService.instance = new AnaletStorageService();
    }
    return AnaletStorageService.instance;
  }

  private getStateService(): StateManagementService {
    if (!this.stateService) {
      // Get the existing instance (should already be initialized)
      this.stateService = StateManagementService.getInstance();
    }
    return this.stateService;
  }

  public async saveAnalets(analets: Analet[], metadata?: Partial<AnaletMetadata>): Promise<void> {
    try {
      const stateService = this.getStateService();
      await stateService.saveAnalets(analets, metadata);
    } catch (error) {
      console.error('❌ [AnaletStorage] Failed to save analets:', error);
      throw error;
    }
  }

  public async loadAnalets(): Promise<Analet[] | null> {
    try {
      const stateService = this.getStateService();
      const analets = await stateService.loadAnalets();


      return analets;
    } catch (error) {
      console.error('❌ [AnaletStorage] Failed to load analets:', error);
      return null;
    }
  }

  public async analetsExist(): Promise<boolean> {
    try {
      const stateService = this.getStateService();
      const exists = await stateService.analetsExist();
      return exists;
    } catch (error) {
      console.error('❌ [AnaletStorage] Error checking analets existence:', error);
      return false;
    }
  }

  public async getAnaletMetadata(): Promise<AnaletMetadata | null> {
    try {
      const stateService = this.getStateService();
      const metadata = await stateService.getAnaletMetadata();


      return metadata;
    } catch (error) {
      console.error('❌ [AnaletStorage] Failed to get analet metadata:', error);
      return null;
    }
  }

  public async deleteAnalets(): Promise<void> {
    try {
      const stateService = this.getStateService();
      // Clear analet-related data
      await stateService.clearAllData();
    } catch (error) {
      console.error('❌ [AnaletStorage] Failed to delete analets:', error);
      throw error;
    }
  }

  // Legacy method for backward compatibility
  public async getStorageInfo(): Promise<{ exists: boolean; count: number; lastModified?: string }> {
    try {
      const metadata = await this.getAnaletMetadata();
      const exists = await this.analetsExist();

      return {
        exists,
        count: metadata?.analetCount || 0,
        lastModified: metadata?.lastUpdated
      };
    } catch (error) {
      console.error('❌ [AnaletStorage] Failed to get storage info:', error);
      return { exists: false, count: 0 };
    }
  }
}
