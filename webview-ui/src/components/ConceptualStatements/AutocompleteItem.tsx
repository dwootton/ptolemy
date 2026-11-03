import React, { useState, useEffect } from 'react';

interface AutocompleteItemProps {
  item: {
    type: 'variable' | 'entity' | 'field' | 'value' | 'predicate_template' | 'existing_entity';
    label: string;
    insert: string;
    description?: string;
    count?: number;
  };
  isSelected: boolean;
  onClick: () => void;
  onMouseEnter: () => void;
  datasetData?: any[];
  fieldName?: string;
}

export const AutocompleteItem: React.FC<AutocompleteItemProps> = ({
  item,
  isSelected,
  onClick,
  onMouseEnter,
  datasetData = [],
  fieldName
}) => {
  const [loading, setLoading] = useState(false);
  const [counts, setCounts] = useState<{total: number, nonNull: number} | null>(null);

  // Calculate counts for variables
  useEffect(() => {
    if (item.type === 'variable' && datasetData.length > 0 && fieldName) {
      setLoading(true);
      
      // Simulate async count calculation (you might want to debounce this)
      const timer = setTimeout(() => {
        const totalRows = datasetData.length;
        const nonNullRows = datasetData.filter(row => 
          row[fieldName] !== null && 
          row[fieldName] !== undefined && 
          row[fieldName] !== ''
        ).length;
        
        setCounts({ total: totalRows, nonNull: nonNullRows });
        setLoading(false);
      }, 150); // Small delay to show loading state
      
      return () => clearTimeout(timer);
    } else if (item.count !== undefined) {
      // Use pre-calculated count from item
      setCounts({ total: item.count, nonNull: item.count });
    }
  }, [item.type, item.count, datasetData, fieldName]);

  const getTypeInfo = () => {
    switch (item.type) {
      case 'variable':
        return { label: 'VAR', bgColor: 'bg-blue-400' };
      case 'existing_entity':
        return { label: 'ENT', bgColor: 'bg-purple-600' };
      case 'field':
        return { label: 'FLD', bgColor: 'bg-indigo-600' };
      case 'value':
        return { label: 'VAL', bgColor: 'bg-green-600' };
      case 'predicate_template':
        return { label: 'TPL', bgColor: 'bg-orange-600' };
      default:
        return { label: 'UNK', bgColor: 'bg-gray-600' };
    }
  };

  const typeInfo = getTypeInfo();

  return (
    <div
      className={`px-3 py-2 text-sm cursor-pointer flex items-center justify-between ${
        isSelected 
          ? 'bg-[var(--vscode-list-activeSelectionBackground)]' 
          : 'hover:bg-[var(--vscode-list-hoverBackground)]'
      }`}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
    >
      <div className="flex items-center gap-2 flex-1 min-w-0">
        {/* Type Badge */}
        <span className={`text-xs px-1 rounded flex-shrink-0 text-white ${typeInfo.bgColor}`}>
          {typeInfo.label}
        </span>
        
        {/* Item Label */}
        <span className="text-[var(--vscode-foreground)] truncate font-medium">
          {item.label}
        </span>
      </div>
      
      {/* Right side content */}
      <div className="flex items-center gap-2 flex-shrink-0">
        {/* Description */}
        {item.description && !loading && !counts && (
          <span className="text-xs text-[var(--vscode-descriptionForeground)]">
            {item.description}
          </span>
        )}
        
        {/* Loading State */}
        {loading && (
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 border border-[var(--vscode-progressBar-background)] border-t-[var(--vscode-button-background)] rounded-full animate-spin"></div>
            <div className="w-12 h-2 bg-[var(--vscode-progressBar-background)] rounded animate-pulse"></div>
          </div>
        )}
        
        {/* Counts */}
        {counts && !loading && (
          <div className="text-xs text-[var(--vscode-descriptionForeground)]">
            {item.type === 'variable' ? (
              <span>
                {counts.nonNull.toLocaleString()} of {counts.total.toLocaleString()} rows
                {counts.nonNull < counts.total && (
                  <span className="text-[var(--vscode-errorForeground)] ml-1">
                    ({((counts.total - counts.nonNull) / counts.total * 100).toFixed(1)}% null)
                  </span>
                )}
              </span>
            ) : (
              <span>{counts.total.toLocaleString()} rows</span>
            )}
          </div>
        )}
        
        {/* Skeleton for no data yet */}
        {!loading && !counts && !item.description && item.type === 'variable' && (
          <div className="w-16 h-2 bg-[var(--vscode-progressBar-background)] rounded animate-pulse"></div>
        )}
      </div>
    </div>
  );
};