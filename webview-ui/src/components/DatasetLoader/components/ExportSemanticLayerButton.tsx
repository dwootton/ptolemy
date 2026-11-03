interface ExportSemanticLayerButtonProps {
  stateService?: any;
  disabled?: boolean;
}

export function ExportSemanticLayerButton({ stateService, disabled = false }: ExportSemanticLayerButtonProps) {
  const handleExport = async () => {
    if (!stateService) {
      console.warn('StateService not available for export');
      return;
    }
    
    try {
      await stateService.exportSemanticLayerYAML();
    } catch (error) {
      console.error('❌ Error exporting semantic layer:', error);
    }
  };

  return (
    <button
      onClick={handleExport}
      disabled={disabled}
      className={`
        px-3 py-1.5 text-xs rounded
        ${disabled 
          ? 'bg-gray-600 text-gray-400 cursor-not-allowed' 
          : 'bg-blue-400 text-white hover:bg-blue-500 active:bg-blue-600'
        }
        transition-colors duration-150
        font-medium
      `}
      title="Export semantic layer definitions to YAML file (DBT-style)"
    >
      📤 Export YAML
    </button>
  );
} 