export interface AutocompleteItem {
  type: 'variable' | 'entity' | 'field' | 'value' | 'predicate_template' | 'existing_entity' | 'quartile';
  label: string;
  insert: string;
  description?: string;
  count?: number;
}