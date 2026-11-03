import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { FirebaseLoggingService, AnaletEvent, CellEvent } from './FirebaseLoggingService';
import { StudyWorkspaceManager } from './StudyWorkspaceManager';
import { ActiveWorkspaceManager } from './ActiveWorkspaceManager';
import { EnvironmentService } from './EnvironmentService';

export interface TelemetryEvent {
  timestamp: number;
  type: string;
  data: any;
  sessionId: string;
  userId?: string;
}

export interface RRWebEvent {
  timestamp: number;
  data: any;
  sessionId: string;
  userId?: string;
}

export interface InstrumentationEvent {
  timestamp: number;
  sessionId: string;
  eventType: 'interaction' | 'navigation' | 'performance' | 'ui_state';
  category: 'analysis_map' | 'filter' | 'dataset_dictionary' | 'analysis_list' | 'settings' | 'general';
  action: string;
  details: Record<string, any>;
  viewport: { width: number; height: number };
  userId?: string;
}

export class TelemetryService {
  private static instance: TelemetryService;
  private logsDir: string;
  private sessionId: string;
  private telemetryFile: string;
  private rrwebFile: string;
  private instrumentationFile: string;
  private telemetryBuffer: TelemetryEvent[] = [];
  private rrwebBuffer: RRWebEvent[] = [];
  private instrumentationBuffer: InstrumentationEvent[] = [];
  private flushInterval: NodeJS.Timer | undefined;
  private isInstrumentationEnabled: boolean = false;
  private workspaceRoot: string;
  private firebaseService: FirebaseLoggingService;
  private context: vscode.ExtensionContext;
  private currentDatasetName: string | undefined;
  private studyContext: {
    isStudyMode?: boolean;
    participantId?: number;
    datasetSlug?: 'vehicles' | 'diamonds' | 'listings' | 'cars' | 'houses';
    conditionCode?: 'Map' | 'Tree' | 'Canvas';
    studyLabel?: string;
  } = {};

  private constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.sessionId = this.generateSessionId();

    // Initialize Firebase service
    this.firebaseService = FirebaseLoggingService.getInstance();

    // Prefer active workspace root for logs; fall back to study/dataset if not set
    const activeManager = ActiveWorkspaceManager.getInstance(context);
    this.workspaceRoot = activeManager.getActiveRoot();
    this.logsDir = activeManager.getLogsDir();

    const sessionPrefix = this.sessionId;
    const datasetPrefix = this.getDatasetPrefix();
    this.telemetryFile = path.join(this.logsDir, `${datasetPrefix}session_${sessionPrefix}.jsonl`);
    this.rrwebFile = path.join(this.logsDir, `${datasetPrefix}replay_${sessionPrefix}.jsonl`);
    this.instrumentationFile = path.join(this.logsDir, `${datasetPrefix}instrumentation_${sessionPrefix}.jsonl`);

    this.updateInstrumentationConfiguration();

