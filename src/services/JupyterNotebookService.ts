import * as vscode from 'vscode';
import { Analet } from '../types/analet';
import { NewOpenAIService } from './llm/NewOpenAIService';
import { GENERATE_AI_NOTEBOOKS } from '../constants';
import { PythonCodeResponseSchema, PythonCodeResponseSchemaType, StringResponseSchema, type StringResponseSchemaType } from '../schemas/analet';
import { DatasetSummarizerService } from './DatasetSummarizerService';
import * as path from 'path';

export interface JupyterNotebook {
  cells: JupyterCell[];
  metadata: JupyterMetadata;
  nbformat: number;
  nbformat_minor: number;
}

export interface MeridianCellMetadata {
  type: 'analet' | 'non-analet';
  id?: number;
  statement?: string;
  cellQL?: string;
  cellIndex?: number;
  lastModified?: string;
}

export interface JupyterCell {
  cell_type: 'code' | 'markdown' | 'raw';
  source: string[];
  id?: string;  // Cell ID for tracking
  metadata?: {
    meridian_analet?: MeridianCellMetadata;
    [key: string]: any;
  };
  execution_count?: number | null;
  outputs?: any[];
}

export interface JupyterMetadata {
  kernelspec: {
    display_name: string;
    language: string;
    name: string;
  };
  language_info: {
    name: string;
    version: string;
  };
  meridian_analet?: {
    id: number;
    statement: string;
    cellQL: string;
  };
}

export class JupyterNotebookService {
  private static instance: JupyterNotebookService;
  private openAIService: NewOpenAIService | null = null;

  private constructor() {}

  public static getInstance(apiKey?: string): JupyterNotebookService {
    if (!JupyterNotebookService.instance) {
      JupyterNotebookService.instance = new JupyterNotebookService();
    }

    // Always try to initialize the OpenAI service if not already set
    if (!JupyterNotebookService.instance.openAIService) {
      try {
        JupyterNotebookService.instance.openAIService = NewOpenAIService.getInstance();
      } catch (error) {
      }
    }

    return JupyterNotebookService.instance;
  }

  /**
   * Create cell metadata for analet cells
   */
  private createAnaletCellMetadata(analet: Analet, cellIndex: number): any {
    return {
      meridian_analet: {
        type: 'analet' as const,
        id: analet.id,
        statement: analet.statement,
        cellQL: analet.cellQL,
        cellIndex: cellIndex,
        lastModified: new Date().toISOString()
      }
    };
  }

  /**
   * Create cell metadata for non-analet cells (markdown, imports, etc.)
   */
  private createNonAnaletCellMetadata(): any {
    return {
      meridian_analet: {
        type: 'non-analet' as const
      }
    };
  }

  /**
   * Generate a unique cell ID
   */
  private generateCellId(): string {
    return `cell-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  public async generateNotebookFromAnalet(analet: Analet, useAI: boolean = true, startTime?: number): Promise<JupyterNotebook> {
    const jupyterStartTime = Date.now();
    const cells: JupyterCell[] = [];
    let cellIndex = 0;

    // Title cell - markdown (non-analet)
    const titleSource = analet.shortName && analet.shortName !== analet.statement
      ? [`# ${analet.shortName}\n`, `\n`, `${analet.statement}\n`]
      : [`# ${analet.statement}\n`];

    cells.push({
      cell_type: 'markdown',
      source: titleSource,
      id: this.generateCellId(),
      metadata: this.createNonAnaletCellMetadata()
    });

    // No separate formal grammar cell: keep grammar only in notebook metadata
    const aiImplementation = await this.generateAIImplementation(analet, cellIndex, startTime);
    cells.push(...aiImplementation);

    // // Determine if we should generate AI content based on flag and API availability
    // const shouldGenerateAI = GENERATE_AI_NOTEBOOKS && useAI && this.openAIService;

    // if (shouldGenerateAI) {
    //   try {
    //     console.log('Generating AI-powered notebook content...');
    //     const aiImplementation = await this.generateAIImplementation(analet, cellIndex);
    //     cells.push(...aiImplementation);
    //   } catch (error) {
    //     console.error('Failed to generate AI implementation, falling back to mock template:', error);
    //     cells.push(...this.generateEnhancedMockImplementation(analet, cellIndex));
    //   }
    // } else {
    //   console.log(`Generating mock notebook content (GENERATE_AI_NOTEBOOKS=${GENERATE_AI_NOTEBOOKS}, useAI=${useAI}, hasOpenAI=${!!this.openAIService})`);
    //   cells.push(...this.generateEnhancedMockImplementation(analet, cellIndex));
    // }
    return {
      cells,
      metadata: {
        kernelspec: {
          display_name: "Python 3",
          language: "python",
          name: "python3"
        },
        language_info: {
          name: "python",
          version: "3.8.0"
        },
        meridian_analet: {
          id: analet.id,
          statement: analet.statement,
          cellQL: analet.cellQL || '',
        }
      },
      nbformat: 4,
      nbformat_minor: 4
    };
  }

