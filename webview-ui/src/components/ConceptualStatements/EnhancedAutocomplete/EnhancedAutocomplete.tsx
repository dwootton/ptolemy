import { useRef, useEffect } from 'react';
import { PredicateEntityService } from '../../../services/PredicateEntityService';
import type { DatasetProfile } from '../../DatasetLoader/components/DatasetViewer';
import { useEnhancedAutocomplete } from './hooks/useEnhancedAutocomplete';
import { ValueResults } from './components/ValueResults';
import { SuggestionList } from './components/SuggestionList';

interface EnhancedAutocompleteProps {
  show: boolean;
  query: string;
  cursorPosition: number;
  availableFields: string[];
  datasetData?: any[];
  profile?: DatasetProfile;
  entityService?: PredicateEntityService;
  onSelect: (item: any) => void;
  onClose: () => void;
  position?: { x: number; y: number };
  isChainContext?: boolean;
  chainTag?: string;
}

export function EnhancedAutocomplete(props: EnhancedAutocompleteProps) {
  const dropdownRef = useRef<HTMLDivElement>(null);
  
  const {
    items,
    valueData,
    showingValues,
    selectedIndex,
    setSelectedIndex,
    handleKeyDown,
    handleValueSelect,
    shouldRender
  } = useEnhancedAutocomplete({
    show: props.show,
    query: props.query,
    cursorPosition: props.cursorPosition,
    availableFields: props.availableFields,
    datasetData: props.datasetData || [],
    profile: props.profile,
    entityService: props.entityService,
    isChainContext: props.isChainContext || false,
    chainTag: props.chainTag
  });

  const totalItems = showingValues ? valueData.length : items.length;

  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (props.show) {
        handleKeyDown(totalItems, props.onSelect, props.onClose)(e as any);
      }
    };

    document.addEventListener('keydown', handleGlobalKeyDown);
    return () => document.removeEventListener('keydown', handleGlobalKeyDown);
  }, [props.show, totalItems, handleKeyDown, props.onSelect, props.onClose]);

  const handleValueSelectWrapper = (valueInfo: any) => {
    handleValueSelect(valueInfo, props.onSelect, props.onClose);
  };

  if (!shouldRender) {
    return null;
  }
  
  return (
    <div 
      ref={dropdownRef}
      className="absolute left-0 top-full z-[9999] mt-1 w-96 bg-zinc-800 border border-zinc-600 rounded shadow-2xl max-h-80 overflow-y-auto text-white"
    >
      {showingValues && (
        <ValueResults
          valueData={valueData}
          selectedIndex={selectedIndex}
          onValueSelect={handleValueSelectWrapper}
          onMouseEnter={setSelectedIndex}
        />
      )}
      
      {!showingValues && (
        <SuggestionList
          items={items}
          selectedIndex={selectedIndex}
          onSelect={props.onSelect}
          onMouseEnter={setSelectedIndex}
        />
      )}
    </div>
  );
}