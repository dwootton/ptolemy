import React, { useState, useRef, useEffect } from "react";
import { PredicateEntityService } from '../../services/PredicateEntityService';
import { hasPredicateSyntax } from '../../utilities/predicateParser';
import { EnhancedAutocomplete } from './EnhancedAutocomplete';
// import { ConceptualStatementItem } from './ConceptualStatementItem';
import { ConceptualMaterializationService } from '../../services/ConceptualMaterializationService';
import { Analet, Bearing } from '../../types/analet';
import type { DatasetProfile } from '../DatasetLoader/components/DatasetViewer';

interface ConceptualGroup {
  id: number;
  name: string;
  expanded: boolean;
  variables: string[];
}

interface SavedStatement {
  id: number;
  text: string;
  isActive?: boolean;
  createdAt?: string;
  materializedAnalets?: Analet[]; // Nested analets generated from this statement
  isExpanded?: boolean; // For folder-like behavior
}

interface Variable {
  name: string;
  displayName: string;
  type: string;
}

interface ConceptualStatementsProps {
  variables?: Variable[];
  groups?: ConceptualGroup[];
  onPanToStatement?: (statement: string) => void;
  stateService?: any; // StateService instance
  datasetData?: any[]; // For predicate filtering and value counts
  messageService?: any; // For LLM integration
  onAnaletGenerated?: (analet: Analet) => void; // Callback when analets are materialized
  profile?: DatasetProfile; // Dataset profile for value/quartile suggestions
}

// Enhanced parse statement to create variable pills with predicate support
const parseStatementToPills = (text: string, variables: Variable[], groups: ConceptualGroup[]): React.ReactNode[] => {
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
    } else if (fullMatch && fullMatch.startsWith('df.')) {
      // Handle @df.column.value pattern with enhanced styling for different value types
      const columnName = match[6];
      const valueName = match[7];
      
      // Determine value type for styling
      const isFrequencySelector = ['xl1', 'xl2', 'xl3', 'xl4', 'xl5', 'vs1', 'vs2', 'vs3', 'vs4', 'vs5', 'rare1', 'rare2', 'rare3', 'singleton', 'mode', 'unique'].includes(valueName);
      const isPercentile = (typeof valueName === 'string') ? valueName.match(/^(q[1-4]|p\d{2}|min|max|mean|median|std|iqr|range)$/) : null;
      
      const pillClass = isFrequencySelector 
        ? "bg-purple-500/90 text-white" 
        : isPercentile 
        ? "bg-green-500/90 text-white"
        : "bg-indigo-500/90 text-white";
      
      parts.push(
        <span key={`df-${columnName}-${valueName}-${match.index}`} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium ${pillClass}`}>
          <div className="w-2 h-2 bg-black/30 rounded-sm flex-shrink-0"></div>
          @df.{columnName}.{valueName}
        </span>
      );
    } else {
      // Handle regular mentions (including nested access like @Entity.field)
      const fullMatch = match[5] || '';
      
      if (fullMatch === '*') {
        // Special case for @* (all columns)
        parts.push(
          <span key={`all-${match.index}`} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-orange-500/90 text-black">
            <div className="w-2 h-2 bg-orange-700 rounded-sm flex-shrink-0"></div>
            @*
          </span>
        );
      } else if (fullMatch && fullMatch.startsWith('df.')) {
        // Handle @df.column.value pattern
        const dfParts = fullMatch.split('.');
        if (dfParts.length === 3) {
          const columnName = dfParts[1];
          const valueName = dfParts[2];
          
          const isFrequencySelector = ['xl1', 'xl2', 'xl3', 'xl4', 'xl5', 'vs1', 'vs2', 'vs3', 'vs4', 'vs5', 'rare1', 'rare2', 'rare3', 'singleton', 'mode', 'unique'].includes(valueName);
          const isPercentile = (typeof valueName === 'string') ? valueName.match(/^(q[1-4]|p\d{2}|min|max|mean|median|std|iqr|range)$/) : null;
          
          const pillClass = isFrequencySelector 
            ? "bg-purple-500/90 text-white" 
            : isPercentile 
            ? "bg-green-500/90 text-white"
            : "bg-indigo-500/90 text-white";
          
          parts.push(
            <span key={`df-${columnName}-${valueName}-${match.index}`} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium ${pillClass}`}>
              <div className="w-2 h-2 bg-black/30 rounded-sm flex-shrink-0"></div>
              @df.{columnName}.{valueName}
            </span>
          );
        }
      } else if (fullMatch.includes('.')) {
        // Handle nested access @Entity.field
        const [entityPart, fieldPart] = fullMatch.split('.');
        parts.push(
          <span key={`nested-${entityPart}-${fieldPart}-${match.index}`} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-indigo-600 text-white">
            <div className="w-2 h-2 bg-indigo-800 rounded-sm flex-shrink-0"></div>
            @{entityPart}.{fieldPart}
          </span>
        );
      } else {
        // Find matching variable or group
        const variable = variables.find(v => v.displayName === fullMatch || v.name === fullMatch);
        const group = groups.find(g => g.name === fullMatch);
        
        if (variable) {
          parts.push(
            <span key={`var-${variable.name}-${match.index}`} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-sky-400/90 text-black">
              <div className="w-2 h-2 bg-sky-600 rounded-sm flex-shrink-0"></div>
              @{variable.displayName}
            </span>
          );
        } else if (group) {
          parts.push(
            <span key={`group-${group.name}-${match.index}`} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-purple-600 text-white">
              <div className="w-2 h-2 bg-purple-800 rounded-sm flex-shrink-0"></div>
              @{group.name}
            </span>
          );
        } else {
          // Unknown mention - could be a predicate entity, render with special styling
          parts.push(
            <span key={`entity-${fullMatch}-${match.index}`} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-yellow-600 text-black">
              <div className="w-2 h-2 bg-yellow-800 rounded-sm flex-shrink-0"></div>
              @{fullMatch}
            </span>
          );
        }
      }
    }
    
    lastIndex = match.index + match[0].length;
  }
  
  // Add remaining text
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }
  
  return parts;
};

