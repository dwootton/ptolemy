import React from 'react';
import { useNotebookSelectionSync } from '../../hooks/useNotebookSelectionSync';
import { useNotebookOperationStatus } from './hooks/useNotebookOperationStatus';

interface SharedSelectionLike {
  selectAnalet: (analetId: number, multiSelect?: boolean, rangeSelect?: boolean) => void;
  clearSelection: () => void;
}

interface MessagingBridgeProps {
  sharedSelection: SharedSelectionLike;
  onNotebookStatusChange?: (data: { analetId?: number; status?: string; message?: string; fileName?: string; created?: boolean }) => void;
}

function MessagingBridgeImpl({ sharedSelection, onNotebookStatusChange }: MessagingBridgeProps) {
  // Mount focused messaging hooks
  useNotebookSelectionSync(sharedSelection);
  useNotebookOperationStatus(onNotebookStatusChange);
  return null;
}

export const MessagingBridge = React.memo(MessagingBridgeImpl);


