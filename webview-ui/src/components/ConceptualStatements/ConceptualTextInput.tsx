import React, { useState, useRef, useEffect } from "react";
import { PredicateEntityService } from '../../services/PredicateEntityService';
import { hasPredicateSyntax } from '../../utilities/predicateParser';
import { EnhancedAutocomplete } from './EnhancedAutocomplete';
import type { DatasetProfile } from '../DatasetLoader/components/DatasetViewer';

interface ConceptualGroup {
  id: number;
  name: string;
  expanded: boolean;
  variables: string[];
}

interface Variable {
  name: string;
  displayName: string;
  type: string;
}

interface ConceptualTextInputProps {
  value: string;
  onChange: (value: string) => void;
  variables?: Variable[];
  groups?: ConceptualGroup[];
  datasetData?: any[];
  profile?: DatasetProfile;
  placeholder?: string;
  className?: string;
  minHeight?: string;
  disabled?: boolean;
}

// Enhanced parse statement to create variable pills with predicate support
const parseStatementToPills = (text: string, variables: Variable[], _groups: ConceptualGroup[]): React.ReactNode[] => {
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  
  // Enhanced regex for @mentions including:
  // - Chain syntax: @tag[option1,option2,option3]
  // - Predicate entities: @Entity(@field.value)
  // - Nested access: @Entity.field and legacy patterns
  const mentionRegex = /@(\w+)\[([^\]]+)\]|@(\w+)\(([^)]+)\)|@(\*|df\.(\w+)\.(\w+)|\w+(?:\.\w+)?)/g;
  let match;
  
  while ((match = mentionRegex.exec(text)) !== null) {
    // Add text before mention
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    
    
    // Handle chain syntax @tag[option1,option2,option3]
    if (match[1] && match[2] && match[0].includes('[')) {
      const tagName = match[1];
      const chainOptions = match[2];
      const options = chainOptions.split(',').map(opt => opt.trim());
      
      parts.push(
        <span key={`chain-${tagName}-${match.index}`} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-emerald-600 text-white border border-emerald-400">
          <div className="w-2 h-2 bg-emerald-800 rounded-sm flex-shrink-0"></div>
          @{tagName}[{options.length > 2 ? `${options.slice(0,2).join(',')},...` : chainOptions}]
        </span>
      );
      lastIndex = match.index + match[0].length;
      continue;
    }
    
    // Handle predicate entities @Entity(@field.value)
    if (match[3] && match[4]) {
      const entityName = match[3];
      const predicateString = match[4];
      
      parts.push(
        <span key={`predicate-${entityName}-${match.index}`} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-purple-600 text-white border border-purple-400">
          <div className="w-2 h-2 bg-purple-800 rounded-sm flex-shrink-0"></div>
          @{entityName}({predicateString})
        </span>
      );
      lastIndex = match.index + match[0].length;
      continue;
    }
    
    const fullMatch = match[5] || '';
    
    if (fullMatch === '*') {
      // Special case for @* (all columns)
      parts.push(
        <span key={`all-${match.index}`} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-orange-500/90 text-black">
          <div className="w-2 h-2 bg-orange-700 rounded-sm flex-shrink-0"></div>
          @*
        </span>
      );
      lastIndex = match.index + match[0].length;
      continue;
    }
    
    const variable = variables.find(v => v.name === fullMatch || `df.${v.name}` === fullMatch);
    if (variable) {
      parts.push(
        <span key={`var-${variable.name}-${match.index}`} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-blue-600 text-white border border-blue-400">
          <div className="w-2 h-2 bg-blue-800 rounded-sm flex-shrink-0"></div>
          @{variable.displayName || variable.name}
        </span>
      );
      lastIndex = match.index + match[0].length;
      continue;
    }
    
    // Handle predicate patterns
    if (hasPredicateSyntax(fullMatch)) {
      parts.push(
        <span key={`predicate-${fullMatch}-${match.index}`} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-purple-600 text-white border border-purple-400">
          <div className="w-2 h-2 bg-purple-800 rounded-sm flex-shrink-0"></div>
          @{fullMatch}
        </span>
      );
      lastIndex = match.index + match[0].length;
      continue;
    }
    
    // Unknown @mention - render as warning
    parts.push(
      <span key={`unknown-${fullMatch}-${match.index}`} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-yellow-500 text-black border border-yellow-400">
        <div className="w-2 h-2 bg-yellow-700 rounded-sm flex-shrink-0"></div>
        @{fullMatch}
      </span>
    );
    
    lastIndex = match.index + match[0].length;
  }
  
  // Add remaining text
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }
  
  return parts;
};

