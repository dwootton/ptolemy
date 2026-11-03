import { AutocompleteItem } from '../types';
import { CompactValueBar } from '../../ValueBarChart';

interface SuggestionListProps {
  items: AutocompleteItem[];
  selectedIndex: number;
  onSelect: (item: AutocompleteItem) => void;
  onMouseEnter: (index: number) => void;
}

export function SuggestionList({ items, selectedIndex, onSelect, onMouseEnter }: SuggestionListProps) {
  if (items.length === 0) return null;

  return (
    <>
      {items.map((item, index) => (
        <div
          key={`${item.type}-${item.label}-${index}`}
          className={`px-3 py-2 text-sm cursor-pointer flex items-center justify-between hover:bg-zinc-700 ${
            index === selectedIndex ? 'bg-zinc-700' : ''
          }`}
          onClick={() => onSelect(item)}
          onMouseEnter={() => onMouseEnter(index)}
        >
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <span className={`text-xs px-1 rounded flex-shrink-0 text-white ${
              item.type === 'variable' ? 'bg-blue-400' : 
              item.type === 'existing_entity' ? 'bg-purple-600' :
              item.type === 'field' ? 'bg-indigo-600' :
              item.type === 'value' ? 'bg-green-600' :
              item.type === 'quartile' ? 'bg-cyan-600' :
              item.type === 'predicate_template' ? 'bg-orange-600' :
              'bg-gray-600'
            }`}>
              {item.type === 'variable' ? 'VAR' : 
               item.type === 'existing_entity' ? 'ENT' :
               item.type === 'field' ? 'FLD' : 
               item.type === 'value' ? 'VAL' : 
               item.type === 'quartile' ? 'Q' :
               item.type === 'predicate_template' ? 'TPL' : 'UNK'}
            </span>
            <span className="text-[var(--vscode-foreground)] truncate font-medium">
              {item.label}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {item.count && item.type === 'value' && (
              <CompactValueBar
                percentage={item.count > 0 ? Math.min(100, (item.count / Math.max(1, items[0]?.count || 1)) * 100) : 0}
                count={item.count}
                maxWidth={30}
                height={3}
              />
            )}
            {item.description && (
              <span className="text-xs text-[var(--vscode-descriptionForeground)] flex-shrink-0">
                {item.description}
              </span>
            )}
          </div>
        </div>
      ))}
    </>
  );
}