  private async generateAIImplementation(analet: Analet, startCellIndex: number, startTime?: number): Promise<JupyterCell[]> {
    const aiStartTime = Date.now();
    const cells: JupyterCell[] = [];

    if(!this.openAIService) {
      throw new Error('OpenAI service not available');
    }

    // Build context-aware prompt
    const prompt = this.buildAnalysisPrompt(analet);
    try {
      const result = await this.openAIService.chatStructured({
        system: 'You are a Python data analysis expert. Generate clean, executable Python code.',
        user: prompt,
        schema: PythonCodeResponseSchema,
        model: 'gpt-4.1-mini'
      });
      const response = result && 'python_code' in result ?
        result.python_code :
        '';


      // Parse AI response into executable code
      const codeBlocks = this.parseAIResponse(response);
      // Add proper metadata to each cell
      const cellsWithMetadata = this.addAnaletMetadataToCells(codeBlocks, analet, startCellIndex);
      cells.push(...cellsWithMetadata);

    } catch (error) {
      return this.generateEnhancedMockImplementation(analet, startCellIndex);
    }
    return cells;
  }

  private buildAnalysisPrompt(analet: Analet): string {
    let prompt = `Generate Python code for this analysis based on the CellQL specification below.\n\n`;
    prompt += `Question: ${analet.statement}\n\n`;

    if (analet.cellQL) {
      prompt += `CellQL:\n${analet.cellQL}\n\n`;
    }

    if (analet.explanation) {
      prompt += `Context: ${analet.explanation}\n\n`;
    }


    // Get actual dataset information
    let datasetInfo = '';
    try {
      const summarizerService = this.getDatasetSummarizerService();
      if (summarizerService) {
        const dataset = summarizerService.getDatasetInfo();
        if (dataset) {
          const notebookRelativePath = this.getNotebookRelativeDatasetPath();
          datasetInfo = `\nDATASET INFORMATION:\n- File Path: ${notebookRelativePath}\n- Dataset Name: ${dataset.name}\n- Columns: ${dataset.columns?.join(', ') || 'Unknown'}\n- Rows: ${dataset.rowCount || 'Unknown'}\n\nCRITICAL: Use the ACTUAL dataset file path above. DO NOT create fake or sample data.\n\n`;
        }
      }
    } catch (error) {
    }

    prompt += datasetInfo;

    prompt += `CRITICAL: Return ONLY PYTHON CODE BELOW. NO explanatory text, NO "Certainly", NO "Here are", NO additional comments.

IMPORTANT: The dataframe will be provided to you in a variable called 'df' which contains the dataset. You do NOT need to import pandas or load the CSV file - these will be handled automatically. Just use the 'df' variable directly in your analysis.

Return exactly this JSON format:
{
  "python_code": "# Analysis code here\\nresult = df.describe()\\nprint(result)\\n# Add your analysis logic using df variable",
}

Requirements:
- python_code: Write analysis code that uses the 'df' variable (dataframe is already loaded)
- DO NOT include 'import pandas as pd' or 'df = pd.read_csv()' - these are handled automatically
- Use the 'df' variable directly for all dataframe operations
- ${datasetInfo ? 'Use the ACTUAL dataset columns provided above - do not create fake data' : 'Write general analysis code using df variable'}
- Use \\n for line breaks in JSON strings
- All comments must start with # symbol
- No text outside the JSON structure
- Each cell 3-8 lines maximum
- Focus on one key insight from the ACTUAL data

RETURN ONLY THE JSON STRUCTURE ABOVE WITH YOUR CODE.`;

    return prompt;
  }

