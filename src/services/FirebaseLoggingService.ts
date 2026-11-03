import { initializeApp, FirebaseApp, FirebaseOptions } from "firebase/app";
import { getFirestore, Firestore, collection, writeBatch, doc, connectFirestoreEmulator, setLogLevel } from "firebase/firestore";
import { TelemetryEvent, RRWebEvent, InstrumentationEvent } from './TelemetryService';

import { EnvironmentService } from './EnvironmentService';

export interface FirebaseLogEntry {
  timestamp: number;
  sessionId: string;
  userId?: string;
  data: any;
}

export interface AnaletEvent extends FirebaseLogEntry {
  eventType: 'analet_created' | 'analet_edited' | 'analet_linked' | 'analet_unlinked' | 'analet_interaction';
  analetId?: number;
  analetData?: any;
  action?: string;
  details?: Record<string, any>;
}

export interface CellEvent extends FirebaseLogEntry {
  eventType: 'cell_executed' | 'cell_navigated' | 'cell_edited';
  notebookPath?: string;
  cellId?: string;
  cellIndex?: number;
  linkedAnaletId?: number;
  variables?: Record<string, any>;
  output?: string;
  action?: string;
  details?: Record<string, any>;
}

export class FirebaseLoggingService {
  private static instance: FirebaseLoggingService;
  private app: FirebaseApp | undefined;
  private db: Firestore | undefined;
  private isEnabled: boolean = false;
  private uploadQueue: any[] = [];
  private isUploading: boolean = false;
  private maxBatchSize: number = 500;
  private maxBatchBytes: number = 8 * 1024 * 1024; // ~8MB safety ceiling per commit
  private maxRetries: number = 3;
  private retryDelay: number = 1000; // 1 second
  private maxChunkSizeBytes: number = 1024 * 1024; // 1MB Firestore document limit
  private replayChunkCounter: number = 0;

  private constructor() {}

  private initialize(): boolean {
    const environment = EnvironmentService.getInstance();
    try {
      const rawConfig = environment.get('FIREBASE_CONFIG');
      if (!rawConfig) {
        console.warn('[FirebaseLoggingService] Logging requires FIREBASE_CONFIG with your Firebase project settings.');
        return false;
      }
      const config = JSON.parse(rawConfig) as FirebaseOptions | null;
      if (!config || ![config.projectId, config.apiKey, config.appId].every(value => typeof value === 'string' && value.trim())) {
        console.warn('[FirebaseLoggingService] FIREBASE_CONFIG must include projectId, apiKey and appId.');
        return false;
      }
      this.app = initializeApp(config);
      this.db = getFirestore(this.app);
      const emulator = environment.get('FIRESTORE_EMULATOR_HOST');
      if (emulator) {
        const [host, port] = emulator.split(':');
        connectFirestoreEmulator(this.db, host, Number(port) || 8080);
      }
      const logLevel = environment.get('FIREBASE_LOG_LEVEL');
      if (logLevel) setLogLevel(logLevel as 'debug' | 'error' | 'silent');
      return true;
    } catch {
      // Do not include supplied project configuration or credentials in logs.
      console.warn('[FirebaseLoggingService] Could not initialize logging; check FIREBASE_CONFIG and emulator settings.');
      this.db = undefined;
      return false;
    }
  }

  /**
   * Optionally redirect Firestore calls to a local emulator. Must be called
   * before any network operations occur.
   */
  public useEmulator(host: string, port: number, logLevel?: 'debug' | 'error' | 'silent'): void {
    if (!this.db) return;
    try {
      connectFirestoreEmulator(this.db, host, port);
      if (logLevel) setLogLevel(logLevel);
      console.warn(`[FirebaseLoggingService] Connected to Firestore emulator at ${host}:${port}`);
    } catch (e) {
      console.warn('[FirebaseLoggingService] Failed to connect to Firestore emulator via config:', e);
    }
  }

  public static getInstance(): FirebaseLoggingService {
    if (!FirebaseLoggingService.instance) {
      FirebaseLoggingService.instance = new FirebaseLoggingService();
    }
    return FirebaseLoggingService.instance;
  }