export function ConceptualStatements(props: ConceptualStatementsProps) {
  const { variables = [], groups = [], onPanToStatement, stateService, datasetData = [], messageService } = props;
  
  
  // If we have no dataset data, let's try to get some sample data for value extraction
  useEffect(() => {
    if (datasetData.length === 0 && variables.length > 0) {
      // TODO: We could send a message to the extension to request sample data
      // For now, we'll work with whatever data we have
    }
  }, [datasetData, variables]);
  
  // Note: savedStatements now handled through StateService conceptual folders
  const [savedStatements, setSavedStatements] = useState<SavedStatement[]>([]);
  void savedStatements; // Mark as used to avoid TypeScript warning
  const [statement, setStatement] = useState("");
  const [activeStatementId, setActiveStatementId] = useState<number | null>(null);
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
  
  // Materialization service
  const [materializationService] = useState(() => {
    return new ConceptualMaterializationService(messageService);
  });
  
  // Update services when data changes
  useEffect(() => {
    const fieldNames = variables.map(v => v.name);
    entityService.updateDataset(datasetData, fieldNames);
    materializationService.setMessageService(messageService);
    
  }, [datasetData, variables, entityService, materializationService, messageService]);

  const statementInputRef = useRef<HTMLTextAreaElement>(null);

  // Load saved statements from StateService on mount
  useEffect(() => {
    if (stateService) {
      const savedStatements = stateService.getConceptualStatements() || [];
      if (!Array.isArray(savedStatements) || savedStatements.length === 0) {
        setSavedStatements([]);
        return;
      }
      setSavedStatements(savedStatements.map((stmt: any) => ({
        id: stmt.id,
        text: stmt.text,
        isActive: false
      })));
    }
  }, [stateService]);

  // Enhanced statement handling with @variable mentions, regex selectors, and @df.column.value
  const handleStatementChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    let value = e.target.value;
    let cursorPosition = e.target.selectionStart;
    
    // Replace (x) with ⊗ symbol
    const originalValue = value;
    value = value.replace(/\(x\)/g, '⊗');
    const cursorAdjustment = value.length - originalValue.length;
    
    // Adjust cursor position if replacement occurred before cursor
    if (cursorAdjustment !== 0 && typeof originalValue === 'string') {
      const beforeCursor = originalValue.slice(0, cursorPosition);
      const replacementsBeforeCursor = (beforeCursor.match(/\(x\)/g) || []).length;
      cursorPosition += replacementsBeforeCursor * (cursorAdjustment / ((originalValue.match(/\(x\)/g) || []).length || 1));
    }
    
    setStatement(value);
    
    // Update cursor position if replacement occurred
    if (cursorAdjustment !== 0) {
      setTimeout(() => {
        if (statementInputRef.current) {
          statementInputRef.current.setSelectionRange(cursorPosition, cursorPosition);
        }
      }, 0);
    }

    // Check for @mentions and trigger EnhancedAutocomplete
    const textBeforeCursor = (typeof value === 'string') ? value.slice(0, cursorPosition) : '';
    const atIndex = textBeforeCursor.lastIndexOf('@');
    
    // Check for chain syntax: @tag[option1,option2,...]
    const chainMatch = textBeforeCursor ? textBeforeCursor.match(/@(\w+)\[([^\]]*?)$/) : null;
    
    if (chainMatch) {
      // We're inside chain brackets
      const tagName = chainMatch[1];
      const chainContent = chainMatch[2];
      const lastCommaIndex = chainContent.lastIndexOf(',');
      
      // Extract current option being typed (after the last comma)
      const currentOption = lastCommaIndex >= 0 
        ? chainContent.slice(lastCommaIndex + 1).trim()
        : chainContent.trim();
      
      
      // Set autocomplete with chain context
      setAutocomplete({
        show: true,
        query: `${tagName}.${currentOption}`, // Pass both tag and current option
        cursorPosition: cursorPosition,
        position: { x: 0, y: 0 },
        isChainContext: true,
        chainTag: tagName
      });
    } else if (atIndex !== -1 && atIndex > textBeforeCursor.lastIndexOf(' ')) {
      // Regular @mention handling
      const rawQuery = textBeforeCursor.slice(atIndex + 1);
      
      // Check if this might be starting a chain (ends with [)
      if (rawQuery.endsWith('[')) {
        const tagName = rawQuery.slice(0, -1);
        
        setAutocomplete({
          show: true,
          query: `${tagName}.`, // Show field values for this tag
          cursorPosition: cursorPosition,
          position: { x: 0, y: 0 },
          isChainContext: true,
          chainTag: tagName
        });
      } else {
        
        // Regular autocomplete
        setAutocomplete({
          show: true,
          query: rawQuery,
          cursorPosition: cursorPosition,
          position: { x: 0, y: 0 }
        });
      }
    } else {
      setAutocomplete(prev => ({ ...prev, show: false }));
    }
  };

  const handleStatementKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Handle Enter key: if autocomplete is open, prevent save and let autocomplete handle selection.
    if (e.key === 'Enter' && !e.shiftKey) {
      if (autocomplete.show) {
        e.preventDefault();
        return;
      }
      if (statement.trim()) {
        e.preventDefault();
        handleSaveStatement();
      }
    }
    // Key handling for autocomplete is managed by EnhancedAutocomplete component
  };

  // Handle autocomplete selection for the enhanced autocomplete
  const handleAutocompleteSelect = (item: any) => {
    const textarea = statementInputRef.current;
    if (!textarea) return;

    const value = statement;
    const cursorPosition = textarea.selectionStart;
    const textBeforeCursor = (typeof value === 'string') ? value.slice(0, cursorPosition) : '';
    
    // Find the start and end positions to replace
    let replaceStart = cursorPosition;
    let replaceEnd = cursorPosition;
    let insertValue = item.insert;
    
    // Check if we're in chain context
    const chainMatch = textBeforeCursor ? textBeforeCursor.match(/@(\w+)\[([^\]]*?)$/) : null;
    
    if (chainMatch && autocomplete.isChainContext) {
      // We're inside chain brackets: @tag[option1,option2,...]
      const chainContent = chainMatch[2];
      const lastCommaIndex = chainContent.lastIndexOf(',');
      
      if (lastCommaIndex >= 0) {
        // Replace current option after the last comma
        const startOfCurrentOption = (chainMatch.index || 0) + chainMatch[0].length - (chainContent.length - lastCommaIndex - 1);
        replaceStart = startOfCurrentOption;
        replaceEnd = cursorPosition;
        insertValue = item.insert; // Just the value, no special formatting needed
      } else {
        // Replace everything inside brackets
        replaceStart = (chainMatch.index || 0) + chainMatch[1].length + 2; // After "@tag["
        replaceEnd = cursorPosition;
        insertValue = item.insert;
      }
    } else {
      // Handle different completion contexts for regular autocomplete
      if (item.type === 'value') {
        // For values like "color.", replace everything after the dot
        const lastDotIndex = textBeforeCursor.lastIndexOf('.');
        if (lastDotIndex !== -1) {
          replaceStart = lastDotIndex + 1;
          replaceEnd = cursorPosition;
        }
      } else if (item.type === 'variable' || item.type === 'existing_entity' || item.type === 'predicate_template') {
        // For variables, entities, and templates, replace from the @ symbol
        const atIndex = textBeforeCursor.lastIndexOf('@');
        if (atIndex !== -1) {
          replaceStart = atIndex;
          replaceEnd = cursorPosition;
          
          // If this is starting a chain (user typed @tag[), add the bracket
          if (textBeforeCursor.endsWith('[') && autocomplete.chainTag) {
            insertValue = `@${autocomplete.chainTag}[${item.insert}`;
          }
        }
      } else if (item.type === 'field') {
        // For fields in predicate context, replace the current field name
        const atMatch = textBeforeCursor.match(/@(\w+)\(([^)]*)$/);
        if (atMatch) {
          const insideParensStart = textBeforeCursor.lastIndexOf('(') + 1;
          replaceStart = insideParensStart;
          replaceEnd = cursorPosition;
        }
      }
    }
    
    // Construct the new value
    const beforeReplace = value.slice(0, replaceStart);
    const afterReplace = value.slice(replaceEnd);
    const newValue = beforeReplace + insertValue + afterReplace;
    
    setStatement(newValue);
    
    // Set cursor after the insertion
    setTimeout(() => {
      const newCursorPos = replaceStart + item.insert.length;
      textarea.setSelectionRange(newCursorPos, newCursorPos);
      textarea.focus();
    }, 0);
  };

  // Handle statement materialization
  /* const handleMaterializeStatement = useCallback(async (savedStatement: SavedStatement) => {
    console.log('🔮 [ConceptualStatements] Materializing statement:', savedStatement.text);
    
    try {
      const result = await materializationService.materialize({
        statement: {
          id: savedStatement.id,
          text: savedStatement.text,
          createdAt: savedStatement.createdAt || new Date().toISOString()
        },
        datasetInfo: {
          name: 'Current Dataset',
          columns: variables.map(v => v.name),
          sampleData: datasetData.slice(0, 100) // Sample for context
        },
        maxAnalets: 5
      });
      
      if (result.success && result.analets.length > 0) {
        console.log('✅ [ConceptualStatements] Generated', result.analets.length, 'analets');
        
        // Update the statement with materialized analets
        setSavedStatements(prev => prev.map(s => 
          s.id === savedStatement.id 
            ? { ...s, materializedAnalets: result.analets, isExpanded: true }
            : s
        ));
        
        // Notify parent component about generated analets
        result.analets.forEach(analet => {
          onAnaletGenerated?.(analet);
        });
        
        console.log('🔮 [ConceptualStatements] Materialization details:', result.generationDetails);
      } else {
        console.error('❌ [ConceptualStatements] Materialization failed:', result.error);
        // TODO: Show error toast to user
      }
    } catch (error) {
      console.error('❌ [ConceptualStatements] Materialization error:', error);
      // TODO: Show error toast to user
    }
  }, [materializationService, variables, datasetData, onAnaletGenerated]); */
  
  // Handle folder expand/collapse
  /* const handleToggleExpand = useCallback((statementId: number) => {
    setSavedStatements(prev => prev.map(s => 
      s.id === statementId 
        ? { ...s, isExpanded: !s.isExpanded }
        : s
    ));
  }, []); */
  
  // Handle statement editing
  /* const handleEditStatement = useCallback((savedStatement: SavedStatement) => {
    setStatement(savedStatement.text);
    setActiveStatementId(savedStatement.id);
    
    // Mark statement as active
    setSavedStatements(prev => prev.map(s => ({
      ...s,
      isActive: s.id === savedStatement.id
    })));
  }, []); */
  
  // Handle statement deletion
  /* const handleDeleteStatement = useCallback((statementId: number) => {
    setSavedStatements(prev => prev.filter(s => s.id !== statementId));
    
    // Remove from StateService
    if (stateService) {
      // TODO: Add delete method to StateService
      console.log('🗑️ [ConceptualStatements] Deleting statement:', statementId);
    }
    
    // Clear active statement if it was the deleted one
    if (activeStatementId === statementId) {
      setActiveStatementId(null);
      setStatement('');
    }
  }, [activeStatementId, stateService]); */

  const handleSaveStatement = () => {
    const stmt = statement.trim();
    if (!stmt) return;

    // Register any new predicate entities from the statement
    if (hasPredicateSyntax(stmt)) {
      entityService.registerEntityFromStatement(stmt);
    }

    if (activeStatementId) {
      // Update existing statement/analet
      setSavedStatements(prev => prev.map(s =>
        s.id === activeStatementId
          ? { ...s, text: stmt, isActive: false }
          : { ...s, isActive: false }
      ));
      
      // Update the corresponding analet in StateService
      if (stateService && activeStatementId) {
        const existingAnalet = stateService.getAnaletById(activeStatementId);
        if (existingAnalet) {
          const updatedAnalet = {
            ...existingAnalet,
            statement: stmt,
            explanation: `Conceptual statement: ${stmt}`
          };
          stateService.updateAnalet(updatedAnalet);
          
          // Force refresh of analet loader
          window.dispatchEvent(new CustomEvent('analetsUpdated'));
        } else {
          // Fallback to old method if analet not found
          stateService.updateConceptualStatement(activeStatementId, stmt);
        }
      }
    } else {
      // Create new bearing
      const newBearing: Bearing = {
        id: Date.now(),
        name: `Bearing ${(stateService?.getBearings ? (stateService.getBearings().length + 1) : 1)}`,
        statement: stmt,
        timestamp: new Date().toISOString(),
        tags: ['bearing'],
        location: {
          id: `bearing-${Date.now()}`,
          x: Math.random() * 400 + 100, // Random position near top-left of map
          y: Math.random() * 300 + 100
        }
        // embedding will be populated after API call
      };
      
      // Add to StateService
      if (stateService) {
        stateService.addBearing(newBearing);
        // Immediately set active so focus mode interactions apply (no opacity dimming)
        try { stateService.setActiveBearingId(newBearing.id); } catch {}
        // No direct embedding generation for bearings; embedding will be computed as
        // the average of member analet embeddings when bearings have children.

        // Force refresh of analysis view
        window.dispatchEvent(new CustomEvent('bearingsUpdated'));
      }
    }

    setStatement("");
    setActiveStatementId(null);
  };

  // Legacy function removed - functionality moved to ConceptualStatementItem

  return (
    <div className="bg-[var(--vscode-editor-background)] rounded-md p-3">
      <h4 className="text-xs uppercase text-[var(--vscode-descriptionForeground)] tracking-wide mb-2">
        Set a Bearing
      </h4>
      
      <div className="relative">
        <textarea
          ref={statementInputRef}
          value={statement}
          onChange={handleStatementChange}
          onKeyDown={handleStatementKeyDown}
          placeholder="Set a bearing for your analysis... Type @ for variables or @Entity(@field.value) for filtered entities. Use @Entity.field for nested access."
          className="w-full min-h-[80px] bg-[var(--vscode-input-background)] border border-[var(--vscode-input-border)] rounded text-sm p-2 text-[var(--vscode-input-foreground)] resize-none focus:outline-none focus:ring-1 focus:ring-[var(--vscode-focusBorder)]"
        />
        
        {/* Enhanced Autocomplete */}
        <EnhancedAutocomplete
          show={autocomplete.show}
          query={autocomplete.query}
          cursorPosition={autocomplete.cursorPosition}
          availableFields={variables.map(v => v.name)}
          datasetData={datasetData}
          profile={props.profile}
          entityService={entityService}
          onSelect={handleAutocompleteSelect}
          onClose={() => setAutocomplete(prev => ({ ...prev, show: false }))}
          position={autocomplete.position}
          isChainContext={autocomplete.isChainContext}
          chainTag={autocomplete.chainTag}
        />
      </div>
      

      {/* Parsed Statement Preview */}
      {statement.trim() && (
        <div className="mt-3 p-2 bg-[var(--vscode-textBlockQuote-background)] rounded">
          <div className="flex items-center justify-between mb-1">
            <h5 className="text-xs uppercase text-[var(--vscode-descriptionForeground)] tracking-wide">
              Bearing
            </h5>
            <button
              onClick={handleSaveStatement}
              className="flex items-center gap-1 px-2 py-1 bg-[var(--vscode-button-background)] text-[var(--vscode-button-foreground)] hover:bg-[var(--vscode-button-hoverBackground)] rounded text-xs font-medium transition-colors"
              title="Set bearing on analysis map"
              disabled={!statement.trim()}
            >
              <svg className="w-3 h-3" viewBox="0 0 16 16" fill="currentColor">
                <path d="M8 0a8 8 0 100 16A8 8 0 008 0zM8 2a6 6 0 110 12A6 6 0 018 2z"/>
                <path d="M8 3v5l3 2-1 1.5L6 9V3h2z"/>
                <circle cx="8" cy="8" r="1" fill="currentColor"/>
              </svg>
              Bearing
            </button>
          </div>
          <div 
            className="text-sm flex flex-wrap items-center gap-1 cursor-pointer hover:bg-[var(--vscode-list-hoverBackground)] rounded p-1 -m-1"
            onClick={() => onPanToStatement?.(statement)}
            title="Click to pan map to this statement"
          >
            {parseStatementToPills(statement, variables, groups).map((part, index) => (
              <React.Fragment key={index}>{part}</React.Fragment>
            ))}
          </div>
        </div>
      )}

      {/* Conceptual statements now appear directly in the analet folder list */}
      {/* No separate UI section needed - they're integrated as folder items */}
    </div>
  );
} 