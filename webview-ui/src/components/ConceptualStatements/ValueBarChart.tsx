import React from 'react';

// Interface for autocomplete dropdown items with visual bars
interface ValueBarChartProps {
  value: string;
  count: number;
  percentage: number;
  maxCount: number;
  isSelected?: boolean;
  onClick?: () => void;
  onMouseEnter?: () => void;
  maxWidth?: number;
  height?: number;
}

export const ValueBarChart: React.FC<ValueBarChartProps> = ({
  value,
  count,
  percentage,
  maxCount,
  isSelected = false,
  onClick,
  onMouseEnter,
  maxWidth = 60,
  height = 4
}) => {
  // Calculate bar width using relative scaling based on maxCount for better visual comparison
  const relativePercentage = maxCount > 0 ? (count / maxCount) * 100 : percentage;
  const barWidth = Math.max(1, (relativePercentage / 100) * maxWidth);
  
  return (
    <div 
      className={`px-3 py-2 cursor-pointer flex items-center justify-between hover:bg-[var(--vscode-list-hoverBackground)] ${
        isSelected ? 'bg-[var(--vscode-list-activeSelectionBackground)]' : ''
      }`}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
    >
      <div className="flex-1 min-w-0 mr-2">
        <div className="text-sm text-[var(--vscode-foreground)] truncate font-medium">
          {value}
        </div>
        <div className="text-xs text-[var(--vscode-descriptionForeground)] mt-0.5">
          {count} rows ({percentage.toFixed(1)}%)
        </div>
      </div>
      <div 
        className="bg-[var(--vscode-widget-border)] rounded-sm relative overflow-hidden"
        style={{ width: maxWidth, height }}
      >
        <div 
          className="bg-[var(--vscode-button-background)] h-full rounded-sm transition-all duration-200"
          style={{ width: barWidth }}
        />
      </div>
    </div>
  );
};

// Legacy interface for other uses
interface LegacyValueBarChartProps {
  percentage: number;
  count: number;
  label: string;
  maxWidth?: number;
  height?: number;
  showPercentage?: boolean;
  className?: string;
}

export const LegacyValueBarChart: React.FC<LegacyValueBarChartProps> = ({
  percentage,
  count,
  label,
  maxWidth = 60,
  height = 4,
  showPercentage = true,
  className = ""
}) => {
  const barWidth = Math.max(1, (percentage / 100) * maxWidth);
  
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <div className="flex-1 min-w-0">
        <div className="text-xs text-[var(--vscode-descriptionForeground)] truncate">
          {label}
        </div>
        {showPercentage && (
          <div className="text-xs text-[var(--vscode-descriptionForeground)] mt-0.5">
            {count} rows ({percentage.toFixed(1)}%)
          </div>
        )}
      </div>
      <div 
        className="bg-[var(--vscode-widget-border)] rounded-sm relative overflow-hidden"
        style={{ width: maxWidth, height }}
      >
        <div 
          className="bg-[var(--vscode-button-background)] h-full rounded-sm transition-all duration-200"
          style={{ width: barWidth }}
        />
      </div>
    </div>
  );
};

interface CompactValueBarProps {
  percentage: number;
  count: number;
  maxWidth?: number;
  height?: number;
}

export const CompactValueBar: React.FC<CompactValueBarProps> = ({
  percentage,
  count,
  maxWidth = 40,
  height = 3,
}) => {
  const barWidth = Math.max(1, (percentage / 100) * maxWidth);
  
  return (
    <div className="flex items-center gap-1.5">
      <div 
        className="bg-[var(--vscode-widget-border)] rounded-sm relative overflow-hidden"
        style={{ width: maxWidth, height }}
      >
        <div 
          className="bg-[var(--vscode-button-background)] h-full rounded-sm"
          style={{ width: barWidth }}
        />
      </div>
      <div className="text-xs text-[var(--vscode-descriptionForeground)] whitespace-nowrap">
        {count} ({percentage.toFixed(1)}%)
      </div>
    </div>
  );
};