  public setEnabled(enabled: boolean): void {
    this.isEnabled = enabled && (!!this.db || this.initialize());
    if (this.isEnabled && this.uploadQueue.length > 0) {
      this.processUploadQueue();
    } else if (!this.isEnabled) {
      // Clear queue when disabled for privacy
      this.uploadQueue = [];
    }
  }

  public isFirebaseEnabled(): boolean {
    return this.isEnabled;
  }

  // Upload telemetry events to Firebase (general session info)
  public async uploadTelemetryEvents(events: TelemetryEvent[]): Promise<void> {
    if (!this.isEnabled || events.length === 0) return;

    const firebaseEvents: any[] = [];
    for (const event of events) {
      const base = {
        ...event,
        collectionName: 'session-info',
        eventCategory: 'session-info',
        firebaseTimestamp: Date.now(),
        writeSource: 'firebase'
      } as any;
      // Chunk if this single event exceeds the safe size
      if (this.getEventSizeBytes(base) > this.maxChunkSizeBytes) {
        firebaseEvents.push(...this.chunkLargeEventDoc(base));
      } else {
        firebaseEvents.push(base);
      }
    }

    this.queueForUpload(firebaseEvents);
  }

  // Upload RRWeb events to Firebase (session replay) with 1MB chunking
  public async uploadRRWebEvents(events: RRWebEvent[]): Promise<void> {
    if (!this.isEnabled || events.length === 0) return;

    // Chunk events and store one Firestore document per chunk to avoid oversized batches
    const chunks = this.chunkRRWebEvents(events);

    const firebaseChunkDocs = chunks.map(chunk => ({
      // Per-chunk document containing the events array
      timestamp: Date.now(),
      sessionId: events[0]?.sessionId,
      userId: events[0]?.userId,
      events: chunk.events.map(ev => this.sanitizeForFirestore(ev)),
      eventCategory: 'session-replay',
      collectionName: 'session-replay',
      chunkId: chunk.chunkId,
      chunkIndex: chunk.chunkIndex,
      totalChunks: chunks.length,
      chunkSizeBytes: chunk.sizeBytes,
      firebaseTimestamp: Date.now(),
      writeSource: 'firebase'
    }));

    this.queueForUpload(firebaseChunkDocs);
  }

  // Upload instrumentation events to Firebase (all interaction traces)
  public async uploadInstrumentationEvents(events: InstrumentationEvent[]): Promise<void> {
    if (!this.isEnabled || events.length === 0) return;

    const firebaseEvents: any[] = [];
    for (const event of events) {
      const base = {
        ...event,
        collectionName: 'session-instrumentation',
        eventCategory: 'session-instrumentation',
        firebaseTimestamp: Date.now(),
        writeSource: 'firebase'
      } as any;
      if (this.getEventSizeBytes(base) > this.maxChunkSizeBytes) {
        firebaseEvents.push(...this.chunkLargeEventDoc(base));
      } else {
        firebaseEvents.push(base);
      }
    }

    this.queueForUpload(firebaseEvents);
  }

  // Upload analet-specific events (merge into session-instrumentation)
  public async uploadAnaletEvent(event: AnaletEvent): Promise<void> {
    if (!this.isEnabled) return;

    this.queueForUpload([{
      ...event,
      collectionName: 'session-instrumentation',
      eventCategory: 'session-instrumentation',
      eventSubtype: 'analet',
      firebaseTimestamp: Date.now(),
      writeSource: 'firebase'
    }]);
  }

  // Upload cell execution/navigation events (merge into session-instrumentation)
  public async uploadCellEvent(event: CellEvent): Promise<void> {
    if (!this.isEnabled) return;

    this.queueForUpload([{
      ...event,
      collectionName: 'session-instrumentation',
      eventCategory: 'session-instrumentation',
      eventSubtype: 'cell',
      firebaseTimestamp: Date.now(),
      writeSource: 'firebase'
    }]);
  }

