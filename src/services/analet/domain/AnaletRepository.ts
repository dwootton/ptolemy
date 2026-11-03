/**
 * Repository interface for analet persistence
 * Abstracts away the details of how analets are stored
 */

import { Analet } from '../../../types/analet';
import { StateManagementService } from '../../StateManagementService';
import { AnaletStore } from '../../AnaletStore';
import { TelemetryService } from '../../TelemetryService';

export interface AnaletRepository {
  // Basic CRUD operations
  save(analet: Analet): Promise<void>;
  saveMany(analets: Analet[]): Promise<void>;
  findById(id: number): Promise<Analet | null>;
  findAll(): Promise<Analet[]>;
  update(analet: Analet): Promise<void>;
  delete(id: number): Promise<boolean>;

  // Query operations
  findBySource(source: string): Promise<Analet[]>;
  findByType(type: string): Promise<Analet[]>;
  findByTags(tags: string[]): Promise<Analet[]>;

  // Bulk operations
  deleteMany(ids: number[]): Promise<number>;
  updateMany(analets: Analet[]): Promise<void>;

  // Metadata operations
  count(): Promise<number>;
  exists(id: number): Promise<boolean>;
}

/**
 * Concrete implementation that uses both StateManagementService and AnaletStore
 * This ensures consistency between the old and new systems during transition
 */
export class UnifiedAnaletRepository implements AnaletRepository {
  constructor(
    private stateService: StateManagementService,
    private analetStore?: AnaletStore
  ) {}

  async save(analet: Analet): Promise<void> {
    try {
      // Check if this is a new analet (for telemetry)
      const allAnalets = await this.findAll();
      const existingIndex = allAnalets.findIndex(a => a.id === analet.id);
      const isNewAnalet = existingIndex < 0;

      // Save to both systems for consistency
      if (this.analetStore) {
        await this.analetStore.addExistingAnalet(analet);
        await this.analetStore.saveToStorage();
      }

      // Also save via state service for backward compatibility
      if (existingIndex >= 0) {
        allAnalets[existingIndex] = analet;
      } else {
        allAnalets.push(analet);
      }

      await this.stateService.saveAnalets(allAnalets);

      // Record telemetry event
      const telemetryService = TelemetryService.getInstance();
      if (isNewAnalet) {
        telemetryService.recordAnaletEvent(
          'analet_created',
          analet.id,
          {
            question: analet.statement,
            formalGrammar: analet.cellQL,
            tags: analet.tags,
            type: analet.type,
            source: analet.source,
            location: analet.location
          }
        );
      } else {
        telemetryService.recordAnaletEvent(
          'analet_edited',
          analet.id,
          {
            question: analet.statement,
            formalGrammar: analet.cellQL,
            tags: analet.tags,
            type: analet.type,
            source: analet.source,
            location: analet.location
          }
        );
      }
    } catch (error) {
      console.error(`❌ [AnaletRepository] Failed to save analet ${analet.id}:`, error);
      throw error;
    }
  }

  async saveMany(analets: Analet[]): Promise<void> {
    try {
      // Check which are new analets for telemetry
      const allAnalets = await this.findAll();
      const existingIds = new Set(allAnalets.map(a => a.id));
      const newAnalets = analets.filter(a => !existingIds.has(a.id));
      const updatedAnalets = analets.filter(a => existingIds.has(a.id));

      // Use AnaletStore for bulk operations if available
      if (this.analetStore) {
        for (const analet of analets) {
          await this.analetStore.addExistingAnalet(analet);
        }
        await this.analetStore.saveToStorage();
      }

      // Also save via state service (dedupe by id)
      const analetMap = new Map<number, Analet>(allAnalets.map(a => [a.id, a]));
      for (const analet of analets) {
        analetMap.set(analet.id, analet);
      }
      const toSave = Array.from(analetMap.values());
      await this.stateService.saveAnalets(toSave);

      // Record telemetry events for batch operations
      const telemetryService = TelemetryService.getInstance();
      for (const analet of newAnalets) {
        telemetryService.recordAnaletEvent(
          'analet_created',
          analet.id,
          {
            question: analet.statement,
            formalGrammar: analet.cellQL,
            tags: analet.tags,
            type: analet.type,
            source: analet.source,
            location: analet.location
          }
        );
      }

      for (const analet of updatedAnalets) {
        telemetryService.recordAnaletEvent(
          'analet_edited',
          analet.id,
          {
            question: analet.statement,
            formalGrammar: analet.cellQL,
            tags: analet.tags,
            type: analet.type,
            source: analet.source,
            location: analet.location
          }
        );
      }
    } catch (error) {
      console.error(`❌ [AnaletRepository] Failed to save ${analets.length} analets:`, error);
      throw error;
    }
  }