  /**
   * Inject pandas import and DataFrame assignment into code lines
   * @param codeLines Original code lines from AI response
   * @returns Modified code lines with pandas setup injected
   */
  private injectDataFrameSetup(codeLines: string[]): string[] {
    // Track if we've already added pandas import or df assignment
    let hasPandasImport = false;
    let hasDataFrameAssignment = false;

    // First pass: check if pandas import or df assignment already exists
    for (const line of codeLines) {
      const trimmedLine = line.trim();
      // Check for various forms of pandas import
      if (trimmedLine.startsWith('import pandas') ||
          trimmedLine.includes('import pandas as pd') ||
          trimmedLine === 'import pandas' ||
          (trimmedLine.startsWith('from pandas') && trimmedLine.includes('import'))) {
        hasPandasImport = true;
      }
      // Check for df assignment
      if (trimmedLine.startsWith('df = pd.read_csv') ||
          trimmedLine.includes('df = pd.read_csv') ||
          trimmedLine.startsWith('df=pd.read_csv')) {
        hasDataFrameAssignment = true;
      }
    }

    // If both are present, return original lines
    if (hasPandasImport && hasDataFrameAssignment) {
      return codeLines;
    }

    // Find insertion point: after existing imports or at the beginning
    let insertionIndex = 0;

    for (let i = 0; i < codeLines.length; i++) {
      const trimmedLine = codeLines[i].trim();

      // Skip empty lines and comments
      if (trimmedLine === '' || trimmedLine.startsWith('#')) {
        continue;
      }

      // Check if this is an import line
      if (trimmedLine.startsWith('import ') || trimmedLine.startsWith('from ')) {
        insertionIndex = i + 1; // Insert after this import
      } else {
        // First non-import line found
        break;
      }
    }

    // Build setup lines to inject
    const setupLines: string[] = [];

    if (!hasPandasImport) {
      setupLines.push('import pandas as pd');
    }

    if (!hasDataFrameAssignment) {
      // Get dataset path relative to the notebook location (study folders supported)
      try {
        const csvPath = this.getNotebookRelativeDatasetPath();
        setupLines.push(`df = pd.read_csv('${csvPath}')`);
      } catch (error) {
        // Fallback to a generic filename in the working directory
        setupLines.push(`df = pd.read_csv('./dataset.csv')`);
      }
    }

    // Add empty line for readability if we added setup code
    if (setupLines.length > 0) {
      setupLines.push('');
    }

    // Insert setup lines at the correct position
    const result = [
      ...codeLines.slice(0, insertionIndex),
      ...setupLines,
      ...codeLines.slice(insertionIndex)
    ];

    return result;
  }

  private parseAIResponse(response: string): JupyterCell[] {

    const pythonCode = response;
    if(!pythonCode) {
      throw new Error('No Python code generated!');
    }

    // Split code into lines and inject pandas imports and df assignment
    const processedLines = this.injectDataFrameSetup(pythonCode.split('\n'));

    return [
      {
        cell_type: 'code',
        source: processedLines,
        id: this.generateCellId(),
        metadata: {},
        execution_count: null,
        outputs: []
      }
    ]

    // try {
    //   // Clean up the response - remove any markdown formatting and extra text
    //   let cleanResponse = response.trim();
    //   console.log('🔍 [JupyterNotebook] AI response:', cleanResponse);

    //   // Remove any explanatory text before JSON
    //   const jsonStart = cleanResponse.indexOf('{');
    //   const jsonEnd = cleanResponse.lastIndexOf('}');

    //   if (jsonStart === -1 || jsonEnd === -1) {
    //     console.warn('No JSON structure found in AI response, using fallback');
    //               return this.generateEnhancedMockImplementation({ question: 'Invalid response format' } as any, 0);
    //   }

    //   const jsonStr = cleanResponse.substring(jsonStart, jsonEnd + 1);
    //   const parsed = JSON.parse(jsonStr);

    //   // Validate the expected structure
    //   if (!parsed.cell1 || !parsed.cell2) {
    //     console.warn('Invalid JSON structure - missing cell1 or cell2');
    //               return this.generateEnhancedMockImplementation({ question: 'Invalid cell structure' } as any, 0);
    //   }

    //   // Create Cell 1 - Setup and data
    //   const cell1Code = parsed.cell1.replace(/\\n/g, '\n');
    //   const cell1Lines = cell1Code.split('\n');
    //   // Preserve whitespace and empty lines for proper formatting

    //   if (cell1Lines.length > 0) {
    //     cells.push({
    //       cell_type: 'code',
    //       source: cell1Lines.map((line: string) => line + '\n'),
    //       metadata: {},
    //       execution_count: null,
    //       outputs: []
    //     });
    //   }

    //   // Create Cell 2 - Analysis and results
    //   const cell2Code = parsed.cell2.replace(/\\n/g, '\n');
    //   const cell2Lines = cell2Code.split('\n');
    //   // Preserve whitespace and empty lines for proper formatting

    //   if (cell2Lines.length > 0) {
    //     cells.push({
    //       cell_type: 'code',
    //       source: cell2Lines.map((line: string) => line + '\n'),
    //       metadata: {},
    //       execution_count: null,
    //       outputs: []
    //     });
    //   }

    //   // Ensure we have at least one cell
    //   if (cells.length === 0) {
    //     return this.generateEnhancedMockImplementation({ question: 'Empty cells' } as any, 0);
    //   }

    //   return cells;

    // } catch (error) {
    //   console.error('Error parsing AI response JSON:', error);
    //   console.log('Response was:', response);

    //   // Fallback to the old parsing method if JSON parsing fails
    //           return this.generateEnhancedMockImplementation({ question: 'JSON parsing failed' } as any, 0);
    // }
  }

