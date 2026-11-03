import React from 'react';

// Import React components for each icon
import { RIcon } from './icons/RIcon';
import { CssIcon } from './icons/CssIcon';
import { CsvIcon } from './icons/CsvIcon';
import { ImageIcon } from './icons/ImageIcon';
import { JavascriptIcon } from './icons/JavascriptIcon';
import { JsonIcon } from './icons/JsonIcon';
import { JuliaIcon } from './icons/JuliaIcon';
import { NotebookIcon } from './icons/NotebookIcon';
import { PythonIcon } from './icons/PythonIcon';
import { ZipIcon } from './icons/ZipIcon';




interface FileIconProps {
  fileName: string;
  className?: string;
  color?: string;
}

// Mapping file extension to Seti icon name (based on available icons in webview-ui/icons/)
// Available icons: R.svg, css.svg, csv.svg, image.svg, javascript.svg, json.svg, julia.svg, notebook.svg, python.svg, zip.svg
const extensionToSetiName: Record<string, string> = {
  // Jupyter Notebook
  "ipynb": "notebook",
  
  // JavaScript family
  "js": "javascript",
  "jsx": "javascript", 
  "ts": "javascript",  // No typescript.svg, use javascript
  "tsx": "javascript",
  "mjs": "javascript",
  
  // Data formats
  "json": "json",
  "csv": "csv",
  
  // Python
  "py": "python",
  "pyx": "python",
  "pyi": "python",
  "pyw": "python",
  
  // Styling
  "css": "css",
  "scss": "css",
  "sass": "css",
  "less": "css",
  
  // Images
  "png": "image",
  "jpg": "image",
  "jpeg": "image",
  "gif": "image",
  "bmp": "image",
  "webp": "image",
  "svg": "image",
  "ico": "image",
  
  // Archives
  "zip": "zip",
  "rar": "zip",
  "7z": "zip",
  "tar": "zip",
  "gz": "zip",
  "bz2": "zip",
  
  // R language
  "r": "R",
  "R": "R",
  "rmd": "R",
  "Rmd": "R",
  
  // Julia
  "jl": "julia"
};

// Map Seti icon name to imported SVG component
const setiNameToIconComponent: Record<string, React.FC<React.SVGProps<SVGSVGElement>>> = {
  R: RIcon,
  css: CssIcon,
  csv: CsvIcon,
  image: ImageIcon,
  javascript: JavascriptIcon,
  json: JsonIcon,
  julia: JuliaIcon,
  notebook: NotebookIcon,
  python: PythonIcon,
  zip: ZipIcon,
};

// Default colors for each icon type
const iconColors: Record<string, string> = {
  R: "#276DC3",
  css: "#529BBA",
  csv: "#8CC148",
  image: "#9F74B3",
  javascript: "#F1DD3F",
  json: "#DBCD68",
  julia: "#9F74B3",
  notebook: "#6798B8",
  python: "#356EA1",
  zip: "#888888",
};

export const FileIcon: React.FC<FileIconProps> = ({ fileName, className = "w-4 h-4", color }) => {
  const extension = fileName.split('.').pop()?.toLowerCase() || '';
  const setiName = extensionToSetiName[extension] || null;

  // Get the icon component from the static map
  const IconComponent = setiName ? setiNameToIconComponent[setiName] : null;
  
  // Get the appropriate color (custom color prop overrides default)
  const iconColor = color || (setiName ? iconColors[setiName] : undefined);

  // If no specific icon found, return generic file icon
  if (!IconComponent) {
    return (
      <svg className={className} fill="#a0a1a7" viewBox="0 0 16 16">
        <path d="M4 1a1 1 0 00-1 1v12a1 1 0 001 1h8a1 1 0 001-1V4.414a1 1 0 00-.293-.707L9.586 1.586A1 1 0 008.879 1.293L8.586 1H4zm0 1h4v3a1 1 0 001 1h3v8H4V2zm5 1.414L10.586 5H9V3.414z"/>
      </svg>
    );
  }

  return (
    <IconComponent
      className={className}
      color={iconColor}
      aria-label={`${setiName || 'file'} icon`}
    />
  );
};