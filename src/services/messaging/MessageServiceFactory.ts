/**
 * MessageServiceFactory - Creates and configures the new modular messaging system
 * This replaces the monolithic MessageService with a clean, domain-based architecture
 */

import * as vscode from 'vscode';
import { MessageRouter } from './MessageRouter';
import { StateManagementService } from '../StateManagementService';
import { AnaletStore } from '../AnaletStore';
import { TelemetryService } from '../TelemetryService';
import { CentralizedStorageManager } from '../CentralizedStorageManager';
import { JupyterNotebookService } from '../JupyterNotebookService';
import { NewOpenAIService } from '../llm/NewOpenAIService';

// Import all domain handlers
import {
  AnaletMessageHandler,
  AnalysisNoteMessageHandler,
  DatasetMessageHandler,
  FileSystemMessageHandler,
  SystemMessageHandler,
  UIStateMessageHandler,
  SemanticLayerMessageHandler,
  NotebookMessageHandler,
  CheckpointMessageHandler,
  HierarchyMessageHandler,
  WorkspaceMessageHandler
  , BearingMetricsMessageHandler
} from './handlers';
import { FeatureFlags } from '../../utils/featureFlags';

// Conditionally import study handler only in study builds
let StudyApplicationMessageHandler: any = null;
const studyEnabled = FeatureFlags.STUDY_MODE_ENABLED;
if (studyEnabled) {
  StudyApplicationMessageHandler = require('./handlers/StudyApplicationMessageHandler').StudyApplicationMessageHandler;
}

export class MessageServiceFactory {
  /**
   * Create a fully configured MessageRouter with all domain handlers
   */
  public static create(
    webview: vscode.Webview,
    stateService: StateManagementService
  ): MessageRouter {
    // Create the message router
    const messageRouter = new MessageRouter(webview, stateService);

    // Initialize additional services
    const analetStore = AnaletStore.getInstance(stateService.getContext());
    const telemetryService = TelemetryService.getInstance(stateService.getContext());
    stateService.getContext().subscriptions.push(vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration('meridian.instrumentation.enabled')) {
        void messageRouter.sendMessage('instrumentation-status-changed', {
          enabled: telemetryService.isInstrumentationActive()
        });
      }
    }));
    // Ensure centralized storage manager is initialized with context (for purge operations)
    CentralizedStorageManager.getInstance(stateService.getContext());

    // Eagerly initialize the new OpenAI service (if key configured) and notebook service
    try {
      NewOpenAIService.getInstance();
    } catch (error) {
      console.warn('⚠️ [MessageServiceFactory] NewOpenAIService not initialized (missing or invalid API key). Proceeding without it.');
    }
    try {
      JupyterNotebookService.getInstance();
    } catch (error) {
      console.warn('⚠️ [MessageServiceFactory] Failed to initialize JupyterNotebookService:', error);
    }

    // Load analets from storage on initialization
    analetStore.loadFromStorage().catch(error => {
      console.error('❌ [MessageServiceFactory] Failed to load analets from storage:', error);
    });

    // Update router context with services
    messageRouter.updateContext({
      analetStore,
      telemetryService
    });

    // Register all domain handlers and get analet handler for controller access
    const analetHandler = this.registerHandlers(messageRouter);

    // Store analet handler for later controller wiring
    (messageRouter as any)._analetHandler = analetHandler;
    return messageRouter;
  }

  /**
   * Register all domain message handlers
   */
  private static registerHandlers(messageRouter: MessageRouter): AnaletMessageHandler {
    const analetHandler = new AnaletMessageHandler();
    const handlers = [
      analetHandler,
      new AnalysisNoteMessageHandler(),
      new DatasetMessageHandler(),
      new FileSystemMessageHandler(),
      new SystemMessageHandler(),
      new UIStateMessageHandler(),
      new SemanticLayerMessageHandler(),
      new NotebookMessageHandler(),
      new CheckpointMessageHandler(),
      new HierarchyMessageHandler(),
      new WorkspaceMessageHandler(),
      new BearingMetricsMessageHandler()
    ];

    // Conditionally add study handler only in study builds
    if (studyEnabled && StudyApplicationMessageHandler) {
      handlers.push(new StudyApplicationMessageHandler());
    }

    // Register each handler
    for (const handler of handlers) {
      messageRouter.registerHandler(handler);
    }
    return analetHandler;
  }

  /**
   * Create and initialize the messaging system
   */
  public static async createAndInitialize(
    webview: vscode.Webview,
    stateService: StateManagementService
  ): Promise<MessageRouter> {
    const messageRouter = this.create(webview, stateService);

    // Initialize all handlers
    await messageRouter.initialize();

    // Wire up AnaletController to StateManagementService after initialization
    const analetHandler = (messageRouter as any)._analetHandler as AnaletMessageHandler;
    if (analetHandler) {
      const analetController = analetHandler.getAnaletController();
      if (analetController) {
        try {
          stateService.setAnaletController(analetController);
        } catch (error) {
          console.warn('⚠️ [MessageServiceFactory] Failed to wire AnaletController:', error);
        }
      } else {
        console.warn('⚠️ [MessageServiceFactory] AnaletController not initialized in handler');
      }
    } else {
      console.warn('⚠️ [MessageServiceFactory] AnaletMessageHandler not available for wiring');
    }

    return messageRouter;
  }

  /**
   * Get list of all supported message types (useful for debugging)
   */
  public static getSupportedMessageTypes(): string[] {
    // Create a temporary router to get supported types
    const tempRouter = new MessageRouter(
      {} as vscode.Webview,
      {} as StateManagementService
    );

    this.registerHandlers(tempRouter);

    return tempRouter.getSupportedMessageTypes();
  }

  /**
   * Validate that all required message types are covered
   */
  public static validateMessageCoverage(requiredMessageTypes: string[]): {
    covered: string[];
    missing: string[];
    coverage: number;
  } {
    const supportedTypes = this.getSupportedMessageTypes();
    const supportedSet = new Set(supportedTypes);

    const covered = requiredMessageTypes.filter(type => supportedSet.has(type));
    const missing = requiredMessageTypes.filter(type => !supportedSet.has(type));

    return {
      covered,
      missing,
      coverage: covered.length / requiredMessageTypes.length
    };
  }
}