  private addAnaletMetadataToCells(cells: JupyterCell[], analet: Analet, startCellIndex: number): JupyterCell[] {
    return cells.map((cell, index) => ({
      ...cell,
      metadata: this.createAnaletCellMetadata(analet, startCellIndex + index)
    }));
  }

  private generateEnhancedMockImplementation(analet: Analet, startCellIndex: number): JupyterCell[] {
    const cells: JupyterCell[] = [];
    let cellIndex = startCellIndex;
    const datasetName = (this.getDatasetSummarizerService()?.getDatasetInfo()?.name) || 'dataset';
    const datasetPath = (() => { try { return this.getNotebookRelativeDatasetPath(); } catch { return `./${datasetName}.csv`; } })();

    // Analysis explanation cell (non-analet markdown)
    cells.push({
      cell_type: 'markdown',
      source: [
        `## Analysis Overview\n`,
        `\n`,
        `This is a mock notebook template for: **${analet.statement}**\n`,
        `\n`,
        `**CellQL**: \`${analet.cellQL || 'Not specified'}\`\n`,
        `\n`,
        `\n`,
        `*Note: This is a template notebook. To generate AI-powered content, set GENERATE_AI_NOTEBOOKS = true and provide an OpenAI API key.*\n`
      ],
      id: this.generateCellId(),
      metadata: this.createNonAnaletCellMetadata()
    });

    // Setup and imports cell (non-analet imports)
    cells.push({
      cell_type: 'code',
      source: [
        `# Setup and imports\n`,
        `import pandas as pd\n`,
        `import numpy as np\n`,
        `import matplotlib.pyplot as plt\n`,
        `import seaborn as sns\n`,
        `from datetime import datetime, timedelta\n`,
        `\n`,
        `# Load dataset\n`,
        `df = pd.read_csv('${datasetPath}')\n`,
        `\n`,
        `# Set display options\n`,
        `pd.set_option('display.max_columns', None)\n`,
        `plt.style.use('seaborn-v0_8')\n`,
        `\n`,
        `print("Environment setup complete")\n`,
        `print(f"Dataset shape: {df.shape}")\n`
      ],
      id: this.generateCellId(),
      metadata: this.createNonAnaletCellMetadata(),
      execution_count: null,
      outputs: []
    });

    // Data exploration cell (analet analysis)
    cells.push({
      cell_type: 'code',
      source: [
        `# Data exploration\n`,
        `print("Dataset Overview:")\n`,
        `print(f"Shape: {df.shape}")\n`,
        `print("\\nColumns:", df.columns.tolist())\n`,
        `print("\\nFirst few rows:")\n`,
        `print(df.head())\n`,
        `print("\\nData types:")\n`,
        `print(df.dtypes)\n`,
        `print("\\nBasic statistics:")\n`,
        `print(df.describe())\n`
      ],
      id: this.generateCellId(),
      metadata: this.createAnaletCellMetadata(analet, cellIndex++),
      execution_count: null,
      outputs: []
    });

    // Analysis template cell (analet analysis)
    cells.push({
      cell_type: 'code',
      source: [
        `# Analysis implementation\n`,
        `# TODO: Replace this template with actual analysis logic\n`,
        `\n`,
        `print(f"Analysis Question: {analet.statement}")\n`,
        `print("=" * 50)\n`,
        `\n`,
        `# Basic descriptive statistics\n`,
        `print("Data Shape:", df.shape)\n`,
        `print("\\nData Info:")\n`,
        `print(df.info())\n`,
        `\n`,
        `print("\\nDescriptive Statistics:")\n`,
        `print(df.describe())\n`,
        `\n`,
        `# TODO: Implement specific analysis based on CellQL\n`,
        `# CellQL: ${analet.cellQL || 'Add specific analysis logic'}\n`
      ],
      id: this.generateCellId(),
      metadata: this.createAnaletCellMetadata(analet, cellIndex++),
      execution_count: null,
      outputs: []
    });

    // Visualization template cell
    cells.push({
      cell_type: 'code',
      source: [
        `# Visualization\n`,
        `# TODO: Create visualizations relevant to the analysis question\n`,
        `\n`,
        `fig, axes = plt.subplots(2, 2, figsize=(12, 10))\n`,
        `fig.suptitle(f"Analysis: {analet.statement}", fontsize=14, fontweight='bold')\n`,
        `\n`,
        `# Sample visualizations (replace with relevant plots)\n`,
        `# Plot 1: Distribution\n`,
        `if 'value' in df.columns:\n`,
        `    axes[0, 0].hist(df['value'], bins=20, alpha=0.7)\n`,
        `    axes[0, 0].set_title('Value Distribution')\n`,
        `\n`,
        `# Plot 2: Time series or scatter\n`,
        `if len(df.columns) >= 2:\n`,
        `    axes[0, 1].scatter(df.iloc[:, 0], df.iloc[:, 1], alpha=0.6)\n`,
        `    axes[0, 1].set_title('Relationship Plot')\n`,
        `\n`,
        `# Plot 3: Box plot\n`,
        `if 'category' in df.columns and 'value' in df.columns:\n`,
        `    df.boxplot(column='value', by='category', ax=axes[1, 0])\n`,
        `    axes[1, 0].set_title('Value by Category')\n`,
        `\n`,
        `# Plot 4: Additional analysis plot\n`,
        `axes[1, 1].text(0.1, 0.5, 'TODO: Add specific\\nvisualization based on\\nanalysis requirements', \n`,
        `               transform=axes[1, 1].transAxes, fontsize=12, verticalalignment='center')\n`,
        `axes[1, 1].set_title('Custom Analysis Plot')\n`,
        `\n`,
        `plt.tight_layout()\n`,
        `plt.show()\n`
      ],
      id: this.generateCellId(),
      metadata: this.createAnaletCellMetadata(analet, cellIndex++),
      execution_count: null,
      outputs: []
    });

    // Results and conclusions cell (non-analet markdown)
    cells.push({
      cell_type: 'markdown',
      source: [
        `## Results & Conclusions\n`,
        `\n`,
        `### Key Findings\n`,
        `- *TODO: Add key findings from the analysis*\n`,
        `- *TODO: Include statistical results or patterns discovered*\n`,
        `- *TODO: Note any limitations or assumptions*\n`,
        `\n`,
        `### Next Steps\n`,
        `1. **Data Validation**: Verify data quality and completeness\n`,
        `2. **Statistical Testing**: Apply appropriate statistical tests\n`,
        `3. **Model Validation**: If applicable, validate any models used\n`,
        `4. **Interpretation**: Provide business or research context\n`,
        `\n`,
        `### Technical Notes\n`,
        `- **Formal Grammar**: \`${analet.cellQL || 'Define analysis logic'}\`\n`,
        `- **Generated**: ${new Date().toISOString()}\n`,
        `- **Template Version**: Mock v1.0\n`
      ],
      id: this.generateCellId(),
      metadata: this.createNonAnaletCellMetadata()
    });

    return cells;
  }

