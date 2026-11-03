import { useEffect, useRef } from 'react';
import { useMessageHandler } from '../../../hooks/useMessageHandler';

type StatusPayload = {
  analetId?: number;
  status?: string;
  message?: string;
  fileName?: string;
  created?: boolean;
};

export function useNotebookOperationStatus(onStatusChange?: (data: StatusPayload) => void) {
  const { onMessage } = useMessageHandler();
  const callbackRef = useRef(onStatusChange);
  callbackRef.current = onStatusChange;

  useEffect(() => {
    const offStatus = onMessage('notebookOperationStatus', (data: any) => {
      callbackRef.current?.(data as StatusPayload);
    });
    const offReady = onMessage('notebookReady', (data: any) => {
      callbackRef.current?.(data as StatusPayload);
    });
    return () => {
      offStatus();
      offReady();
    };
  }, [onMessage]);
}


