/**
 * Custom hook for managing AnalysisMap state
 */

import { useState, useCallback, useRef, useEffect } from "react";
import { Analet } from "../../../types/analet";

export interface NewNodeButton {
  analetId: number;
  position: { x: number; y: number };
}

export interface ContextMenuState {
  x: number;
  y: number;
  analets: Analet[];
}

export interface StatementContextMenuState {
  x: number;
  y: number;
  analet: Analet;
}

export interface EmptySpaceContextMenuState {
  x: number;
  y: number;
  mapPosition: { x: number; y: number };
}

export interface MapNoteEditorState {
  isVisible: boolean;
  position: { x: number; y: number };
  note?: any; // Existing note for editing, or undefined for new note
}

export interface SelectionBrush {
  isActive: boolean;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}

export interface ToastState {
  visible: boolean;
  message: string | null;
}

export interface CursorState {
  position: { x: number; y: number };
  description?: string;
  isLoading: boolean;
}

export interface MapStateHookReturn {
  // New node button state
  newNodeButton: NewNodeButton | null;
  setNewNodeButton: (button: NewNodeButton | null) => void;
  newNodeTimer: NodeJS.Timeout | null;
  setNewNodeTimer: (timer: NodeJS.Timeout | null) => void;

  // Context menus
  contextMenu: ContextMenuState | null;
  setContextMenu: (menu: ContextMenuState | null) => void;
  statementContextMenu: StatementContextMenuState | null;
  setStatementContextMenu: (menu: StatementContextMenuState | null) => void;
  emptySpaceContextMenu: EmptySpaceContextMenuState | null;
  setEmptySpaceContextMenu: (menu: EmptySpaceContextMenuState | null) => void;

  // Map note editor
  mapNoteEditor: MapNoteEditorState;
  setMapNoteEditor: (editor: MapNoteEditorState) => void;

  // Selection brush
  selectionBrush: SelectionBrush;
  setSelectionBrush: (brush: SelectionBrush) => void;

  // Toast notifications
  toastState: ToastState;
  showToast: (message: string) => void;
  hideToast: () => void;

  // Embedding cursor
  cursorState: CursorState;
  setCursorPosition: (position: { x: number; y: number }) => void;
  setCursorDescription: (description: string | undefined) => void;
  setCursorLoading: (loading: boolean) => void;

  // Generation states
  isGeneratingRandomAnalets: boolean;
  setIsGeneratingRandomAnalets: (generating: boolean) => void;
  isGeneratingDismissed: boolean;
  setIsGeneratingDismissed: (dismissed: boolean) => void;

  // UMAP inversion
  umapInversion: any;
  setUmapInversion: (inversion: any) => void;

  // Refs
  containerRef: React.RefObject<HTMLDivElement>;
  hoverTimerRef: React.MutableRefObject<NodeJS.Timeout | null>;
  transformRef: React.RefObject<any>;
  setHoverTimer: (timer: NodeJS.Timeout | null) => void;

  // Utilities
  clearAllMenus: () => void;
}

export function useMapState(): MapStateHookReturn {
  // New node button state
  const [newNodeButton, setNewNodeButton] = useState<NewNodeButton | null>(null);
  const [newNodeTimer, setNewNodeTimer] = useState<NodeJS.Timeout | null>(null);

  // Context menus
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [statementContextMenu, setStatementContextMenu] = useState<StatementContextMenuState | null>(null);
  const [emptySpaceContextMenu, setEmptySpaceContextMenu] = useState<EmptySpaceContextMenuState | null>(null);

  // Map note editor
  const [mapNoteEditor, setMapNoteEditor] = useState<MapNoteEditorState>({
    isVisible: false,
    position: { x: 0, y: 0 },
  });

  // Selection brush
  const [selectionBrush, setSelectionBrush] = useState<SelectionBrush>({
    isActive: false,
    startX: 0,
    startY: 0,
    currentX: 0,
    currentY: 0,
  });

  // Toast notifications
  const [toastVisible, setToastVisible] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Embedding cursor
  const [cursorPosition, setCursorPosition] = useState({ x: 200, y: 150 });
  const [cursorDescription, setCursorDescription] = useState<string | undefined>(undefined);
  const [isCursorLoading, setCursorLoading] = useState(false);

  // Generation states
  const [isGeneratingRandomAnalets, setIsGeneratingRandomAnalets] = useState(false);
  const [isGeneratingDismissed, setIsGeneratingDismissed] = useState(false);

  // UMAP inversion
  const [umapInversion, setUmapInversion] = useState<any>(null);

  // Refs
  const containerRef = useRef<HTMLDivElement>(null);
  const hoverTimerRef = useRef<NodeJS.Timeout | null>(null);
  const transformRef = useRef<any>(null);

  // Toast functions
  const showToast = useCallback((message: string) => {
    setToastMessage(message);
    setToastVisible(true);
    
    // Auto-hide after 3 seconds
    setTimeout(() => {
      setToastVisible(false);
      // Clear message after fade animation
      setTimeout(() => setToastMessage(null), 300);
    }, 3000);
  }, []);

  const hideToast = useCallback(() => {
    setToastVisible(false);
    setTimeout(() => setToastMessage(null), 300);
  }, []);

  // Clear all menus utility
  const clearAllMenus = useCallback(() => {
    setContextMenu(null);
    setStatementContextMenu(null);
    setEmptySpaceContextMenu(null);
  }, []);

  // Cleanup effect for timers
  useEffect(() => {
    return () => {
      if (newNodeTimer) {
        clearTimeout(newNodeTimer);
      }
      if (hoverTimerRef.current) {
        clearTimeout(hoverTimerRef.current);
      }
    };
  }, [newNodeTimer]);

  return {
    // New node button state
    newNodeButton,
    setNewNodeButton,
    newNodeTimer,
    setNewNodeTimer,

    // Context menus
    contextMenu,
    setContextMenu,
    statementContextMenu,
    setStatementContextMenu,
    emptySpaceContextMenu,
    setEmptySpaceContextMenu,

    // Map note editor
    mapNoteEditor,
    setMapNoteEditor,

    // Selection brush
    selectionBrush,
    setSelectionBrush,

    // Toast notifications
    toastState: { visible: toastVisible, message: toastMessage },
    showToast,
    hideToast,

    // Embedding cursor
    cursorState: {
      position: cursorPosition,
      description: cursorDescription,
      isLoading: isCursorLoading,
    },
    setCursorPosition,
    setCursorDescription,
    setCursorLoading,

    // Generation states
    isGeneratingRandomAnalets,
    setIsGeneratingRandomAnalets,
    isGeneratingDismissed,
    setIsGeneratingDismissed,

    // UMAP inversion
    umapInversion,
    setUmapInversion,

    // Refs
    containerRef,
    hoverTimerRef,
    transformRef,

    // Utilities
    clearAllMenus,
    setHoverTimer: (timer: NodeJS.Timeout | null) => {
      hoverTimerRef.current = timer;
    },
  };
}