  private generateContextualDataCode(analet: Analet): string[] {
    // Try to get actual dataset from DatasetSummarizerService
    try {
      const summarizerService = this.getDatasetSummarizerService();
      if (summarizerService) {
        const datasetInfo = summarizerService.getDatasetInfo();
        if (datasetInfo && datasetInfo.columns && datasetInfo.columns.length > 0) {
          return this.generateActualDatasetCode(datasetInfo);
        }
      }

      return this.generateGenericDataCode(analet);
    } catch (error) {
      return this.generateGenericDataCode(analet);
    }
  }

  private getDatasetSummarizerService() {
    try {
      return DatasetSummarizerService.getInstance();
    } catch (error) {
      return null;
    }
  }

  private generateActualDatasetCode(datasetInfo: any): string[] {
    const columns = datasetInfo.columns || [];
    const rowCount = datasetInfo.rowCount || 0;
    const datasetName = datasetInfo.name || 'dataset';
    const filePath = datasetInfo.filePath;

    if (filePath) {
      // Use workspace/study-relative path to the dataset (same folder as notebooks when possible)
      const notebookRelativePath = this.getNotebookRelativeDatasetPath();

      return [
        `# Load the actual dataset\n`,
        `# Dataset: ${datasetName}\n`,
        `# File: ${notebookRelativePath}\n`,
        `# Columns: ${columns.join(', ')}\n`,
        `# Rows: ${rowCount}\n`,
        `\n`,
        `import pandas as pd\n`,
        `import numpy as np\n`,
        `import matplotlib.pyplot as plt\n`,
        `import seaborn as sns\n`,
        `\n`,
        `# Load the actual dataset file\n`,
        `df = pd.read_csv("${notebookRelativePath}")\n`,
        `\n`,
        `print(f"Dataset loaded: ${datasetName}")\n`,
        `print(f"Shape: {df.shape}")\n`,
        `print(f"Columns: {list(df.columns)}")\n`,
        `print("\\nFirst few rows:")\n`,
        `print(df.head())\n`,
        `print("\\nData types:")\n`,
        `print(df.dtypes)\n`,
        `print("\\nBasic statistics:")\n`,
        `print(df.describe())\n`
      ];
    } else {
      // Fallback to using the in-memory data if no file path
      return [
        `# Load dataset from memory\n`,
        `# Dataset: ${datasetName}\n`,
        `# Columns: ${columns.join(', ')}\n`,
        `# Rows: ${rowCount}\n`,
        `\n`,
        `import pandas as pd\n`,
        `import numpy as np\n`,
        `import matplotlib.pyplot as plt\n`,
        `import seaborn as sns\n`,
        `\n`,
        `# Note: Dataset loaded from memory, not from file\n`,
        `# In a real scenario, you would use pd.read_csv("your_file.csv")\n`,
        `\n`,
        `# Dataset structure:\n`,
        `column_names = ${JSON.stringify(columns)}\n`,
        `print(f"Dataset: ${datasetName}")\n`,
        `print(f"Columns ({columns.length}): {column_names}")\n`,
        `print(f"Rows: ${rowCount}")\n`,
        `\n`,
        `# To work with this dataset, you would typically:\n`,
        `# df = pd.read_csv("./${datasetName}.csv")\n`,
        `# print(df.head())\n`,
        `# print(df.info())\n`,
        `# print(df.describe())\n`
      ];
    }
  }

