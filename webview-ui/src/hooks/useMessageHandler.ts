import { useCallback } from 'react';
import { MessageService } from '../services/MessageService';

export function useMessageHandler() {
  const messageService = MessageService.getInstance();

  // Memoize all message functions to prevent infinite re-renders
  const sendMessage = useCallback((type: string, data?: any) => {
    messageService.sendMessage(type, data);
  }, [messageService]);

  // Send internal webview-only message
  const sendInternalMessage = useCallback((type: string, data?: any) => {
    messageService.sendInternalMessage(type, data);
  }, [messageService]);

  const sendRequest = useCallback(async <T = any>(
    type: string,
    data?: any,
    timeoutMs: number = 10000
  ): Promise<T> => {
    return messageService.sendRequest<T>(type, data, timeoutMs);
  }, [messageService]);

  // Listen for messages from extension
  const onMessage = useCallback((type: string, handler: (data: any) => void) => {
    const cleanup = messageService.onMessage(type, handler);
    return cleanup;
  }, [messageService]);

  // Listen for internal webview messages
  const onInternalMessage = useCallback((type: string, handler: (data: any) => void) => {
    const cleanup = messageService.onInternalMessage(type, handler);
    return cleanup;
  }, [messageService]);

  return {
    sendMessage,
    sendInternalMessage,
    sendRequest,
    onMessage,
    onInternalMessage
  };
}