  private queueForUpload(events: any[]): void {
    this.uploadQueue.push(...events);

    // Process queue if it gets large or if not currently processing
    if (this.uploadQueue.length >= this.maxBatchSize || !this.isUploading) {
      this.processUploadQueue();
    }
  }

  private async processUploadQueue(): Promise<void> {
    if (this.isUploading || this.uploadQueue.length === 0 || !this.isEnabled) {
      return;
    }

    this.isUploading = true;

    try {
      // Process events in batches
      while (this.uploadQueue.length > 0 && this.isEnabled) {
        const batch = this.uploadQueue.splice(0, this.maxBatchSize);
        await this.uploadBatch(batch);
      }
    } catch (error) {
      console.error('[FirebaseLoggingService] Failed to process upload queue:', error);
    } finally {
      this.isUploading = false;
    }
  }

  private async uploadBatch(events: any[]): Promise<void> {
    const db = this.db;
    if (!this.isEnabled || !db) return;

    // Flatten events into a sequence tagged by destination collection
    type Queued = { sessionId: string; collectionName: string; eventData: any };
    const flattened: Queued[] = [];
    for (const ev of events) {
      const { collectionName, ...rest } = ev;
      const cleaned = this.sanitizeForFirestore(rest);
      flattened.push({ sessionId: ev.sessionId, collectionName, eventData: cleaned });
    }

    // Build sub-batches constrained by both op count and estimated payload size
    let ops = 0;
    let bytes = 0;
    let batch = writeBatch(db);

    const commitAndReset = async () => {
      if (ops === 0 || !this.isEnabled) return;
      await this.executeWithRetry(async () => { await batch.commit(); });
      batch = writeBatch(db);
      ops = 0;
      bytes = 0;
    };

    for (const item of flattened) {
      const sessionCollectionRef = collection(db, 'sessions', item.sessionId, item.collectionName);
      const docRef = doc(sessionCollectionRef);
      const est = this.getEventSizeBytes(item.eventData) + 1024; // rough overhead

      // If adding this doc would exceed limits, commit current batch and start a new one
      if (ops > 0 && (ops + 1 > this.maxBatchSize || bytes + est > this.maxBatchBytes)) {
        await commitAndReset();
      }

      batch.set(docRef, item.eventData);
      ops += 1;
      bytes += est;
    }

    await commitAndReset();
  }

