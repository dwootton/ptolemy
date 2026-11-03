import React, { useState } from 'react';
import { MessageService } from '../../services/MessageService';
import { StudyConfigurationService } from '../../services/StudyConfigurationService';
import './StudyParticipantInput.css';

export interface StudyParticipantInputProps {
  onStudyInitialized?: (participantCode: string) => void;
  onCancel?: () => void;
}

export const StudyParticipantInput: React.FC<StudyParticipantInputProps> = ({
  onStudyInitialized,
  onCancel
}) => {
  const [participantCode, setParticipantCode] = useState<string>('');
  const [isAdminCode, setIsAdminCode] = useState(false);
  const [adminParticipant, setAdminParticipant] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string>('');
  const messageService = MessageService.getInstance();

  const parseCode = (codeRaw: string) => {
    const raw = (codeRaw || '').trim();
    const lower = raw.toLowerCase();
    const admin = /^admin(?:-.+)?$/.test(lower);
    const test = /^test(?:-.+)?$/.test(lower);
    return { admin, test };
  };

  const handleChange = (val: string) => {
    setParticipantCode(val);
    const { admin } = parseCode(val);
    setIsAdminCode(admin);
    setError('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const code = participantCode.trim();
    if (!code) {
      setError('Please enter a participant code');
      return;
    }

    const { admin, test } = parseCode(code);
    if (!admin && !test) {
      // Validate P1-P12 or P1-Map/Tree/Canvas
      const pCodeMatch = code.match(/^[Pp](\d+)(?:-(Map|Tree|Canvas))?$/i);
      if (!pCodeMatch) {
        setError('Use P1-P12 or P1-Map/Tree/Canvas, or admin/test');
        return;
      }
      const numericId = parseInt(pCodeMatch[1], 10);
      if (numericId < 1) {
        setError('Participant id must be positive');
        return;
      }
    }

    setIsLoading(true);
    setError('');

    try {
      // If emulating participant, log stage plan
      logEmulatedMapping();
      // Send initialization request with participant code
      const result = await new Promise<any>((resolve) => {
        const unsubscribe = messageService.onMessage('study:initialize:result', (data: any) => {
          unsubscribe();
          resolve(data);
        });
        const payload: any = { participantCode: code, rawCodeLabel: code };
        if (admin) {
          let adminParticipantId: number | undefined = undefined;
          const pMatch = adminParticipant.trim().match(/^[Pp]?(\d+)$/);
          if (pMatch) {
            const parsed = parseInt(pMatch[1], 10);
            if (!isNaN(parsed) && parsed > 0) adminParticipantId = parsed;
          }
          // Admin preview: just pass label via rawCodeLabel and optional participantId override (no condition selection)
          payload.adminOptions = { participantId: adminParticipantId };
        }
        messageService.sendMessage('study:initialize-with-code', payload);
      });

      if (result.success) {
        onStudyInitialized?.(code);
      } else {
        setError(result.error || 'Failed to initialize study');
      }
    } catch (err) {
      console.error('Failed to initialize study:', err);
      setError('Failed to initialize study session');
    } finally {
      setIsLoading(false);
    }
  };

  // Log mapping/stages when emulating a participant
  const logEmulatedMapping = () => {
    try {
      const svc = StudyConfigurationService.getInstance() as any;
      let participantId: number | null = null;
      const code = participantCode.trim();
      const m = code.match(/^[Pp]?(\d+)$/);
      if (m) {
        const parsed = parseInt(m[1], 10);
        if (!isNaN(parsed) && parsed > 0) participantId = parsed;
      }
      const adminMatch = adminParticipant.trim().match(/^[Pp]?(\d+)$/);
      if (adminMatch) {
        const parsed = parseInt(adminMatch[1], 10);
        if (!isNaN(parsed) && parsed > 0) participantId = parsed;
      }
      if (!participantId) return;
      const mapping = svc.getParticipantMapping(participantId) || { participantId, conditionOrder: 'MapTreeCanvas', datasetOrder: 'XYZ' };
      const orderMap: any = {
        MapTreeCanvas: ['Map','Tree','Canvas'],
        MapCanvasTree: ['Map','Canvas','Tree'],
        TreeMapCanvas: ['Tree','Map','Canvas'],
        TreeCanvasMap: ['Tree','Canvas','Map'],
        CanvasMapTree: ['Canvas','Map','Tree'],
        CanvasTreeMap: ['Canvas','Tree','Map']
      };
      const conds = orderMap[mapping.conditionOrder] || ['Map','Tree','Canvas'];
      const dsMap: any = { X: 'vehicles', Y: 'diamonds', Z: 'listings' };
      const datasets = mapping.datasetOrder.split('').map((l: string) => dsMap[l] || l);
      const stages: Array<{index:number,dataset:string,condition:string}> = [];
      const n = Math.min(datasets.length, conds.length);
      for (let i = 0; i < n; i++) {
        stages.push({ index: i+1, dataset: datasets[i], condition: conds[i] });
      }
    } catch (e) {}
  };

  const handleCancel = () => {
    setParticipantCode('');
    setError('');
    onCancel?.();
  };

  return (
    <div className="study-participant-input">
      <div className="study-participant-input__container">
        <div className="study-participant-input__header">
          <h2>Welcome to the Ptolemy Study</h2>
          <p>Please enter your participant code to begin the study session.</p>
        </div>

        <form onSubmit={handleSubmit} className="study-participant-input__form">
          <div className="study-participant-input__field">
            <label htmlFor="participant-code">Participant Code</label>
            <input
              id="participant-code"
              type="text"
              value={participantCode}
              onChange={(e) => handleChange(e.target.value)}
              placeholder="Enter your participant code (P1-P12)"
              disabled={isLoading}
              className={error ? 'error' : ''}
              autoComplete="off"
            />
            {error && (
              <div className="study-participant-input__error">
                {error}
              </div>
            )}
          </div>

          {isAdminCode && (
            <div className="study-participant-input__field">
              <div className="study-participant-input__hint">Admin code detected. Logs will be suffixed with your code (e.g., "admin-21ee").</div>
            </div>
          )}

          {isAdminCode && (
            <div className="study-participant-input__field">
              <label htmlFor="admin-participant">Admin: Emulate Participant (e.g., P1 or 17)</label>
              <input
                id="admin-participant"
                type="text"
                value={adminParticipant}
                onChange={(e) => setAdminParticipant(e.target.value)}
                placeholder="Optional: P1-P12 or any positive number"
                disabled={isLoading}
                autoComplete="off"
              />
              <div className="study-participant-input__hint">If provided, uses that participant's mapping/order; otherwise a default mapping is used.</div>
            </div>
          )}

          <div className="study-participant-input__actions">
            <button
              type="button"
              onClick={handleCancel}
              className="study-participant-input__cancel"
              disabled={isLoading}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="study-participant-input__submit"
              disabled={isLoading || !participantCode.trim()}
            >
              {isLoading ? (
                <>
                  <div className="spinner" />
                  Initializing...
                </>
              ) : (
                'Start Study'
              )}
            </button>
          </div>
        </form>

        <div className="study-participant-input__info">
          <h3>Study Information</h3>
          <ul>
            <li>You will work through multiple datasets and interface conditions</li>
            <li>Your interactions will be recorded for research purposes</li>
            <li>The system will automatically advance you through different stages</li>
            <li>Click "Finish" when you complete each condition to advance</li>
          </ul>
        </div>
      </div>
    </div>
  );
};