  async findById(id: number): Promise<Analet | null> {
    try {
      const analets = await this.findAll();
      const found = analets.find(a => a.id === id) || null;

      // Debug: Log what was found
      return found;
    } catch (error) {
      console.error(`❌ [AnaletRepository] Failed to find analet ${id}:`, error);
      return null;
    }
  }

  async findAll(): Promise<Analet[]> {
    try {
      // Always use StateManagementService for consistency since notebook updates go through it
      // TODO: Remove AnaletStore dependency once confirmed this fixes the issue
      const analets = await this.stateService.getAnalets();

      // Debug: Log data source being used
      return analets || [];
    } catch (error) {
      console.error(`❌ [AnaletRepository] Failed to find all analets:`, error);
      return [];
    }
  }

  async update(analet: Analet): Promise<void> {
    await this.save(analet); // Same as save for our use case
  }

  async delete(id: number): Promise<boolean> {
    try {
      // Delete from AnaletStore if available
      if (this.analetStore) {
        await this.analetStore.removeAnalet(id);
      }

      // Also delete from state service
      const allAnalets = await this.findAll();
      const filteredAnalets = allAnalets.filter(a => a.id !== id);

      if (filteredAnalets.length < allAnalets.length) {
        await this.stateService.saveAnalets(filteredAnalets);
        return true;
      }

      return false;
    } catch (error) {
      console.error(`❌ [AnaletRepository] Failed to delete analet ${id}:`, error);
      throw error;
    }
  }

  async findBySource(source: string): Promise<Analet[]> {
    const analets = await this.findAll();
    return analets.filter(a => a.source === source);
  }

  async findByType(type: string): Promise<Analet[]> {
    const analets = await this.findAll();
    const filtered = analets.filter(a => a.type === type);
    return filtered;
  }

  async findByTags(tags: string[]): Promise<Analet[]> {
    const analets = await this.findAll();
    return analets.filter(a =>
      a.tags && tags.some(tag => a.tags!.includes(tag))
    );
  }

  async deleteMany(ids: number[]): Promise<number> {
    try {
      let deletedCount = 0;

      // Delete from AnaletStore if available
      if (this.analetStore) {
        for (const id of ids) {
          const existed = await this.analetStore.removeAnalet(id);
          if (existed) deletedCount++;
        }
      } else {
        // Delete from state service
        const allAnalets = await this.findAll();
        const filteredAnalets = allAnalets.filter(a => !ids.includes(a.id));
        deletedCount = allAnalets.length - filteredAnalets.length;

        if (deletedCount > 0) {
          await this.stateService.saveAnalets(filteredAnalets);
        }
      }
      return deletedCount;
    } catch (error) {
      console.error(`❌ [AnaletRepository] Failed to delete ${ids.length} analets:`, error);
      throw error;
    }
  }

  async updateMany(analets: Analet[]): Promise<void> {
    await this.saveMany(analets); // Same as saveMany for our use case
  }

  async count(): Promise<number> {
    const analets = await this.findAll();
    return analets.length;
  }

  async exists(id: number): Promise<boolean> {
    const analet = await this.findById(id);
    return analet !== null;
  }
}