export function ConceptualTextInput(props: ConceptualTextInputProps) {
  const {
    value,
    onChange,
    variables = [],
    groups = [],
    datasetData = [],
    profile,
    placeholder = "Type @ for variables...",
    className = "",
    minHeight = "80px",
    disabled = false
  } = props;
  
  const [autocomplete, setAutocomplete] = useState<{
    show: boolean;
    query: string;
    cursorPosition: number;
    position: {x: number, y: number};
    isChainContext?: boolean;
    chainTag?: string;
  }>({ show: false, query: '', cursorPosition: 0, position: {x: 0, y: 0} });
  
  // Predicate entity service
  const [entityService] = useState(() => {
    const fieldNames = variables.map(v => v.name);
    return new PredicateEntityService(datasetData, fieldNames);
  });
  
  // Update services when data changes
  useEffect(() => {
    const fieldNames = variables.map(v => v.name);
    entityService.updateDataset(datasetData, fieldNames);
  }, [datasetData, variables, entityService]);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Enhanced statement handling with @variable mentions, regex selectors, and @df.column.value
  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    let newValue = e.target.value;
    let cursorPosition = e.target.selectionStart;
    
    // Replace (x) with ⊗ symbol
    const originalValue = newValue;
    newValue = newValue.replace(/\(x\)/g, '⊗');
    const cursorAdjustment = newValue.length - originalValue.length;
    
    // Adjust cursor position if replacement occurred before cursor
    if (cursorAdjustment !== 0 && typeof originalValue === 'string') {
      const beforeCursor = originalValue.slice(0, cursorPosition);
      const replacementsBeforeCursor = (beforeCursor.match(/\(x\)/g) || []).length;
      cursorPosition += replacementsBeforeCursor * (cursorAdjustment / ((originalValue.match(/\(x\)/g) || []).length || 1));
    }
    
    onChange(newValue);
    
    // Update cursor position if replacement occurred
    if (cursorAdjustment !== 0) {
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.setSelectionRange(cursorPosition, cursorPosition);
        }
      }, 0);
    }

    // Check for @mentions and trigger EnhancedAutocomplete
    const textBeforeCursor = (typeof newValue === 'string') ? newValue.slice(0, cursorPosition) : '';
    const atIndex = textBeforeCursor.lastIndexOf('@');
    
    // Check for chain syntax: @tag[option1,option2,...]
    const chainMatch = textBeforeCursor ? textBeforeCursor.match(/@(\w+)\[([^\]]*?)$/) : null;
    
    if (chainMatch) {
      // We're inside chain brackets
      const tagName = chainMatch[1];
      const chainContent = chainMatch[2];
      const rect = textareaRef.current?.getBoundingClientRect();
      setAutocomplete({
        show: true,
        query: chainContent,
        cursorPosition: cursorPosition,
        position: rect ? { x: rect.left, y: rect.bottom + 5 } : { x: 0, y: 0 },
        isChainContext: true,
        chainTag: tagName
      });
      return;
    }
    
    if (atIndex !== -1 && atIndex < cursorPosition) {
      const query = textBeforeCursor.slice(atIndex + 1);
      
      // Close autocomplete if query contains a space (user finished the variable reference)
      if (query.includes(' ')) {
        setAutocomplete(prev => ({ ...prev, show: false }));
        return;
      }
      
      const rect = textareaRef.current?.getBoundingClientRect();
      
      setAutocomplete({
        show: true,
        query: query,
        cursorPosition: cursorPosition,
        position: rect ? { x: rect.left, y: rect.bottom + 5 } : { x: 0, y: 0 }
      });
    } else {
      setAutocomplete(prev => ({ ...prev, show: false }));
    }
  };

  // Handle key events
  const handleKeyDown = (_e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Key handling for autocomplete is managed by EnhancedAutocomplete component
    if (autocomplete.show) {
      return; // Let EnhancedAutocomplete handle keys when visible
    }
  };

  // Handle autocomplete selection for the enhanced autocomplete
  const handleAutocompleteSelect = (item: any) => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const currentValue = value;
    const cursorPosition = textarea.selectionStart;
    const textBeforeCursor = (typeof currentValue === 'string') ? currentValue.slice(0, cursorPosition) : '';
    const textAfterCursor = (typeof currentValue === 'string') ? currentValue.slice(cursorPosition) : '';
    let newValue = '';
    let newCursorPosition = cursorPosition;

    if (autocomplete.isChainContext && autocomplete.chainTag) {
      // Handle chain context selection
      const chainStart = textBeforeCursor.lastIndexOf(`@${autocomplete.chainTag}[`);
      if (chainStart !== -1) {
        const beforeChain = textBeforeCursor.slice(0, chainStart);
        const selectedValue = typeof item === 'string' ? item : item.value || item.label;
        newValue = beforeChain + `@${autocomplete.chainTag}[${selectedValue}]` + textAfterCursor;
        newCursorPosition = beforeChain.length + `@${autocomplete.chainTag}[${selectedValue}]`.length;
      }
    } else {
      // Handle regular @ mention
      const atIndex = textBeforeCursor.lastIndexOf('@');
      if (atIndex !== -1) {
        const beforeAt = textBeforeCursor.slice(0, atIndex);
        const selectedValue = typeof item === 'string' ? item : item.insert || item.value || item.label;
        // If the insert value already includes @, don't add another one
        const insertValue = selectedValue.startsWith('@') ? selectedValue : '@' + selectedValue;
        newValue = beforeAt + insertValue + textAfterCursor;
        newCursorPosition = beforeAt.length + insertValue.length;
      }
    }

    onChange(newValue);
    setAutocomplete(prev => ({ ...prev, show: false }));

    // Set cursor position after the inserted text
    setTimeout(() => {
      if (textarea) {
        textarea.focus();
        textarea.setSelectionRange(newCursorPosition, newCursorPosition);
      }
    }, 0);
  };

  // Render pills for preview (when not actively editing)
  const renderPills = () => {
    if (!showPills) {
      return null;
    }
    
    const pills = parseStatementToPills(value, variables, groups);
    
    return (
      <div className="absolute inset-0 p-2 pointer-events-none overflow-hidden bg-[var(--vscode-input-background)]">
        <div className="flex flex-wrap gap-1 items-start">
          {pills.map((pill, index) => (
            <span key={index}>{pill}</span>
          ))}
        </div>
      </div>
    );
  };

  const isEditing = textareaRef.current === document.activeElement;
  const showPills = !isEditing && value.trim();

  return (
    <div className={`relative ${className}`}>
      <textarea
        ref={textareaRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        className={`w-full bg-[var(--vscode-input-background)] border border-[var(--vscode-input-border)] rounded text-sm p-2 resize-none focus:outline-none focus:ring-1 focus:ring-[var(--vscode-focusBorder)] ${disabled ? 'opacity-50 cursor-not-allowed' : ''} ${showPills ? 'text-transparent' : 'text-[var(--vscode-input-foreground)]'}`}
        style={{ minHeight }}
      />
      
      {renderPills()}
      
      {/* Enhanced Autocomplete */}
      <EnhancedAutocomplete
        show={autocomplete.show}
        query={autocomplete.query}
        cursorPosition={autocomplete.cursorPosition}
        availableFields={variables.map(v => v.name)}
        datasetData={datasetData}
        profile={profile}
        entityService={entityService}
        onSelect={handleAutocompleteSelect}
        onClose={() => setAutocomplete(prev => ({ ...prev, show: false }))}
        position={autocomplete.position}
        isChainContext={autocomplete.isChainContext}
        chainTag={autocomplete.chainTag}
      />
    </div>
  );
}