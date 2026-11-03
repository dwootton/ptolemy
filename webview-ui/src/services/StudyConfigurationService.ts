import { FeatureFlags } from '../utils/featureFlags';

export interface ParticipantMapping {
  participantId: number;
  conditionOrder: string;
  datasetOrder: string;
}

export interface StudyConfiguration {
  participantId: number;
  conditionOrder: string;
  datasetOrder: string;
  isStudyMode: boolean;
  sessionStartTime: string;
  // Derived convenience fields for current dataset + condition
  currentDatasetSlug?: 'vehicles' | 'diamonds' | 'listings' | 'cars' | 'houses';
  currentConditionCode?: 'Map' | 'Tree' | 'Canvas';
}

export class StudyConfigurationService {
  private static instance: StudyConfigurationService;
  private configuration: StudyConfiguration | null = null;

  // Built-in participant mapping table (base schedule for P1–P9). Runover repeats.
  // Schedule key: A=Map, B=Canvas, C=Tree. X=vehicles, Y=diamonds, Z=listings.
  private readonly participantMappings: ParticipantMapping[] = [
    { participantId: 1, conditionOrder: 'MapCanvasTree', datasetOrder: 'XYZ' }, // ABC, XYZ
    { participantId: 2, conditionOrder: 'MapTreeCanvas', datasetOrder: 'XYZ' }, // ACB, XYZ
    { participantId: 3, conditionOrder: 'CanvasMapTree', datasetOrder: 'YZX' }, // BAC, YZX
    { participantId: 4, conditionOrder: 'CanvasTreeMap', datasetOrder: 'XYZ' }, // BCA, XYZ
    { participantId: 5, conditionOrder: 'TreeMapCanvas', datasetOrder: 'YZX' }, // CAB, YZX
    { participantId: 6, conditionOrder: 'TreeCanvasMap', datasetOrder: 'ZXY' }, // CBA, ZXY
    { participantId: 7, conditionOrder: 'MapCanvasTree', datasetOrder: 'YZX' }, // ABC, YZX
    { participantId: 8, conditionOrder: 'CanvasTreeMap', datasetOrder: 'ZXY' }, // BCA, ZXY
    { participantId: 9, conditionOrder: 'TreeMapCanvas', datasetOrder: 'ZXY' }, // CAB, ZXY
  ];

  private constructor() {
    this.loadConfiguration();
  }

  public static getInstance(): StudyConfigurationService {
    if (!StudyConfigurationService.instance) {
      StudyConfigurationService.instance = new StudyConfigurationService();
    }
    return StudyConfigurationService.instance;
  }

  /**
   * Check if the current build is in study mode
   */
  public static isStudyMode(): boolean {
    return FeatureFlags.STUDY_MODE_ENABLED;
  }

  /**
   * Configure participant for study
   */
  public configureParticipant(participantId: number): StudyConfiguration | null {
    if (participantId < 1) {
      throw new Error('Participant ID must be a positive number');
    }

    // Use predefined mapping if available; otherwise repeat the base P1–P9 schedule (runover)
    const mapping = this.findMappingWithRunover(participantId);

    this.configuration = {
      participantId,
      conditionOrder: mapping.conditionOrder,
      datasetOrder: mapping.datasetOrder,
      isStudyMode: true,
      sessionStartTime: new Date().toISOString(),
      currentDatasetSlug: this.mapDatasetLetterToSlug(mapping.datasetOrder[0] as 'X'|'Y'|'Z'),
      currentConditionCode: this.mapConditionPosition(mapping.conditionOrder, 0)
    };

    this.saveConfiguration();
    return this.configuration;
  }

  /**
   * Get current study configuration
   */
  public getConfiguration(): StudyConfiguration | null {
    return this.configuration;
  }

  /**
   * Get the current dataset slug (diamonds/cars/houses) if configured
   */
  public getCurrentDatasetSlug(): 'vehicles' | 'diamonds' | 'listings' | 'cars' | 'houses' | undefined {
    return this.configuration?.currentDatasetSlug;
  }

  /**
   * Get the current condition code (Map/Tree/Canvas) if configured
   */
  public getCurrentConditionCode(): 'Map' | 'Tree' | 'Canvas' | undefined {
    return this.configuration?.currentConditionCode;
  }

  /**
   * Set the active dataset slug and persist
   */
  public setCurrentDatasetSlug(slug: 'vehicles' | 'diamonds' | 'listings' | 'cars' | 'houses'): void {
    if (!this.configuration) return;
    this.configuration.currentDatasetSlug = slug;
    this.saveConfiguration();
  }

  /**
   * Get participant mapping for a specific participant ID
   */
  public getParticipantMapping(participantId: number): ParticipantMapping | null {
    return this.findMappingWithRunover(participantId);
  }

  private findMappingWithRunover(participantId: number): ParticipantMapping {
    const direct = this.participantMappings.find(m => m.participantId === participantId);
    if (direct) return direct;
    const baseSize = this.participantMappings.length; // 9
    const normalizedId = ((participantId - 1) % baseSize) + 1;
    const normalized = this.participantMappings.find(m => m.participantId === normalizedId);
    return normalized || { participantId, conditionOrder: 'MapCanvasTree', datasetOrder: 'XYZ' };
  }

