import { ColumnValueData } from '../../../../services/DatasetValueExtractor';
import { ValueBarChart } from '../../ValueBarChart';

interface ValueResultsProps {
  valueData: ColumnValueData[];
  selectedIndex: number;
  onValueSelect: (valueInfo: ColumnValueData) => void;
  onMouseEnter: (index: number) => void;
}

export function ValueResults({ valueData, selectedIndex, onValueSelect, onMouseEnter }: ValueResultsProps) {
  if (valueData.length === 0) return null;

  const maxCount = valueData[0]?.count || 1; // First item has highest count

  return (
    <div className="border-b border-[var(--vscode-widget-border)]">
      <div className="px-3 py-2 text-xs uppercase text-[var(--vscode-descriptionForeground)] tracking-wide bg-[var(--vscode-editor-background)]">
        Column Values ({valueData.length} unique)
      </div>
      {valueData.map((valueInfo, index) => (
        <ValueBarChart
          key={`value-${valueInfo.value}-${index}`}
          value={valueInfo.displayValue}
          count={valueInfo.count}
          percentage={valueInfo.percentage}
          maxCount={maxCount}
          isSelected={index === selectedIndex}
          onClick={() => onValueSelect(valueInfo)}
          onMouseEnter={() => onMouseEnter(index)}
        />
      ))}
    </div>
  );
}