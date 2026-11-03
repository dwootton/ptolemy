/**
 * UIStateMessageHandler - Handles UI state management operations
 */

import { BaseMessageHandler } from '../BaseMessageHandler';
import { MessageContext } from '../types';

export class UIStateMessageHandler extends BaseMessageHandler {

  constructor() {
    super([
      'save-ui-state',
      'save-hierarchy-state',
      'load-hierarchy-state',
      // Constraints persistence
      'save-analet-constraints',
      'load-analet-constraints',
      // Materialized analets persistence
      'save-materialized-analets',
      'load-materialized-analets'
    ]);
  }

  public async handle(messageType: string, data: any, context: MessageContext): Promise<void> {
    switch (messageType) {
      case 'save-ui-state':
        await this.handleSaveUIState(data);
        break;
      case 'save-hierarchy-state':
        await this.handleSaveHierarchyState(data);
        break;
      case 'load-hierarchy-state':
        await this.handleLoadHierarchyState();
        break;
      case 'save-analet-constraints':
        await this.handleSaveAnaletConstraints(data);
        break;
      case 'load-analet-constraints':
        await this.handleLoadAnaletConstraints();
        break;
      case 'save-materialized-analets':
        await this.handleSaveMaterializedAnalets(data);
        break;
      case 'load-materialized-analets':
        await this.handleLoadMaterializedAnalets();
        break;
      default:
        throw new Error(`Unsupported message type: ${messageType}`);
    }
  }

  /**
   * Save general UI state
   */
  private async handleSaveUIState(data: any): Promise<void> {
    try {
      if (!this.context?.stateService) {
        throw new Error('StateService not available');
      }

      this.log('info', 'Saving UI state', { keys: Object.keys(data || {}) });
      
      // Save UI state to the state service
      if (data) {
        await this.context.stateService.saveUIState(data);
      }

      await this.sendMessage('ui-state-saved', {
        success: true,
        timestamp: Date.now()
      });

    } catch (error: any) {
      await this.sendError('save-ui-state', (error as Error) || new Error(String(error)), data);
    }
  }

  /**
   * Save hierarchy state (folders, clusters, etc.)
   */
  private async handleSaveHierarchyState(data: any): Promise<void> {
    try {
      if (!this.context?.stateService) {
        throw new Error('StateService not available');
      }

      this.log('info', 'Saving hierarchy state', { 
        hasHierarchyState: !!data?.hierarchyState,
        clustersCount: data?.detectedClusters?.length || 0,
        selectedFolder: data?.selectedFolderName 
      });

      const stateService = this.context.stateService;

      // Save hierarchy state
      if (data?.hierarchyState) {
        await stateService.saveHierarchyState(data.hierarchyState);
      }

      // Save detected clusters
      if (data?.detectedClusters) {
        await stateService.saveDetectedClusters(data.detectedClusters);
      }

      // Save selected folder
      if (data?.selectedFolderName !== undefined) {
        await stateService.saveSelectedFolder(data.selectedFolderName);
      }

      await this.sendMessage('hierarchy-state-saved', {
        success: true,
        timestamp: Date.now()
      });

    } catch (error: any) {
      await this.sendError('save-hierarchy-state', (error as Error) || new Error(String(error)), data);
    }
  }

  /**
   * Load hierarchy state
   */
  private async handleLoadHierarchyState(): Promise<void> {
    try {
      if (!this.context?.stateService) {
        throw new Error('StateService not available');
      }

      this.log('info', 'Loading hierarchy state');

      const stateService = this.context.stateService;
      
      // Get current hierarchy state
      const hierarchyState = await stateService.loadHierarchyState();
      const detectedClusters = await stateService.loadDetectedClusters();
      const selectedFolderName = await stateService.loadSelectedFolder();

      if (hierarchyState || detectedClusters?.length || selectedFolderName) {
        await this.sendMessage('hierarchy-state-restored', {
          success: true,
          hierarchyState,
          detectedClusters,
          selectedFolderName
        });

        this.log('info', 'Hierarchy state loaded successfully', {
          hasHierarchyState: !!hierarchyState,
          clustersCount: detectedClusters?.length || 0,
          selectedFolder: selectedFolderName
        });
      } else {
        await this.sendMessage('hierarchy-state-restored', {
          success: true,
          hierarchyState: null,
          detectedClusters: [],
          selectedFolderName: null,
          message: 'No hierarchy state found'
        });

        this.log('info', 'No hierarchy state found');
      }

    } catch (error: any) {
      await this.sendError('load-hierarchy-state', (error as Error) || new Error(String(error)));
    }
  }

  /**
   * Persist analet constraints from the webview
   */
  private async handleSaveAnaletConstraints(data: any): Promise<void> {
    try {
      if (!this.context?.stateService) {
        throw new Error('StateService not available');
      }
      const constraints = Array.isArray(data?.constraints) ? data.constraints : [];
      await this.context.stateService.saveAnaletConstraints(constraints);
      await this.sendMessage('analet-constraints-saved', { success: true, count: constraints.length });
    } catch (error: any) {
      await this.sendError('save-analet-constraints', (error as Error) || new Error(String(error)), data);
    }
  }

  /**
   * Load analet constraints for the webview
   */
  private async handleLoadAnaletConstraints(): Promise<void> {
    try {
      if (!this.context?.stateService) {
        throw new Error('StateService not available');
      }
      const constraints = await this.context.stateService.loadAnaletConstraints();
      await this.sendMessage('analet-constraints-loaded', { success: true, constraints: constraints || [] });
    } catch (error: any) {
      await this.sendError('load-analet-constraints', (error as Error) || new Error(String(error)));
    }
  }

  /**
   * Save materialized analets to backend storage
   */
  private async handleSaveMaterializedAnalets(data: any): Promise<void> {
    try {
      if (!this.context?.stateService) {
        throw new Error('StateService not available');
      }
      
      const { materializedIds, datasetName } = data;
      if (!Array.isArray(materializedIds)) {
        throw new Error('materializedIds must be an array');
      }
      
      // Validate that all IDs are numbers
      const validIds = materializedIds.filter(id => typeof id === 'number');
      if (validIds.length !== materializedIds.length) {
        console.warn('Some materialized IDs were not numbers and were filtered out');
      }
      
      await this.context.stateService.saveMaterializedAnalets(validIds, datasetName);
      await this.sendMessage('materialized-analets-saved', { success: true });
    } catch (error: any) {
      await this.sendError('save-materialized-analets', (error as Error) || new Error(String(error)), data);
    }
  }

  /**
   * Load materialized analets from backend storage
   */
  private async handleLoadMaterializedAnalets(): Promise<void> {
    try {
      if (!this.context?.stateService) {
        throw new Error('StateService not available');
      }
      
      const materializedIds = await this.context.stateService.loadMaterializedAnalets();
      await this.sendMessage('materialized-analets-loaded', { success: true, materializedIds: materializedIds || [] });
    } catch (error: any) {
      await this.sendError('load-materialized-analets', (error as Error) || new Error(String(error)));
    }
  }

}