  /**
   * Get all predefined participant IDs (for reference)
   */
  public getPredefinedParticipantIds(): number[] {
    // Expose P1–P15 for convenience; P10–P15 repeat P1–P6.
    return Array.from({ length: 15 }, (_, i) => i + 1);
  }

  /**
   * Reset study configuration
   */
  public resetConfiguration(): void {
    this.configuration = null;
    this.clearStoredConfiguration();
  }

  /**
   * Start a new condition: request baseline rehydration for current dataset slug
   */
  public async startNewCondition(): Promise<void> {
    if (!this.configuration?.currentDatasetSlug) return;
    try {
      const { MessageService } = await import('./MessageService');
      const messageService = MessageService.getInstance();
      const slug = this.configuration.currentDatasetSlug;
      return new Promise((resolve) => {
        const off = messageService.onMessage('checkpoint-restored', () => {
          try { off(); } catch {}
          // Client-side caches/workers should naturally refresh via existing listeners
          resolve();
        });
        messageService.sendMessage('restore-checkpoint', { datasetSlug: slug });
      });
    } catch (e) {
      console.error('Failed to start new condition via baseline restore', e);
    }
  }

  /**
   * Check if participant is configured
   */
  public isConfigured(): boolean {
    return this.configuration !== null;
  }

  /**
   * Get the first dataset for the current participant's dataset order
   */
  public getFirstDatasetForParticipant(): string | null {
    if (!this.configuration) {
      return null;
    }

    const firstDatasetLetter = this.configuration.datasetOrder[0];
    return this.mapDatasetLetterToFile(firstDatasetLetter);
  }

  /**
   * Get all datasets in order for the current participant
   */
  public getDatasetsForParticipant(): string[] {
    if (!this.configuration) {
      return [];
    }

    return this.configuration.datasetOrder
      .split('')
      .map(letter => this.mapDatasetLetterToFile(letter))
      .filter((file): file is string => file !== null);
  }

  /**
   * Map dataset letters (X, Y, Z) to actual dataset files
   * TODO: Update these mappings based on actual dataset files
   */
  private mapDatasetLetterToFile(letter: string): string | null {
    const mappings: Record<string, string> = {
      'X': 'vehicles.csv',
      'Y': 'diamonds.csv',
      'Z': 'listings.csv'
    };

    return mappings[letter] || null;
  }

  private mapDatasetLetterToSlug(letter: 'X'|'Y'|'Z'): 'vehicles'|'diamonds'|'listings' {
    const mappings: Record<'X'|'Y'|'Z','vehicles'|'diamonds'|'listings'> = {
      X: 'vehicles',
      Y: 'diamonds',
      Z: 'listings'
    };
    return mappings[letter];
  }

  private mapConditionPosition(conditionOrder: string, position: number): 'Map' | 'Tree' | 'Canvas' {
    // Extract condition at position from the order string
    if (conditionOrder.includes('MapTreeCanvas')) {
      const conditions = ['Map', 'Tree', 'Canvas'];
      return conditions[position] as 'Map' | 'Tree' | 'Canvas';
    } else if (conditionOrder.includes('MapCanvasTree')) {
      const conditions = ['Map', 'Canvas', 'Tree'];
      return conditions[position] as 'Map' | 'Tree' | 'Canvas';
    } else if (conditionOrder.includes('TreeMapCanvas')) {
      const conditions = ['Tree', 'Map', 'Canvas'];
      return conditions[position] as 'Map' | 'Tree' | 'Canvas';
    } else if (conditionOrder.includes('TreeCanvasMap')) {
      const conditions = ['Tree', 'Canvas', 'Map'];
      return conditions[position] as 'Map' | 'Tree' | 'Canvas';
    } else if (conditionOrder.includes('CanvasMapTree')) {
      const conditions = ['Canvas', 'Map', 'Tree'];
      return conditions[position] as 'Map' | 'Tree' | 'Canvas';
    } else if (conditionOrder.includes('CanvasTreeMap')) {
      const conditions = ['Canvas', 'Tree', 'Map'];
      return conditions[position] as 'Map' | 'Tree' | 'Canvas';
    }

    return 'Map'; // Default fallback
  }

  /**
   * Save configuration to localStorage
   */
  private saveConfiguration(): void {
    if (this.configuration) {
      try {
        localStorage.setItem('study_configuration', JSON.stringify(this.configuration));
      } catch (error) {
        console.warn('Failed to save study configuration:', error);
      }
    }
  }

  /**
   * Load configuration from localStorage
   */
  private loadConfiguration(): void {
    try {
      const stored = localStorage.getItem('study_configuration');
      if (stored) {
        this.configuration = JSON.parse(stored);
      }
    } catch (error) {
      console.warn('Failed to load study configuration:', error);
      this.configuration = null;
    }
  }

  /**
   * Clear stored configuration
   */
  private clearStoredConfiguration(): void {
    try {
      localStorage.removeItem('study_configuration');
    } catch (error) {
      console.warn('Failed to clear study configuration:', error);
    }
  }
}
