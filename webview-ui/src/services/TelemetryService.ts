import { MessageService } from './MessageService';
import { StudyConfigurationService } from './StudyConfigurationService';
import { record } from 'rrweb';

export interface TelemetryEvent {
  type: string;
  payload: any;
  timestamp: number;
  sessionId: string;
  userId?: string;
}

export interface RRWebEventData {
  events: any[];
  timestamp: number;
  sessionId: string;
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
  private messageService: MessageService;
  private sessionId: string;
  private eventBuffer: TelemetryEvent[] = [];
  private instrumentationBuffer: InstrumentationEvent[] = [];
  private flushInterval: number | undefined;
  private isInstrumentationEnabled: boolean = false;
  private rrwebStopFn: (() => void) | undefined;
  private rrwebBuffer: any[] = [];

  private constructor() {
    this.messageService = MessageService.getInstance();
    this.sessionId = this.generateSessionId();
    this.setupMessageHandlers();
    this.checkInstrumentationStatus();
  }

  public static getInstance(): TelemetryService {
    if (!TelemetryService.instance) {
      TelemetryService.instance = new TelemetryService();
    }
    return TelemetryService.instance;
  }

  private generateSessionId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  private startBufferFlush(): void {
    if (this.flushInterval) return;
    // Flush events every 5 seconds
    this.flushInterval = window.setInterval(() => {
      this.flushEvents();
    }, 5000);
  }

  private setupMessageHandlers(): void {
    this.messageService.onMessage('instrumentation-status', (data) => {
      this.setInstrumentationEnabled(data?.enabled === true);
    });

    this.messageService.onMessage('instrumentation-status-changed', (data) => {
      this.setInstrumentationEnabled(data?.enabled === true);
    });
  }

  private checkInstrumentationStatus(): void {
    // Request current instrumentation status from backend
    this.messageService.sendMessage('get-instrumentation-status');
  }

  public recordEvent(type: string, payload: any): void {
    if (!this.isInstrumentationEnabled) return;
    const event: TelemetryEvent = {
      type,
      payload,
      timestamp: Date.now(),
      sessionId: this.sessionId
    };

    this.eventBuffer.push(event);

    // If buffer gets too large, flush immediately
    if (this.eventBuffer.length >= 20) {
      this.flushEvents();
    }
  }

  public recordInstrumentationEvent(event: Omit<InstrumentationEvent, 'timestamp' | 'sessionId' | 'viewport'>): void {
    if (!this.isInstrumentationEnabled) return;

    // Get study context if available
    const studyContext = this.getStudyContext();

    const instrumentationEvent: InstrumentationEvent = {
      ...event,
      timestamp: Date.now(),
      sessionId: this.sessionId,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight
      },
      details: {
        ...event.details,
        ...studyContext
      }
    };

    this.instrumentationBuffer.push(instrumentationEvent);