    // Listen for configuration changes
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('meridian.firebase')) {
        this.updateFirebaseConfiguration();
      }
      if (e.affectsConfiguration('meridian.instrumentation.enabled')) {
        this.updateInstrumentationConfiguration();
      }
    });
  }

  public static getInstance(context?: vscode.ExtensionContext): TelemetryService {
    if (!TelemetryService.instance) {
      if (!context) {
        throw new Error('TelemetryService context required for first initialization');
      }
      TelemetryService.instance = new TelemetryService(context);
    }
    return TelemetryService.instance;
  }
  /**
   * Update study context and re-point log file locations if needed
   */
  public setStudyContext(context: {
    isStudyMode?: boolean;
    participantId?: number;
    datasetSlug?: 'vehicles' | 'diamonds' | 'listings' | 'cars' | 'houses';
    conditionCode?: 'Map' | 'Tree' | 'Canvas';
    studyLabel?: string;
  }): void {
    this.studyContext = { ...this.studyContext, ...context };
    // Recompute directories preferring ActiveWorkspaceManager
    const activeManager = ActiveWorkspaceManager.getInstance(this.context);
    this.workspaceRoot = activeManager.getActiveRoot();
    this.logsDir = activeManager.getLogsDir();
    this.ensureLogsDirectory();
    const sessionPrefix = this.sessionId;
    const datasetPrefix = this.getDatasetPrefix();
    this.telemetryFile = path.join(this.logsDir, `${datasetPrefix}session_${sessionPrefix}.jsonl`);
    this.rrwebFile = path.join(this.logsDir, `${datasetPrefix}replay_${sessionPrefix}.jsonl`);
    this.instrumentationFile = path.join(this.logsDir, `${datasetPrefix}instrumentation_${sessionPrefix}.jsonl`);
  }

  /**
   * End current session and start a new one (used when advancing condition)
   */
  public restartSession(): void {
    try {
      // Flush existing buffers
      this.flushBuffers();
    } catch {}
    // New session id and files in the (possibly new) logs dir
    this.sessionId = this.generateSessionId();
    const activeManager = ActiveWorkspaceManager.getInstance(this.context);
    this.logsDir = activeManager.getLogsDir();
    this.ensureLogsDirectory();
    const sessionPrefix = this.sessionId;
    const datasetPrefix = this.getDatasetPrefix();
    this.telemetryFile = path.join(this.logsDir, `${datasetPrefix}session_${sessionPrefix}.jsonl`);
    this.rrwebFile = path.join(this.logsDir, `${datasetPrefix}replay_${sessionPrefix}.jsonl`);
    this.instrumentationFile = path.join(this.logsDir, `${datasetPrefix}instrumentation_${sessionPrefix}.jsonl`);
  }

  /**
   * Refresh file paths and directories from the ActiveWorkspaceManager.
   * If restart is true, starts a new session with files under the new root.
   */
  public refreshPathsFromActiveWorkspace(restart: boolean = true): void {
    const activeManager = ActiveWorkspaceManager.getInstance(this.context);
    this.workspaceRoot = activeManager.getActiveRoot();
    this.logsDir = activeManager.getLogsDir();
    this.ensureLogsDirectory();
    if (restart) {
      this.sessionId = this.generateSessionId();
    }
    const sessionPrefix = this.sessionId;
    const datasetPrefix = this.getDatasetPrefix();
    this.telemetryFile = path.join(this.logsDir, `${datasetPrefix}session_${sessionPrefix}.jsonl`);
    this.rrwebFile = path.join(this.logsDir, `${datasetPrefix}replay_${sessionPrefix}.jsonl`);
    this.instrumentationFile = path.join(this.logsDir, `${datasetPrefix}instrumentation_${sessionPrefix}.jsonl`);
  }


  private generateSessionId(): string {
    return new Date().toISOString().replace(/[:.]/g, '-');
  }

  private ensureLogsDirectory(): void {
    if (!this.isInstrumentationEnabled) return;
    if (!fs.existsSync(this.logsDir)) {
      fs.mkdirSync(this.logsDir, { recursive: true });
    }
  }

  private startFlushTimer(): void {
    if (this.flushInterval) return;
    // Flush telemetry data every 10 seconds
    this.flushInterval = setInterval(() => {
      this.flushBuffers();
    }, 10000);
  }

  public recordTelemetryEvent(type: string, data: any): void {
    if (!this.isInstrumentationEnabled) return;
    const studyContext = this.getStudyContext();

    const event: TelemetryEvent = {
      timestamp: Date.now(),
      type,
      data: {
        ...data,
        ...studyContext
      },
      sessionId: this.sessionId
    };

    this.telemetryBuffer.push(event);

    // If buffer gets too large, flush immediately
    if (this.telemetryBuffer.length >= 50) {
      this.flushBuffers();
    }
  }

  public recordRRWebEvent(data: any): void {
    if (!this.isInstrumentationEnabled) {
      return;
    }

    const event: RRWebEvent = {
      timestamp: Date.now(),
      data,
      sessionId: this.sessionId
    };

    this.rrwebBuffer.push(event);
    // If buffer gets too large, flush immediately
    if (this.rrwebBuffer.length >= 100) {
      this.flushBuffers();
    }
  }

  public recordInstrumentationEvent(event: Omit<InstrumentationEvent, 'timestamp' | 'sessionId'>): void {
    if (!this.isInstrumentationEnabled) return;

    const studyContext = this.getStudyContext();

    const instrumentationEvent: InstrumentationEvent = {
      ...event,
      timestamp: Date.now(),
      sessionId: this.sessionId,
      details: {
        ...event.details,
        ...studyContext
      }
    };

    this.instrumentationBuffer.push(instrumentationEvent);

    // If buffer gets too large, flush immediately
    if (this.instrumentationBuffer.length >= 50) {
      this.flushBuffers();
    }
  }

  public setInstrumentationEnabled(enabled: boolean): void {
    this.isInstrumentationEnabled = enabled;
    if (enabled) {
      this.ensureLogsDirectory();
      this.startFlushTimer();
    } else {
      this.telemetryBuffer = [];
      this.rrwebBuffer = [];
      this.instrumentationBuffer = [];
      if (this.flushInterval) {
        clearInterval(this.flushInterval);
        this.flushInterval = undefined;
      }
    }
    this.updateFirebaseConfiguration();
  }

  public isInstrumentationActive(): boolean {
    return this.isInstrumentationEnabled;
  }

  private updateInstrumentationConfiguration(): void {
    const config = vscode.workspace.getConfiguration('meridian.instrumentation');
    const enabled = config.get<boolean>('enabled', false);
    this.setInstrumentationEnabled(enabled);
  }

  private updateFirebaseConfiguration(): void {
    const config = vscode.workspace.getConfiguration('meridian.firebase');
    const isEnabled = config.get<boolean>('enabled', false);

    // Also check environment variable
    const envEnabled = EnvironmentService.getInstance().get('FIREBASE_ENABLED') === 'true';
    const finalEnabled = this.isInstrumentationEnabled && (isEnabled || envEnabled);

    // Optional: Firestore emulator support
    const emulatorEnabled = config.get<boolean>('emulator.enabled', false);
    const logLevel = config.get<string>('logLevel');
    if (finalEnabled && emulatorEnabled) {
      const host = config.get<string>('emulator.host', '127.0.0.1')!;
      const port = config.get<number>('emulator.port', 8080)!;
      // Apply directly to the Firebase service (prefer explicit call over env timing)
      try {
        this.firebaseService.useEmulator(host, port, (logLevel as any) || undefined);
      } catch {}
      // Also set env for any other Firebase usage paths
      process.env.FIRESTORE_EMULATOR_HOST = `${host}:${port}`;
    }
    // Optional: client log level via env for constructor path
    if (logLevel) process.env.FIREBASE_LOG_LEVEL = logLevel;

    this.firebaseService.setEnabled(finalEnabled);

    // Set user ID if provided
    const userId = config.get<string>('userId') || EnvironmentService.getInstance().get('FIREBASE_USER_ID');
    if (userId && finalEnabled) {
      // Add userId to future events by storing it
      this.addUserIdToEvents(userId);
    }
  }

  private addUserIdToEvents(userId: string): void {
    // Add userId to all buffered events that don't already have one
    this.telemetryBuffer.forEach(event => {
      if (!event.userId) {
        event.userId = userId;
      }
    });
    this.rrwebBuffer.forEach(event => {
      if (!event.userId) {
        event.userId = userId;
      }
    });
    this.instrumentationBuffer.forEach(event => {
      if (!event.userId) {
        event.userId = userId;
      }
    });
  }

  /**
   * Get current study context for enrichment
   */
  private getStudyContext(): Record<string, any> {
    const ctx = this.studyContext || {};
    return {
      isStudyMode: ctx.isStudyMode,
      participantId: ctx.participantId,
      dataset: ctx.datasetSlug,
      conditionCode: ctx.conditionCode,
      studyLabel: ctx.studyLabel
    };
  }

  private flushBuffers(): void {
    if (!this.isInstrumentationEnabled) return;

    // Unified pipeline: write to local files and Firebase with identical data
    if (this.telemetryBuffer.length > 0) {
      const events = [...this.telemetryBuffer];
      this.telemetryBuffer = [];

      // Write to both destinations with same data
      this.writeEventsToLocal(events, 'session-info');
      this.firebaseService.uploadTelemetryEvents(events);
    }

    if (this.rrwebBuffer.length > 0 && this.isInstrumentationEnabled) {
      const events = [...this.rrwebBuffer];
      this.rrwebBuffer = [];

      // Write to both destinations with same data (chunked for Firebase)
      this.writeEventsToLocal(events, 'session-replay');
      this.firebaseService.uploadRRWebEvents(events);
    }

    if (this.instrumentationBuffer.length > 0 && this.isInstrumentationEnabled) {
      const events = [...this.instrumentationBuffer];
      this.instrumentationBuffer = [];

      // Write to both destinations with same data
      this.writeEventsToLocal(events, 'session-instrumentation');
      this.firebaseService.uploadInstrumentationEvents(events);
    }
  }

  /**
   * Unified method to write events to local files with consistent structure
   */
  private writeEventsToLocal(events: any[], eventType: 'session-info' | 'session-replay' | 'session-instrumentation'): void {
    if (!this.isInstrumentationEnabled) return;
    try {
      let targetFile: string;
      let logContext = '';

      switch (eventType) {
        case 'session-info':
          targetFile = this.telemetryFile;
          logContext = 'telemetry';
          break;
        case 'session-replay':
          targetFile = this.rrwebFile;
          logContext = 'RRWeb';
          break;
        case 'session-instrumentation':
          targetFile = this.instrumentationFile;
          logContext = 'instrumentation';
          break;
        default:
          throw new Error(`Unknown event type: ${eventType}`);
      }

      // Add metadata to match Firebase structure and include dataset for easy filtering
      const currentDataset = this.currentDatasetName || this.studyContext?.datasetSlug;
      const enrichedEvents = events.map(event => ({
        ...event,
        eventCategory: eventType,
        localTimestamp: Date.now(),
        writeSource: 'local',
        ...(currentDataset ? { dataset: currentDataset } : {})
      }));

      const lines = enrichedEvents.map(event => JSON.stringify(event)).join('\n') + '\n';
      fs.appendFileSync(targetFile, lines);

    } catch (error) {
      console.error(`[TelemetryService] Failed to write ${eventType} events:`, error);
      console.error(`[TelemetryService] Events count: ${events.length}`);
    }
  }

  /**
   * Flush all buffered logs locally and force-upload any queued Firebase logs
   */
  public async flushAll(): Promise<void> {
    try {
      // Flush local buffers and enqueue to Firebase
      this.flushBuffers();
      // Ensure Firebase queue is processed
      await this.firebaseService.flushQueue();
    } catch (error) {
      console.error('[TelemetryService] Failed to flush all logs:', error);
    }
  }

  /**
   * Set the current dataset name for log enrichment and filename prefixing
   */
  public setCurrentDatasetName(name: string | undefined): void {
    this.currentDatasetName = typeof name === 'string' && name.trim().length > 0 ? name.trim() : undefined;
  }

  /**
   * Compute a safe dataset prefix to prepend to filenames (lowercased, non-alphanumerics replaced with _)
   */
  private getDatasetPrefix(): string {
    const datasetBase = this.currentDatasetName || this.studyContext?.datasetSlug;
    const labelBase = this.studyContext?.studyLabel;
    const labelPart = labelBase ? `${String(labelBase).toLowerCase().replace(/[^a-z0-9-_]+/g, '_')}_` : '';
    if (!datasetBase) return labelPart;
    const safeDataset = String(datasetBase).toLowerCase().replace(/[^a-z0-9-_]+/g, '_');
    return `${labelPart}${safeDataset}_`;
  }

  public getSessionId(): string {
    return this.sessionId;
  }

  public getLogsDir(): string {
    return this.logsDir;
  }

  public getWorkspaceRoot(): string {
    return this.workspaceRoot;
  }

  // New methods for analet-specific events
  public recordAnaletEvent(
    eventType: 'analet_created' | 'analet_edited' | 'analet_linked' | 'analet_unlinked' | 'analet_interaction',
    analetId: number,
    analetData?: any,
    action?: string,
    details?: Record<string, any>
  ): void {
    if (!this.isInstrumentationEnabled) return;
    const config = vscode.workspace.getConfiguration('meridian.firebase');
    const userId = config.get<string>('userId') || EnvironmentService.getInstance().get('FIREBASE_USER_ID');
    const studyContext = this.getStudyContext();

    const event: AnaletEvent = {
      timestamp: Date.now(),
      sessionId: this.sessionId,
      userId,
      eventType,
      analetId,
      analetData,
      action,
      details: {
        ...details,
        ...studyContext
      },
      data: {
        eventType,
        analetId,
        analetData,
        action,
        details: {
          ...details,
          ...studyContext
        }
      }
    };

    // Send directly to Firebase (don't buffer these critical events)
    this.firebaseService.uploadAnaletEvent(event);

    // Also record as regular telemetry event for local logging
    this.recordTelemetryEvent(`analet_${eventType}`, {
      analetId,
      analetData,
      action,
      details
    });
  }

  // New method for cell execution and navigation events
  public recordCellEvent(
    eventType: 'cell_executed' | 'cell_navigated' | 'cell_edited',
    notebookPath: string,
    cellId: string,
    cellIndex?: number,
    linkedAnaletId?: number,
    variables?: Record<string, any>,
    output?: string,
    action?: string,
    details?: Record<string, any>
  ): void {
    if (!this.isInstrumentationEnabled) return;
    const config = vscode.workspace.getConfiguration('meridian.firebase');
    const userId = config.get<string>('userId') || EnvironmentService.getInstance().get('FIREBASE_USER_ID');
    const studyContext = this.getStudyContext();

    const event: CellEvent = {
      timestamp: Date.now(),
      sessionId: this.sessionId,
      userId,
      eventType,
      notebookPath,
      cellId,
      cellIndex,
      linkedAnaletId,
      variables,
      output,
      action,
      details: {
        ...details,
        ...studyContext
      },
      data: {
        eventType,
        notebookPath,
        cellId,
        cellIndex,
        linkedAnaletId,
        variables,
        output,
        action,
        details: {
          ...details,
          ...studyContext
        }
      }
    };

    // Send directly to Firebase (don't buffer these critical events)
    this.firebaseService.uploadCellEvent(event);

    // Also record as regular telemetry event for local logging
    this.recordTelemetryEvent(`cell_${eventType}`, {
      notebookPath,
      cellId,
      cellIndex,
      linkedAnaletId,
      variables,
      output,
      action,
      details
    });
  }

  public dispose(): void {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = undefined;
    }

    // Final flush before disposing
    this.flushBuffers();
  }
}
