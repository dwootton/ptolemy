import * as fs from 'fs';
import * as path from 'path';
import { TelemetryService } from '../TelemetryService';

export interface CellQLFailureEntry {
  timestamp: string;
  phase: 'llm_call' | 'empty_response' | 'render_cellql' | 'empty_cellql' | 'missing_columns' | 'unexpected';
  datasetName?: string;
  datasetContext?: string;
  idea?: any;
  prompts?: { system?: string; user?: string };
  error?: { message?: string; stack?: string };
}

export async function appendCellQLFailure(entry: Omit<CellQLFailureEntry, 'timestamp'>): Promise<void> {
  let telemetry: TelemetryService;
  try {
    telemetry = TelemetryService.getInstance();
  } catch {
    return;
  }
  if (!telemetry.isInstrumentationActive()) return;
  const file = path.join(telemetry.getLogsDir(), 'cellql-failures.log.jsonl');
  const enriched: CellQLFailureEntry = {
    timestamp: new Date().toISOString(),
    ...entry,
  };
  // Truncate potentially huge fields for safety
  if (enriched.datasetContext && enriched.datasetContext.length > 2000) {
    enriched.datasetContext = enriched.datasetContext.slice(0, 2000) + '…';
  }
  if (enriched.error?.stack && enriched.error.stack.length > 4000) {
    enriched.error.stack = enriched.error.stack.slice(0, 4000) + '…';
  }
  try {
    await fs.promises.appendFile(file, JSON.stringify(enriched) + '\n', 'utf8');
  } catch (e) {
    // Swallow logging errors to avoid disrupting pipeline
    // eslint-disable-next-line no-console
    console.warn('[FailureLogger] failed to append log:', e);
  }
}


