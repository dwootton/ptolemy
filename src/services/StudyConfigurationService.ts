import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { z } from 'zod';
import { StudyWorkspaceManager } from './StudyWorkspaceManager';

const StudyJsonSchema = z.object({
  participantId: z.number().int().positive().optional(),
  participantLabel: z.string().optional(),
  dataset: z.enum(['vehicles', 'diamonds', 'listings', 'cars', 'houses']),
  condition: z.enum(['tree', 'map', 'canvas']),
  conditionCode: z.enum(['A', 'B', 'C']).optional(),
  // 1-based order the condition occurred in for this participant (1, 2, or 3)
  order: z.number().int().min(1).max(3).optional(),
  // Optional template checkpoint reference used during restore
  from_template: z.string().optional(),
  // Optional schedule mapping (kept for traceability)
  conditionOrder: z.string().optional(),
  datasetOrder: z.string().optional()
});

export type StudyJson = z.infer<typeof StudyJsonSchema>;

/**
 * Extension-side StudyConfigurationService
 * - Reads/writes study.json in the active dataset folder
 * - Validates schema and provides typed accessors
 */
export class StudyConfigurationService {
  private static instance: StudyConfigurationService;
  private context: vscode.ExtensionContext | undefined;

  private constructor() {}

  public static getInstance(context?: vscode.ExtensionContext): StudyConfigurationService {
    if (!StudyConfigurationService.instance) {
      StudyConfigurationService.instance = new StudyConfigurationService();
    }
    if (context) StudyConfigurationService.instance.initialize(context);
    return StudyConfigurationService.instance;
  }

  private initialize(context: vscode.ExtensionContext): void {
    if (this.context) return;
    this.context = context;
  }

  private getStudyJsonPath(): string {
    const manager = StudyWorkspaceManager.getInstance(this.context!);
    const datasetRoot = manager.getDatasetRoot();
    return path.join(datasetRoot, 'study.json');
  }

  public readConfig(): StudyJson | null {
    try {
      const filePath = this.getStudyJsonPath();
      if (!fs.existsSync(filePath)) return null;
      const raw = fs.readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      const result = StudyJsonSchema.safeParse(parsed);
      if (result.success) return result.data;
      console.warn('⚠️ [StudyConfigurationService] Invalid study.json:', result.error.flatten());
      return null;
    } catch (error) {
      console.error('❌ [StudyConfigurationService] Failed to read study.json:', error);
      return null;
    }
  }

  public writeConfig(config: StudyJson): boolean {
    try {
      const valid = StudyJsonSchema.parse(config);
      const filePath = this.getStudyJsonPath();
      fs.writeFileSync(filePath, JSON.stringify(valid, null, 2), 'utf-8');
      return true;
    } catch (error) {
      console.error('❌ [StudyConfigurationService] Failed to write study.json:', error);
      return false;
    }
  }

  public setCondition(condition: 'tree' | 'map' | 'canvas', conditionCode?: 'A' | 'B' | 'C'): boolean {
    const current = this.readConfig();
    const next: StudyJson = {
      participantId: current?.participantId,
      dataset: current?.dataset || 'diamonds',
      condition,
      conditionCode: conditionCode || current?.conditionCode
    };
    return this.writeConfig(next);
  }
}
