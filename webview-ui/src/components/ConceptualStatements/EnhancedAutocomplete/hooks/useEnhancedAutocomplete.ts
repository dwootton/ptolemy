import { useState, useEffect } from 'react';
import { PredicateEntityService } from '../../../../services/PredicateEntityService';
import { DatasetValueExtractor, ColumnValueData } from '../../../../services/DatasetValueExtractor';
import type { DatasetProfile } from '../../../DatasetLoader/components/DatasetViewer';
import { AutocompleteItem } from '../types';

interface UseEnhancedAutocompleteProps {
  show: boolean;
  query: string;
  cursorPosition: number;
  availableFields: string[];
  datasetData: any[];
  profile?: DatasetProfile;
  entityService?: PredicateEntityService;
  isChainContext: boolean;
  chainTag?: string;
}

export function useEnhancedAutocomplete({
  show,
  query,
  cursorPosition,
  availableFields,
  datasetData,
  profile,
  entityService,
  isChainContext,
  chainTag
}: UseEnhancedAutocompleteProps) {
  const [items, setItems] = useState<AutocompleteItem[]>([]);
  const [valueData, setValueData] = useState<ColumnValueData[]>([]);
  const [showingValues, setShowingValues] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Initialize value extractor
  const [valueExtractor] = useState(() => new DatasetValueExtractor(datasetData));

  // Update value extractor when data changes
  useEffect(() => {
    valueExtractor.updateData(datasetData);
  }, [datasetData, valueExtractor]);

  useEffect(() => {
    if (!show) {
      setItems([]);
      setValueData([]);
      setShowingValues(false);
      return;
    }

    const autocompleteItems: AutocompleteItem[] = [];
    let columnValues: ColumnValueData[] = [];
    let isShowingValues = false;

    const safeQuery = query || '';
    // Handle chain context: we're inside @tag[...] brackets
    if (isChainContext && chainTag) {
      const parts = safeQuery.split('.');
      const currentOption = parts.length > 1 ? parts[1] : '';
      if (availableFields.includes(chainTag)) {
        const profileColumn = profile?.columns?.find(c => c.name === chainTag);
        if (profileColumn) {
          const isNumeric = profileColumn.dataType === 'number';
          if (isNumeric) {
            const stats = profileColumn.numericStats;
            if (stats) {
              const quartileOptions = [
                { key: 'q1', value: stats.q25, label: 'Q1 (25th percentile)' },
                { key: 'q2', value: stats.median, label: 'Q2 (Median)' },
                { key: 'q3', value: stats.q75, label: 'Q3 (75th percentile)' },
                { key: 'q4', value: stats.max, label: 'Q4 (Maximum)' },
              ].filter(option => !currentOption || option.key.toLowerCase().includes(currentOption.toLowerCase()));
              quartileOptions.forEach(option => {
                autocompleteItems.push({
                  type: 'quartile',
                  label: `${option.key} (${option.value})`,
                  insert: `${chainTag}.${option.key}`,
                  description: option.label,
                });
              });
            }
          }
          if (profileColumn.topValues && profileColumn.topValues.length > 0) {
            const values = (currentOption
              ? profileColumn.topValues.filter(tv => String(tv.value).toLowerCase().includes(currentOption.toLowerCase()))
              : profileColumn.topValues).slice(0, 20);
            columnValues = values.map(tv => ({
              value: tv.value,
              displayValue: String(tv.value),
              count: tv.count,
              percentage: tv.percentage ?? 0,
            })) as ColumnValueData[];
            isShowingValues = true;
          }
        } else if (datasetData.length > 0) {
          const isNumeric = valueExtractor.isNumericField(chainTag);

          if (isNumeric) {
            if (!currentOption || ['q1', 'q2', 'q3', 'q4'].some(q => q.startsWith(currentOption.toLowerCase()))) {
              const quartiles = valueExtractor.getQuartiles(chainTag);

              if (quartiles) {
                const quartileOptions = [
                  { key: 'q1', value: quartiles.q1, label: 'Q1 (25th percentile)' },
                  { key: 'q2', value: quartiles.q2, label: 'Q2 (Median)' },
                  { key: 'q3', value: quartiles.q3, label: 'Q3 (75th percentile)' },
                  { key: 'q4', value: quartiles.q4, label: 'Q4 (Maximum)' }
                ].filter(option =>
                  !currentOption || option.key.toLowerCase().includes(currentOption.toLowerCase())
                );

                quartileOptions.forEach(option => {
                  autocompleteItems.push({
                    type: 'quartile',
                    label: `${option.key} (${option.value})`,
                    insert: `${chainTag}.${option.key}`,
                    description: option.label
                  });
                });
              }
            }

            if (!currentOption || !['q1', 'q2', 'q3', 'q4'].some(q => q.startsWith(currentOption.toLowerCase()))) {
              const searchResults = currentOption
                ? valueExtractor.searchValues(chainTag, currentOption, 20)
                : valueExtractor.getTopValues(chainTag, 20);

              columnValues = searchResults;
              isShowingValues = true;
            }
          } else {
            const searchResults = currentOption
              ? valueExtractor.searchValues(chainTag, currentOption, 20)
              : valueExtractor.getTopValues(chainTag, 20);

            columnValues = searchResults;
            isShowingValues = true;
          }
        }
      }
    } else {
      // Regular autocomplete logic (not in chain context)
      const valueCompletionMatch = safeQuery.match(/^([\w]+)\.(.*)$/);
      if (valueCompletionMatch) {
        const fieldName = valueCompletionMatch[1];
        const valueQuery = valueCompletionMatch[2] || '';
        if (availableFields.includes(fieldName)) {
          const profileColumn = profile?.columns?.find(c => c.name === fieldName);
          if (profileColumn) {
            // Prefer quartiles for numeric columns when query starts with 'q' or is empty after dot
            if (profileColumn.numericStats && (!valueQuery || valueQuery.toLowerCase().startsWith('q'))) {
              const extractor = valueExtractor;
              const ranges = extractor.getQuartileRanges(fieldName);
              if (ranges) {
                const mapped = ranges.ranges
                  .filter(r => !valueQuery || r.key.startsWith(valueQuery.toLowerCase()))
                  .map(r => ({
                    key: r.key,
                    label: `${r.key.toUpperCase()} [${r.start} – ${r.end}]`,
                    insert: `${fieldName}.${r.key}`,
                    description: `${r.count} rows (${r.percentage.toFixed(1)}%)`
                  }));
                mapped.forEach(option => {
                  autocompleteItems.push({
                    type: 'quartile',
                    label: option.label,
                    insert: option.insert,
                    description: option.description
                  });
                });
                isShowingValues = false;
              }
            }
            if (!profileColumn.numericStats && profileColumn.topValues && profileColumn.topValues.length > 0) {
              const values = (valueQuery
                ? profileColumn.topValues.filter(tv => String(tv.value).toLowerCase().includes(valueQuery.toLowerCase()))
                : profileColumn.topValues).slice(0, 20);
              columnValues = values.map(tv => ({
                value: tv.value,
                displayValue: String(tv.value),
                count: tv.count,
                percentage: tv.percentage ?? 0,
              })) as ColumnValueData[];
              isShowingValues = true;
            }
          } else if (datasetData.length > 0) {
            const isNumeric = valueExtractor.isNumericField(fieldName);
            if (isNumeric) {
              if (!valueQuery || valueQuery.toLowerCase().startsWith('q')) {
                const ranges = valueExtractor.getQuartileRanges(fieldName);
                if (ranges) {
                  const mapped = ranges.ranges
                    .filter(r => !valueQuery || r.key.startsWith(valueQuery.toLowerCase()))
                    .map(r => ({
                      key: r.key,
                      label: `${r.key.toUpperCase()} [${r.start} – ${r.end}]`,
                      insert: `${fieldName}.${r.key}`,
                      description: `${r.count} rows (${r.percentage.toFixed(1)}%)`
                    }));
                  mapped.forEach(option => {
                    autocompleteItems.push({
                      type: 'quartile',
                      label: option.label,
                      insert: option.insert,
                      description: option.description
                    });
                  });
                  isShowingValues = false;
                }
              } else {
                const searchResults = valueExtractor.searchValues(fieldName, valueQuery, 20);
                columnValues = searchResults;
                isShowingValues = true;
              }
            } else {
              const searchResults = valueQuery
                ? valueExtractor.searchValues(fieldName, valueQuery, 20)
                : valueExtractor.getTopValues(fieldName, 20);
              columnValues = searchResults;
              isShowingValues = true;
            }
          }
        } else if (entityService && entityService.hasEntity(fieldName)) {
          const entity = entityService.getEntity(fieldName);
          if (entity) {
            const filterPredicates = entity.predicates.map(p => ({ field: p.field, value: p.value }));
            const searchResults = valueQuery
              ? valueExtractor.searchValuesWithFilter(fieldName, valueQuery, filterPredicates, 20)
              : valueExtractor.getTopValuesWithFilter(fieldName, filterPredicates, 20);

            columnValues = searchResults;
            isShowingValues = true;
          }
        }
      }

      // Rest of the autocomplete logic for non-value completion cases...
      if (!isShowingValues) {
        const predicateMatch = safeQuery.match(/@(\w+)\(([^)]*)/);

        if (predicateMatch) {
          const entityName = predicateMatch[1];
          const insideParens = predicateMatch[2] || '';

          const fieldMatch = insideParens.match(/@(\w+)\.(\w*)$/);

          if (fieldMatch) {
            const fieldName = fieldMatch[1];
            const valueQuery = fieldMatch[2] || '';

            if (entityService) {
              const profileColumn = profile?.columns?.find(c => c.name === fieldName);
              if (profileColumn && profileColumn.topValues && profileColumn.topValues.length > 0) {
                profileColumn.topValues.forEach(tv => {
                  const valueStr = String(tv.value);
                  if (valueStr.toLowerCase().includes(valueQuery.toLowerCase())) {
                    const needsBrackets = valueStr.includes(' ');
                    const insertValue = needsBrackets ? `${fieldName}.[${valueStr}]` : `${fieldName}.${valueStr}`;
                    autocompleteItems.push({
                      type: 'value',
                      label: valueStr,
                      insert: insertValue,
                      description: `${tv.count} rows (${(tv.percentage ?? 0).toFixed(1)}%)`,
                      count: tv.count,
                    });
                  }
                });
              } else if (datasetData.length > 0) {
                if (entityService.hasEntity(entityName)) {
                  const fieldData = entityService.getFieldData(entityName, fieldName);

                  fieldData.values.forEach(({ value, count, percentage }) => {
                    const valueStr = String(value);
                    if (valueStr.toLowerCase().includes(valueQuery.toLowerCase())) {
                      const needsBrackets = valueStr.includes(' ');
                      const insertValue = needsBrackets ? `${fieldName}.[${valueStr}]` : `${fieldName}.${valueStr}`;

                      autocompleteItems.push({
                        type: 'value',
                        label: valueStr,
                        insert: insertValue,
                        description: `${count} rows (${percentage.toFixed(1)}%)`,
                        count
                      });
                    }
                  });
                } else {
                  const valueCounts = new Map<any, number>();
                  datasetData.forEach(row => {
                    const value = row[fieldName];
                    if (value !== undefined && value !== null) {
                      const count = valueCounts.get(value) || 0;
                      valueCounts.set(value, count + 1);
                    }
                  });

                  Array.from(valueCounts.entries())
                    .sort(([,a], [,b]) => b - a)
                    .forEach(([value, count]) => {
                      const valueStr = String(value);
                      if (valueStr.toLowerCase().includes(valueQuery.toLowerCase())) {
                        const needsBrackets = valueStr.includes(' ');
                        const insertValue = needsBrackets ? `${fieldName}.[${valueStr}]` : `${fieldName}.${valueStr}`;
                        const percentage = (count / datasetData.length) * 100;

                        autocompleteItems.push({
                          type: 'value',
                          label: valueStr,
                          insert: insertValue,
                          description: `${count} rows (${percentage.toFixed(1)}%)`,
                          count
                        });
                      }
                    });
                }
              }
            }
          } else {
            availableFields.forEach(field => {
              const safeField = field || '';
              if (safeField.toLowerCase().includes(insideParens.toLowerCase())) {
                autocompleteItems.push({
                  type: 'field',
                  label: safeField,
                  insert: `@${safeField}.`,
                  description: `Filter by ${safeField}`
                });
              }
            });
          }
        } else if (safeQuery.startsWith('@') && !safeQuery.includes('(')) {
          const entityName = safeQuery.slice(1);

          if (entityService) {
            entityService.getAllEntities().forEach(entity => {
              const safeEntityName = entity.name || '';
              if (safeEntityName.toLowerCase().includes(entityName.toLowerCase())) {
                const stats = entityService.getEntityStats(entity.name);
                autocompleteItems.push({
                  type: 'existing_entity',
                  label: safeEntityName,
                  insert: `@${safeEntityName}`,
                  description: `${stats.totalRows} rows (${stats.percentageOfDataset.toFixed(1)}%)`
                });
              }
            });
          }

          availableFields.forEach(field => {
            const safeField = field || '';
            if (entityName === '' || safeField.toLowerCase().includes(entityName.toLowerCase())) {
              autocompleteItems.push({
                type: 'predicate_template',
                label: `${entityName || 'Entity'}(@${safeField}.value)`,
                insert: `@${entityName || 'Entity'}(@${safeField}.`,
                description: `Create entity filtered by ${safeField}`
              });
            }
          });

          availableFields.forEach(field => {
            const safeField = field || '';
            if (safeField.toLowerCase().includes(entityName.toLowerCase())) {
              autocompleteItems.push({
                type: 'variable',
                label: safeField,
                insert: `@${safeField}`,
                description: `Reference ${safeField} variable`
              });
            }
          });
        } else {
          availableFields.forEach(field => {
            const safeField = field || '';
            if (safeQuery === '' || safeField.toLowerCase().includes(safeQuery.toLowerCase())) {
              autocompleteItems.push({
                type: 'variable',
                label: safeField,
                insert: `@${safeField}`,
                description: `Reference ${safeField} variable`
              });
            }
          });

          if (safeQuery === '' || 'df'.includes(safeQuery.toLowerCase())) {
            availableFields.forEach(field => {
              const safeField = field || '';
              autocompleteItems.push({
                type: 'predicate_template',
                label: `df.${safeField}`,
                insert: `@df.${safeField}.`,
                description: `Access ${safeField} values directly`
              });
            });
          }
        }

        if (safeQuery.includes('.') && !safeQuery.includes('(') && !isShowingValues) {
          const dotIndex = safeQuery.lastIndexOf('.');
          const beforeDot = safeQuery.slice(0, dotIndex) || '';
          const afterDot = safeQuery.slice(dotIndex + 1) || '';

          if (beforeDot.startsWith('@')) {
            const entityName = beforeDot.slice(1);

            availableFields.forEach(field => {
              const safeField = field || '';
              if (safeField.toLowerCase().includes(afterDot.toLowerCase())) {
                autocompleteItems.push({
                  type: 'field',
                  label: safeField,
                  insert: `${entityName}.${safeField}`,
                  description: `${entityName}.${safeField}`
                });
              }
            });
          }
        }

        if (!isShowingValues && autocompleteItems.length === 0 && safeQuery.length > 1) {
          autocompleteItems.push({
            type: 'variable',
            label: 'No results found',
            insert: '',
            description: 'Try a different search term'
          });

          if (safeQuery.startsWith('@') && !safeQuery.includes('(') && !safeQuery.includes('.')) {
            const entityName = safeQuery.slice(1);
            if (entityName.length > 0) {
              autocompleteItems.push({
                type: 'predicate_template',
                label: `Create "${entityName}" entity`,
                insert: `@${entityName}(@`,
                description: 'Create a new filtered entity'
              });
            }
          }
        }
      }
    }


    setItems(autocompleteItems);
    setValueData(columnValues);
    setShowingValues(isShowingValues);
    setSelectedIndex(0);
  }, [show, query, cursorPosition, availableFields, datasetData, entityService, valueExtractor, isChainContext, chainTag, profile]);

  const handleKeyDown = (totalItems: number, onSelect: (item: any) => void, onClose: () => void) => {
    return (e: React.KeyboardEvent) => {
      if (!show || totalItems === 0) return;

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex(prev => Math.min(prev + 1, totalItems - 1));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex(prev => Math.max(prev - 1, 0));
          break;
        case 'Enter':
        case 'Tab':
          e.preventDefault();
          if (showingValues && valueData[selectedIndex]) {
            handleValueSelect(valueData[selectedIndex], onSelect, onClose);
          } else if (!showingValues && items[selectedIndex]) {
            onSelect(items[selectedIndex]);
            onClose();
          }
          break;
        case 'Escape':
          onClose();
          break;
      }
    };
  };

  const handleValueSelect = (valueInfo: ColumnValueData, onSelect: (item: any) => void, onClose: () => void) => {
    const needsBrackets = String(valueInfo.value).includes(' ');
    const insertValue = needsBrackets ? `[${valueInfo.value}]` : String(valueInfo.value);

    const mockItem: any = {
      type: 'value',
      label: valueInfo.displayValue,
      insert: insertValue,
      description: `${valueInfo.count} rows (${valueInfo.percentage.toFixed(1)}%)`
    };

    onSelect(mockItem);
    onClose();
  };

  return {
    items,
    valueData,
    showingValues,
    selectedIndex,
    setSelectedIndex,
    handleKeyDown,
    handleValueSelect,
    shouldRender: show && (items.length > 0 || valueData.length > 0)
  };
}
