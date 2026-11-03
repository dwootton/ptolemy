import * as vscode from 'vscode';
import { BaseMessageHandler } from '../BaseMessageHandler';
import { MessageContext } from '../types';
import { StateManagementService, WORKSPACE_KEYS } from '../../StateManagementService';

type BearingMetricsState = {
  bearingId: number;
  windowSize: number;
  zThreshold: number;
  minAbsDelta: number;
  deltas: number[];
  hullArea: number;
  stats: { mean: number; std: number };
  lastJumpAt?: number;
  reflections?: Array<{ at: number; z: number; delta: number; note?: string }>;
  memberIds: number[];
  addedSinceLastJump: number;
  forceEveryThirdAnalet: boolean;
};

export class BearingMetricsMessageHandler extends BaseMessageHandler {
  constructor() {
    super([
      'bearing-metrics-load',
      'bearing-metrics-update',
      'bearing-jump'
    ]);
  }

  public async handle(messageType: string, data: any, context: MessageContext): Promise<void> {
    switch (messageType) {
      case 'bearing-metrics-load':
        return this.handleLoad();
      case 'bearing-metrics-update':
        return this.handleUpdate(data);
      case 'bearing-jump':
        return this.handleJump(data);
      default:
        throw new Error(`Unsupported message type: ${messageType}`);
    }
  }

  private async handleLoad(): Promise<void> {
    const stateService = this.context?.stateService as StateManagementService;
    const map = await stateService.getWorkspaceState<Record<string, BearingMetricsState>>(WORKSPACE_KEYS.BEARING_METRICS) || {};
    await this.sendSuccess('bearing-metrics-load-response', { bearingMetrics: map });
  }

  private async handleUpdate(data: any): Promise<void> {
    const stateService = this.context?.stateService as StateManagementService;
    const key = data?.key as string;
    const state = data?.state as BearingMetricsState;
    if (!key || !state || typeof state.bearingId !== 'number') {
      return this.sendError('bearing-metrics-update', new Error('Invalid bearing metrics update payload'), data);
    }
    const map = await stateService.getWorkspaceState<Record<string, BearingMetricsState>>(WORKSPACE_KEYS.BEARING_METRICS) || {};
    map[key] = state;
    await stateService.setWorkspaceState(WORKSPACE_KEYS.BEARING_METRICS, map);
    await this.sendSuccess('bearing-metrics-updated', { key });
  }

  private async handleJump(data: any): Promise<void> {
    const bearingId = data?.bearingId;
    const z = data?.z;
    const delta = data?.delta;
    const reason = data?.reason as string | undefined;
    const title = (data?.bearingStatement as string) || `Bearing ${bearingId}`;
    const details = (data?.explanation as string) || `Possible semantic jump (${reason || 'z-score'}).`;

    const EXIT = 'Exit bearing';
    const ADD_NOTE = 'Add note';
    const msg = `${title}\n${details}\nWhat would you like to do?`;
    const choice = await vscode.window.showInformationMessage(msg, EXIT, ADD_NOTE);
    if (choice === EXIT) {
      await this.sendMessage('bearing:exit', { bearingId });
    } else if (choice === ADD_NOTE) {
      await this.sendMessage('bearing:add-note', { bearingId });
    }
    await this.sendSuccess('bearing-jump-notified', { bearingId, z, delta, reason, choice });
  }
}