    // If buffer gets too large, flush immediately
    if (this.instrumentationBuffer.length >= 20) {
      this.flushEvents();
    }
  }

  public setInstrumentationEnabled(enabled: boolean): void {
    if (this.isInstrumentationEnabled === enabled) return;

    this.isInstrumentationEnabled = enabled;

    if (enabled) {
      this.startBufferFlush();
      this.startRRWebRecording();
    } else {
      this.stopRRWebRecording();
      // Clear buffers when disabled
      this.eventBuffer = [];
      this.instrumentationBuffer = [];
      this.rrwebBuffer = [];
      if (this.flushInterval) {
        clearInterval(this.flushInterval);
        this.flushInterval = undefined;
      }
    }
  }

  public isInstrumentationActive(): boolean {
    return this.isInstrumentationEnabled;
  }

  public toggleInstrumentation(): void {
    const newState = !this.isInstrumentationEnabled;
    this.messageService.sendMessage('set-instrumentation-enabled', { enabled: newState });
  }

  public recordAnaletClick(analetId: number, position: { x: number, y: number }): void {
    this.recordEvent('analet_click', {
      analetId,
      position,
      clickTime: Date.now()
    });
  }

  public recordAnaletMove(analetId: number, oldPosition: { x: number, y: number }, newPosition: { x: number, y: number }): void {
    this.recordEvent('analet_move', {
      analetId,
      oldPosition,
      newPosition,
      moveTime: Date.now()
    });
  }

  public recordAnaletEdit(analetId: number, field: string, oldValue: any, newValue: any): void {
    this.recordEvent('analet_edit', {
      analetId,
      field,
      oldValue,
      newValue,
      editTime: Date.now()
    });
  }

  public recordAnaletCreate(analetData: any): void {
    this.recordEvent('analet_create', {
      analetData,
      createTime: Date.now()
    });
  }

  public recordMapInteraction(interactionType: string, data: any): void {
    this.recordEvent('map_interaction', {
      interactionType,
      data,
      interactionTime: Date.now()
    });
  }

  public recordPageView(page: string, metadata?: any): void {
    this.recordEvent('page_view', {
      page,
      metadata,
      viewTime: Date.now()
    });
  }

  public recordUserAction(action: string, target: string, metadata?: any): void {
    const studyContext = this.getStudyContext();

    this.recordEvent('user_action', {
      action,
      target,
      metadata: {
        ...metadata,
        ...studyContext
      },
      actionTime: Date.now()
    });
  }

  /**
   * Get current study context if available
   */
  private getStudyContext(): Record<string, any> {
    try {
      const studyService = StudyConfigurationService.getInstance();
      const config = studyService.getConfiguration();
      if (config) {
        let participantLabel: string | undefined;
        try { participantLabel = (window as any).__meridian_participant_label__ || undefined; } catch {}
        if (!participantLabel && typeof config.participantId === 'number') {
          participantLabel = `P${config.participantId}`;
        }
        return {
          participantId: config.participantId,
          participantLabel,
          conditionOrder: config.conditionOrder,
          datasetOrder: config.datasetOrder,
          sessionStartTime: config.sessionStartTime,
          isStudyMode: config.isStudyMode
        };
      }
    } catch (error) {
      // Silently fail - study context is optional
    }
    return {};
  }

  private startRRWebRecording(): void {
    if (this.rrwebStopFn) {
      this.stopRRWebRecording();
    }

    try {
      this.rrwebStopFn = record({
        emit: (event) => {
          if (!this.isInstrumentationEnabled) return;

          this.rrwebBuffer.push(event);

          // Send events in batches to prevent overwhelming the backend
          if (this.rrwebBuffer.length >= 50) {
            this.flushRRWebEvents();
          }
        },
        // Recording is opt-in; mask dataset text and input contents in replays.
        maskAllInputs: true,
        maskTextSelector: '*',
        blockSelector: '[data-block]',
        checkoutEveryNms: 30000, // Checkout every 30 seconds
        checkoutEveryNth: 500,   // Or every 500 events
      });
    } catch (error) {
      console.error('Failed to start RRWeb recording:', error);
    }
  }

  private stopRRWebRecording(): void {
    if (this.rrwebStopFn) {
      this.rrwebStopFn();
      this.rrwebStopFn = undefined;
    }

    // Flush any remaining events
    if (this.rrwebBuffer.length > 0) {
      this.flushRRWebEvents();
    }
  }

  private flushRRWebEvents(): void {
    if (!this.isInstrumentationEnabled || this.rrwebBuffer.length === 0) return;

    const eventsToSend = [...this.rrwebBuffer];
    this.rrwebBuffer = [];

    this.messageService.sendMessage('rrweb-event', eventsToSend);
  }

  public sendRRWebEvents(events: any[]): void {
    if (!this.isInstrumentationEnabled) return;
    const rrwebData: RRWebEventData = {
      events,
      timestamp: Date.now(),
      sessionId: this.sessionId
    };

    this.messageService.sendMessage('rrweb-event', rrwebData);
  }

  private flushEvents(): void {
    if (!this.isInstrumentationEnabled) return;
    // Flush regular telemetry events
    if (this.eventBuffer.length > 0) {
      const eventsToSend = [...this.eventBuffer];
      this.eventBuffer = [];

      // Send each event to the backend
      eventsToSend.forEach(event => {
        this.messageService.sendMessage('telemetry-event', {
          type: event.type,
          payload: event.payload
        });
      });
    }

    // Flush instrumentation events
    if (this.instrumentationBuffer.length > 0 && this.isInstrumentationEnabled) {
      const instrumentationToSend = [...this.instrumentationBuffer];
      this.instrumentationBuffer = [];

      // Send each instrumentation event to the backend
      instrumentationToSend.forEach(event => {
        this.messageService.sendMessage('instrumentation-event', event);
      });
    }

    // Flush RRWeb events
    if (this.rrwebBuffer.length > 0 && this.isInstrumentationEnabled) {
      this.flushRRWebEvents();
    }
  }

  public getSessionId(): string {
    return this.sessionId;
  }

  public setRecordingStatus(isRecording: boolean): void {
    this.setInstrumentationEnabled(isRecording);
  }

  public getRecordingStatus(): boolean {
    return this.isInstrumentationEnabled;
  }

  public dispose(): void {
    // Stop RRWeb recording
    this.stopRRWebRecording();

    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = undefined;
    }

    // Final flush before disposing
    this.flushEvents();
  }
}
