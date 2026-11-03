import { record } from 'rrweb';
import { TelemetryService } from './TelemetryService';
import { StateService } from './StateService';

export class RRwebRecorder {
  private static instance: RRwebRecorder;
  private telemetryService: TelemetryService;
  private stopRecordingFn: (() => void) | undefined;
  private recordingBuffer: any[] = [];
  private flushInterval: number | undefined;
  private isRecording: boolean = false;
  private sessionStartTime: number;
  private stateService: StateService;

  private constructor() {
    this.telemetryService = TelemetryService.getInstance();
    this.stateService = StateService.getInstance();
    this.sessionStartTime = Date.now();
  }

  public static getInstance(): RRwebRecorder {
    if (!RRwebRecorder.instance) {
      RRwebRecorder.instance = new RRwebRecorder();
    }
    return RRwebRecorder.instance;
  }

  public startRecording(): void {
    if (this.isRecording) {
      console.warn('RRweb recording is already active');
      return;
    }

    try {
      const maskAllInputs = this.stateService.getTelemetryMaskAllInputs();
      this.stopRecordingFn = record({
        emit: (event) => {
          this.recordingBuffer.push(event);
          
          // Flush buffer when it gets too large to prevent memory issues
          if (this.recordingBuffer.length >= 100) {
            this.flushRecordingBuffer();
          }
        },
        // Configuration options
        maskAllInputs: maskAllInputs,
        maskTextSelector: '[data-mask]',
        blockSelector: '[data-block] *',
        collectFonts: false, // Don't collect fonts to reduce data size
        slimDOMOptions: {
          script: true,
          comment: true,
          headFavicon: true,
          inputValue: false,
          class: false,
          id: false
        } as any
      });

      this.isRecording = true;
      this.telemetryService.setRecordingStatus(true);
      // Mark session start in telemetry
      this.telemetryService.recordEvent('rrweb_session_start', {
        sessionId: this.telemetryService.getSessionId(),
        startTime: this.sessionStartTime,
        maskAllInputs
      });
      
      // Start periodic flushing of recording buffer
      this.startBufferFlush();
    } catch (error) {
      console.error('❌ [RRwebRecorder] Failed to start recording:', error);
      this.isRecording = false;
      this.telemetryService.setRecordingStatus(false);
    }
  }

  public stopRecording(): void {
    if (!this.isRecording) {
      console.warn('RRweb recording is not active');
      return;
    }

    try {
      if (this.stopRecordingFn) {
        this.stopRecordingFn();
        this.stopRecordingFn = undefined;
      }

      // Final flush of any remaining events
      this.flushRecordingBuffer();

      if (this.flushInterval) {
        clearInterval(this.flushInterval);
        this.flushInterval = undefined;
      }

      this.isRecording = false;
      this.telemetryService.setRecordingStatus(false);
      // Mark session end
      this.telemetryService.recordEvent('rrweb_session_end', {
        sessionId: this.telemetryService.getSessionId(),
        endTime: Date.now(),
        bufferedEventsRemaining: this.recordingBuffer.length
      });
    } catch (error) {
      console.error('❌ [RRwebRecorder] Failed to stop recording:', error);
    }
  }

  private startBufferFlush(): void {
    // Flush recording buffer every 10 seconds
    this.flushInterval = window.setInterval(() => {
      this.flushRecordingBuffer();
    }, 10000);
  }

  private flushRecordingBuffer(): void {
    if (this.recordingBuffer.length === 0) return;

    const eventsToSend = [...this.recordingBuffer];
    this.recordingBuffer = [];

    // Send events to telemetry service which will forward to backend
    this.telemetryService.sendRRWebEvents(eventsToSend);
  }

  public getRecordingStatus(): boolean {
    return this.isRecording;
  }

  public getSessionStartTime(): number {
    return this.sessionStartTime;
  }

  public getRecordedEventsCount(): number {
    return this.recordingBuffer.length;
  }

  public pauseRecording(): void {
    if (!this.isRecording) return;
    if (this.stopRecordingFn) {
      this.stopRecordingFn();
      this.stopRecordingFn = undefined;
    }
    this.isRecording = false;
    this.telemetryService.setRecordingStatus(false);
  }

  public resumeRecording(): void {
    if (this.isRecording) return;
    this.startRecording();
  }

  public dispose(): void {
    this.stopRecording();
  }
}