  /**
   * Resolve the dataset CSV path relative to where notebooks execute.
   * - If a concrete dataset filePath is known, return './<basename>.csv'
   * - Otherwise, fall back to './.meridian/datasets/<name>.csv'
   */
  private getNotebookRelativeDatasetPath(): string {
    const summarizerService = this.getDatasetSummarizerService();
    const info = summarizerService?.getDatasetInfo();
    const name = info?.name || 'dataset';
    try {
      const abs = info?.filePath;
      if (abs && typeof abs === 'string') {
        const base = path.basename(abs);
        return `./${base}`;
      }
    } catch {}
    return `./.meridian/datasets/${name}.csv`;
  }

  private generateGenericDataCode(analet: Analet): string[] {
    const question = analet.statement.toLowerCase();
    const context = question;

    if (context.includes('time') || context.includes('trend') || context.includes('temporal')) {
      return [
        `# Generate sample time series data\n`,
        `np.random.seed(42)\n`,
        `\n`,
        `# Create date range\n`,
        `dates = pd.date_range(start='2020-01-01', end='2023-12-31', freq='D')\n`,
        `n_samples = len(dates)\n`,
        `\n`,
        `# Generate time series with trend and seasonality\n`,
        `trend = np.linspace(100, 150, n_samples)\n`,
        `seasonal = 10 * np.sin(2 * np.pi * np.arange(n_samples) / 365.25)\n`,
        `noise = np.random.normal(0, 5, n_samples)\n`,
        `\n`,
        `df = pd.DataFrame({\n`,
        `    'date': dates,\n`,
        `    'value': trend + seasonal + noise,\n`,
        `    'category': np.random.choice(['A', 'B', 'C'], n_samples)\n`,
        `})\n`,
        `\n`,
        `print("Sample time series dataset created")\n`,
        `print(f"Shape: {df.shape}")\n`,
        `print(f"Date range: {df['date'].min()} to {df['date'].max()}")\n`,
        `print("\\nFirst few rows:")\n`,
        `print(df.head())\n`
      ];
    } else if (context.includes('price') || context.includes('financial') || context.includes('revenue')) {
      return [
        `# Generate sample financial data\n`,
        `np.random.seed(42)\n`,
        `n_samples = 200\n`,
        `\n`,
        `# Financial metrics\n`,
        `df = pd.DataFrame({\n`,
        `    'date': pd.date_range(start='2023-01-01', periods=n_samples, freq='D'),\n`,
        `    'price': np.random.lognormal(mean=3, sigma=0.3, size=n_samples),\n`,
        `    'volume': np.random.poisson(lam=1000, size=n_samples),\n`,
        `    'category': np.random.choice(['Product_A', 'Product_B', 'Product_C'], n_samples),\n`,
        `    'region': np.random.choice(['North', 'South', 'East', 'West'], n_samples)\n`,
        `})\n`,
        `\n`,
        `# Add revenue calculation\n`,
        `df['revenue'] = df['price'] * df['volume']\n`,
        `\n`,
        `print("Sample financial dataset created")\n`,
        `print(f"Shape: {df.shape}")\n`,
        `print("\\nSummary statistics:")\n`,
        `print(df[['price', 'volume', 'revenue']].describe())\n`,
        `print("\\nFirst few rows:")\n`,
        `print(df.head())\n`
      ];
    } else {
      return [
        `# Generate sample dataset\n`,
        `np.random.seed(42)  # For reproducible results\n`,
        `n_samples = 150\n`,
        `\n`,
        `# Create sample data relevant to the analysis\n`,
        `df = pd.DataFrame({\n`,
        `    'id': range(1, n_samples + 1),\n`,
        `    'value': np.random.normal(50, 15, n_samples),\n`,
        `    'category': np.random.choice(['A', 'B', 'C', 'D'], n_samples),\n`,
        `    'score': np.random.uniform(0, 100, n_samples),\n`,
        `    'flag': np.random.choice([True, False], n_samples)\n`,
        `})\n`,
        `\n`,
        `# Add some correlations to make the data more interesting\n`,
        `df['derived_metric'] = df['value'] * 0.8 + np.random.normal(0, 5, n_samples)\n`,
        `\n`,
        `print("Sample dataset created")\n`,
        `print(f"Shape: {df.shape}")\n`,
        `print("\\nFirst few rows:")\n`,
        `print(df.head())\n`,
        `print("\\nData types:")\n`,
        `print(df.dtypes)\n`
      ];
    }
  }