  private async executeWithRetry(operation: () => Promise<void>, retryCount: number = 0): Promise<void> {
    if (!this.isEnabled) return;
    try {
      await operation();
    } catch (error) {
      if (retryCount < this.maxRetries) {
        console.warn(`[FirebaseLoggingService] Upload failed, retrying... (${retryCount + 1}/${this.maxRetries})`);
        await this.delay(this.retryDelay * Math.pow(2, retryCount)); // Exponential backoff
        return this.executeWithRetry(operation, retryCount + 1);
      } else {
        console.error('[FirebaseLoggingService] Upload failed after all retries:', error);
        throw error;
      }
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Chunk RRWeb events to stay under 1MB limit per chunk
   */
  private chunkRRWebEvents(events: RRWebEvent[]): Array<{
    chunkId: string;
    chunkIndex: number;
    events: RRWebEvent[];
    sizeBytes: number;
  }> {
    const chunks: Array<{
      chunkId: string;
      chunkIndex: number;
      events: RRWebEvent[];
      sizeBytes: number;
    }> = [];

    let currentChunk: RRWebEvent[] = [];
    let currentSize = 0;
    let chunkIndex = 0;
    const safeTarget = this.getSafeChunkTarget();

    for (const event of events) {
      const eventSize = this.getEventSizeBytes(event);

      // If adding this event would exceed the chunk size limit, start a new chunk
      if (currentSize + eventSize > safeTarget && currentChunk.length > 0) {
        chunks.push({
          chunkId: `${events[0]?.sessionId || 'unknown'}-replay-${this.replayChunkCounter++}`,
          chunkIndex: chunkIndex++,
          events: [...currentChunk],
          sizeBytes: currentSize
        });

        currentChunk = [event];
        currentSize = eventSize;
      } else {
        currentChunk.push(event);
        currentSize += eventSize;
      }
    }

    // Add the final chunk if it has events
    if (currentChunk.length > 0) {
      chunks.push({
        chunkId: `${events[0]?.sessionId || 'unknown'}-replay-${this.replayChunkCounter++}`,
        chunkIndex: chunkIndex,
        events: currentChunk,
        sizeBytes: currentSize
      });
    }

    return chunks;
  }

  /**
   * Estimate the size of an event in bytes
   */
  private getEventSizeBytes(event: any): number {
    try {
      return JSON.stringify(event).length * 2; // Rough estimate: 2 bytes per character (Unicode)
    } catch {
      return 1024; // Default estimate if JSON.stringify fails
    }
  }

  /**
   * Ensure we keep a safety margin under the 1MB limit to account for Firestore overhead
   */
  private getSafeChunkTarget(): number {
    return Math.max(256 * 1024, this.maxChunkSizeBytes - 64 * 1024); // ~64KB headroom
  }

  /**
   * Chunk a single oversized event document into multiple documents with string payload chunks.
   * Stores chunked payload under `chunkPayload` with metadata to reconstruct.
   */
  private chunkLargeEventDoc(baseEvent: any): any[] {
    const serialized = JSON.stringify(baseEvent);
    const totalBytes = serialized.length * 2;
    const safeTarget = this.getSafeChunkTarget();
    const approxCharsPerChunk = Math.floor(safeTarget / 2) - 1024; // reserve ~1KB per doc for metadata

    const chunks: any[] = [];
    const chunkId = `${baseEvent.sessionId || 'unknown'}-${baseEvent.eventCategory || 'generic'}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    let idx = 0;
    for (let offset = 0; offset < serialized.length; offset += approxCharsPerChunk) {
      const part = serialized.slice(offset, offset + approxCharsPerChunk);
      const doc = {
        sessionId: baseEvent.sessionId,
        userId: baseEvent.userId,
        timestamp: baseEvent.timestamp || Date.now(),
        eventType: baseEvent.type || baseEvent.eventType || 'chunked',
        eventCategory: baseEvent.eventCategory || baseEvent.collectionName || 'generic',
        collectionName: baseEvent.collectionName || 'session-info',
        firebaseTimestamp: Date.now(),
        writeSource: 'firebase',
        chunked: true,
        chunkId,
        chunkIndex: idx++,
        totalChunks: null as number | null, // fill after loop
        originalSizeBytes: totalBytes,
        chunkPayload: part
      };
      chunks.push(doc);
    }
    // Backfill totalChunks
    const total = chunks.length;
    chunks.forEach(c => (c.totalChunks = total));
    return chunks;
  }

  /**
   * Remove undefined fields recursively so Firestore accepts the payload.
   * - Objects: drop keys with undefined; recurse into nested objects/arrays
   * - Arrays: replace undefined items with null; recurse into elements
   */
  private sanitizeForFirestore(value: any): any {
    if (value === undefined) return null;
    if (value === null) return null;
    if (Array.isArray(value)) {
      return value.map((v) => (v === undefined ? null : this.sanitizeForFirestore(v)));
    }
    if (typeof value === 'object') {
      if (value instanceof Date) return value;
      const out: any = {};
      for (const [k, v] of Object.entries(value)) {
        if (v === undefined) continue;
        out[k] = this.sanitizeForFirestore(v);
      }
      return out;
    }
    return value;
  }

  // Get queue status for debugging
  public getQueueStatus(): { queueLength: number; isUploading: boolean; isEnabled: boolean } {
    return {
      queueLength: this.uploadQueue.length,
      isUploading: this.isUploading,
      isEnabled: this.isEnabled
    };
  }

  // Force flush queue for testing or shutdown
  public async flushQueue(): Promise<void> {
    if (this.uploadQueue.length > 0) {
      await this.processUploadQueue();
    }
  }
}
