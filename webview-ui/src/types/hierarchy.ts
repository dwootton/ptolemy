import { Analet, Bearing, AnalysisNote } from './analet';
import { HierarchyNode } from 'd3-hierarchy';

export interface AnaletFolderNode {
  id: string;
  name: string;
  type: 'folder' | 'analet' | 'bearing' | 'note';
  analetId?: number; // Only for analet nodes
  analet?: Analet; // Full analet data for analet nodes
  bearingId?: number; // Only for bearing nodes
  bearing?: Bearing; // Full bearing data for bearing nodes
  noteId?: number; // Only for note nodes
  note?: AnalysisNote; // Full note data for note nodes
  children?: AnaletFolderNode[];
  isExpanded?: boolean;
  parentId?: string;
  createdAt?: string;
  updatedAt?: string;
  isBearing?: boolean; // Indicates if this is a conceptual bearing folder
  bearingStatement?: string; // The conceptual statement for bearings
}

export type AnaletHierarchyNode = HierarchyNode<AnaletFolderNode>;

export interface DropIndicator {
  targetId: string;
  position: 'above' | 'below' | 'inside';
  type: 'insert' | 'folder-creation';
}

export interface DragState {
  isDragging: boolean;
  draggedId?: string;
  draggedType?: 'folder' | 'analet' | 'bearing' | 'note';
  dropIndicator?: DropIndicator;
  hoveredId?: string;
  canCreateFolder?: boolean; // When dragging analet over another analet
  hoverStartTime?: number;
  hoverExpandTimeout?: NodeJS.Timeout;
}

export interface SelectionState {
  selectedIds: Set<string>;
  lastSelectedId?: string;
  contextMenuOpen?: boolean;
  contextMenuPosition?: { x: number; y: number };
}

export interface FolderOperations {
  createFolder: (name?: string, parentId?: string) => void;
  renameFolder: (id: string, newName: string) => void;
  renameAnalet: (id: string, newName: string) => void;
  deleteFolder: (id: string) => void;
  moveItem: (itemId: string, targetId: string, position: 'above' | 'below' | 'inside') => void;
  createFolderFromAnalets: (analet1Id: number, analet2Id: number, folderName?: string) => void;
  toggleFolder: (id: string) => void;
  selectItem: (id: string, multiSelect?: boolean) => void;
  clearSelection: () => void;
  createFolderFromSelection: (folderName?: string) => void;
  createBearingFromSelection: (bearingName?: string) => void;
  linkSelectedItems: () => void;
  unlinkItems: (itemId1: string, itemId2: string) => void;
}

export interface AnaletLink {
  id: string;
  fromId: number; // Analet ID
  toId: number;   // Analet ID
  createdAt: string;
  type?: 'thread' | 'derivation' | 'reference';
}

export interface HierarchyState {
  root: AnaletFolderNode;
  flatMap: Map<string, AnaletFolderNode>; // For quick lookups
  expandedFolders: Set<string>;
  selectionState: SelectionState;
  links: AnaletLink[]; // Thread links between analets
  hoveredItemId?: string; // For showing link connections on hover
} 