  public generateNotebookContent(notebook: JupyterNotebook): string {
    return JSON.stringify(notebook, null, 2);
  }

  // Centralized notebook IO and hashing utilities
  public async readNotebook(notebookPath: string): Promise<any | null> {
    try {
      const uri = vscode.Uri.file(notebookPath);
      const content = await vscode.workspace.fs.readFile(uri);
      const notebookText = Buffer.from(content).toString('utf8');
      return JSON.parse(notebookText);
    } catch (error) {
      console.error('❌ [JupyterNotebookService] Failed to read notebook:', notebookPath, error);
      return null;
    }
  }

  public async writeNotebook(notebookPath: string, data: any): Promise<void> {
    const uri = vscode.Uri.file(notebookPath);
    const updatedContent = JSON.stringify(data, null, 2);
    await vscode.workspace.fs.writeFile(uri, Buffer.from(updatedContent, 'utf8'));
  }

  public generateContentHash(source: string | string[]): string {
    const content = Array.isArray(source) ? source.join('') : source;
    const normalized = content.replace(/\s+/g, ' ').trim();
    // Simple string hash
    let hash = 0;
    for (let i = 0; i < normalized.length; i++) {
      const char = normalized.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash |= 0; // 32-bit
    }
    return Math.abs(hash).toString(36);
  }

  public async readCellData(
    notebookPath: string,
    cellId: string,
    cellIndex?: number
  ): Promise<{ source: string[]; metadata: any; cellIndex: number; cellId: string; cellType?: 'code' | 'markdown' | 'raw' } | null> {
    try {
      const notebookData = await this.readNotebook(notebookPath);
      if (!notebookData) return null;

      // Try to find cell by ID first
      let foundIndex = notebookData.cells.findIndex((c: any) => c.id === cellId);
      if (foundIndex < 0 && typeof cellIndex === 'number') {
        if (cellIndex >= 0 && cellIndex < notebookData.cells.length) {
          foundIndex = cellIndex;
        }
      }
      if (foundIndex < 0) return null;
      const cell = notebookData.cells[foundIndex];

      // Debug: show how the cell was resolved


      return {
        source: Array.isArray(cell.source) ? cell.source : [cell.source],
        metadata: cell.metadata || {},
        cellIndex: foundIndex,
        cellId: cell.id || cellId,
        cellType: cell.cell_type as 'code' | 'markdown' | 'raw'
      };
    } catch (error) {
      console.error('❌ [JupyterNotebookService] Failed to read cell data:', error);
      return null;
    }
  }

