# ConceptualTextInput Component

A reusable text input component that provides the same @variable syntax support and autocomplete functionality as the main ConceptualStatements component.

## Features

- **@variable syntax**: Type `@` to trigger autocomplete for dataset variables
- **Predicate entities**: Support for `@Entity(@field.value)` syntax  
- **Chain syntax**: Support for `@tag[option1,option2,option3]` syntax
- **Visual pills**: Variables are rendered as colored pills when not actively editing
- **Enhanced autocomplete**: Full autocomplete with value suggestions and field filtering
- **VS Code theming**: Uses VS Code CSS variables for consistent theming

## Usage

```tsx
import { ConceptualTextInput } from '../ConceptualStatements/ConceptualTextInput';

function MyComponent() {
  const [text, setText] = useState('');
  
  return (
    <ConceptualTextInput
      value={text}
      onChange={setText}
      variables={variables}           // Array of {name, displayName, type}
      groups={groups}                // Optional: conceptual groups
      datasetData={datasetData}      // Optional: for value autocomplete
      profile={profile}              // Optional: dataset profile for suggestions
      placeholder="Type @ for variables..."
      className="w-full"
      minHeight="100px"
      disabled={false}
    />
  );
}
```

## Props

- `value: string` - Current text value
- `onChange: (value: string) => void` - Change handler
- `variables?: Variable[]` - Available variables for autocomplete
- `groups?: ConceptualGroup[]` - Optional variable groups
- `datasetData?: any[]` - Optional dataset for value suggestions
- `profile?: DatasetProfile` - Optional dataset profile
- `placeholder?: string` - Placeholder text
- `className?: string` - Additional CSS classes
- `minHeight?: string` - Minimum height (CSS value)
- `disabled?: boolean` - Whether input is disabled

## Integration with AnalysisNoteEditor

The component is now integrated into the AnalysisNoteEditor to provide full @variable syntax support for analysis notes, replacing the basic textarea with rich autocomplete functionality.