  public async writeCellMetadataFromAnalet(
    notebookPath: string,
    targetCellId: string,
    analet: Analet,
    fallbackIndex?: number,
    contentHash?: string
  ): Promise<{ meridianCellId: string; cellIndex: number; jupyterCellId: string }> {
    // Prefer live Notebook API edits when the notebook is open to avoid external file write conflicts
    const openDoc = vscode.workspace.notebookDocuments.find(d => d.uri.fsPath === notebookPath);

    if (openDoc) {
      // Locate target cell by existing meridian id, content hash, or fallback index
      let targetIndex = -1;
      // Try by meridian cell id in metadata
      for (let i = 0; i < openDoc.cellCount; i++) {
        const meta: any = openDoc.cellAt(i).metadata || {};
        if (meta?.meridian_analet?.cellId === targetCellId) {
          targetIndex = i;
          break;
        }
      }
      // Try by content hash
      if (targetIndex === -1 && contentHash) {
        for (let i = 0; i < openDoc.cellCount; i++) {
          const text = openDoc.cellAt(i).document.getText();
          const hash = this.generateContentHash(text);
          if (hash === contentHash) {
            targetIndex = i;
            break;
          }
        }
      }
      // Fallback by provided index
      if (targetIndex === -1 && typeof fallbackIndex === 'number' && fallbackIndex >= 0 && fallbackIndex < openDoc.cellCount) {
        targetIndex = fallbackIndex;
      }
      if (targetIndex === -1) {
        throw new Error(`Cell ${targetCellId} not found in open notebook`);
      }

      const existingMeta: any = openDoc.cellAt(targetIndex).metadata || {};
      const existingMeridianId = existingMeta?.meridian_analet?.cellId;
      const meridianCellId = existingMeridianId && typeof existingMeridianId === 'string'
        ? existingMeridianId
        : `mcell-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

      const newMeta = {
        ...existingMeta,
        meridian_analet: {
          type: 'analet' as const,
          id: analet.id,
          statement: analet.statement,
          formalGrammar: analet.cellQL,
          cellIndex: targetIndex,
          lastModified: new Date().toISOString(),
          cellId: meridianCellId
        }
      } as any;

      const wsEdit = new vscode.WorkspaceEdit();
      // @ts-ignore - typings for NotebookEdit may vary across VS Code versions
      wsEdit.set(openDoc.uri, [vscode.NotebookEdit.updateCellMetadata(targetIndex, newMeta)]);
      await vscode.workspace.applyEdit(wsEdit);


      return { meridianCellId, cellIndex: targetIndex, jupyterCellId: targetCellId };
    }

    // If the notebook isn't open, safely update the JSON on disk
    const notebookData = await this.readNotebook(notebookPath);
    if (!notebookData) throw new Error('Notebook not found');
    // Never use index as fallback for identity. Locate by meridian cell ID first, then by Jupyter cell ID.
    let cellIndex = notebookData.cells.findIndex((c: any) => c?.metadata?.meridian_analet?.cellId === targetCellId);
    if (cellIndex === -1) {
      cellIndex = notebookData.cells.findIndex((c: any) => c.id === targetCellId);
    }
    if (cellIndex === -1 && contentHash) {
      for (let i = 0; i < notebookData.cells.length; i++) {
        const cell = notebookData.cells[i];
        const hash = this.generateContentHash(cell.source);
        if (hash === contentHash) {
          cellIndex = i;
          break;
        }
      }
    }
    if (cellIndex === -1 && typeof fallbackIndex === 'number' && fallbackIndex >= 0 && fallbackIndex < notebookData.cells.length) {
      cellIndex = fallbackIndex;
    }
    if (cellIndex === -1) throw new Error(`Cell ${targetCellId} not found in notebook`);

    const cell = notebookData.cells[cellIndex];
    cell.metadata = cell.metadata || {};
    cell.metadata.meridian_analet = {
      type: 'analet' as const,
      id: analet.id,
      statement: analet.statement,
      formalGrammar: analet.cellQL,
      cellIndex: cellIndex,
      lastModified: new Date().toISOString()
    };
    const existingMeridianId = (cell.metadata.meridian_analet as any).cellId;
    const meridianCellId = existingMeridianId && typeof existingMeridianId === 'string'
      ? existingMeridianId
      : `mcell-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    (cell.metadata.meridian_analet as any).cellId = meridianCellId;
    await this.writeNotebook(notebookPath, notebookData);


    return { meridianCellId, cellIndex, jupyterCellId: cell.id || targetCellId };
  }

  public async findCellIndexByMeridianId(
    notebookPath: string,
    meridianCellId: string
  ): Promise<{ cellIndex: number; jupyterCellId: string } | null> {
    const notebookData = await this.readNotebook(notebookPath);
    if (!notebookData) return null;
    const idx = notebookData.cells.findIndex((c: any) => c?.metadata?.meridian_analet?.cellId === meridianCellId);
    if (idx === -1) return null;
    return { cellIndex: idx, jupyterCellId: notebookData.cells[idx].id || `cell-${idx}` };
  }
}
