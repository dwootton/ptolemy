/**
 * FileSystemMessageHandler - Handles workspace file operations
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { BaseMessageHandler } from '../BaseMessageHandler';
import { MessageContext } from '../types';

export class FileSystemMessageHandler extends BaseMessageHandler {

  constructor() {
    super([
      'getFiles',
      'openFile',
      'create-folder',
      'delete-file',
      'rename-file',
      'open-file'
    ]);
  }

  public async handle(messageType: string, data: any, context: MessageContext): Promise<void> {
    switch (messageType) {
      case 'getFiles':
        await this.handleGetFiles();
        break;
      case 'openFile':
      case 'open-file':
        await this.handleOpenFile(data);
        break;
      case 'create-folder':
        await this.handleCreateFolder(data);
        break;
      case 'delete-file':
        await this.handleDeleteFile(data);
        break;
      case 'rename-file':
        await this.handleRenameFile(data);
        break;
      default:
        throw new Error(`Unsupported message type: ${messageType}`);
    }
  }

  /**
   * Get list of files in the workspace
   */
  private async handleGetFiles(): Promise<void> {
    try {
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (!workspaceFolder) {
        await this.sendMessage('fileList', {
          error: 'No workspace folder is open',
          files: [],
          workspacePath: null
        });
        return;
      }

      this.log('info', 'Getting workspace files', { path: workspaceFolder.uri.fsPath });

      const files = await this.getWorkspaceFiles(workspaceFolder.uri.fsPath);
      
      await this.sendMessage('fileList', {
        files: files,
        workspacePath: workspaceFolder.uri.fsPath,
        success: true
      });

    } catch (error) {
      await this.sendMessage('fileList', {
        error: error instanceof Error ? error.message : 'Failed to get files',
        files: [],
        workspacePath: null
      });
    }
  }

  /**
   * Open a file in VS Code
   */
  private async handleOpenFile(data: any): Promise<void> {
    try {
      const validation = this.validateData(data, ['filePath']);
      if (!validation.isValid) {
        throw new Error(validation.error);
      }

      const { filePath } = data;
      this.log('info', 'Opening file', { filePath });

      // Resolve the file path
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (!workspaceFolder) {
        throw new Error('No workspace folder is open');
      }

      const fullPath = path.isAbsolute(filePath) 
        ? filePath 
        : path.join(workspaceFolder.uri.fsPath, filePath);

      // Check if file exists
      if (!fs.existsSync(fullPath)) {
        throw new Error(`File does not exist: ${fullPath}`);
      }

      // Open the file
      const document = await vscode.workspace.openTextDocument(fullPath);
      await vscode.window.showTextDocument(document);

      await this.sendMessage('file-opened', {
        success: true,
        filePath: fullPath
      });

    } catch (error) {
      await this.sendError('openFile', error, data);
    }
  }

  /**
   * Create a new folder
   */
  private async handleCreateFolder(data: any): Promise<void> {
    try {
      const validation = this.validateData(data, ['folderPath']);
      if (!validation.isValid) {
        throw new Error(validation.error);
      }

      const { folderPath } = data;
      this.log('info', 'Creating folder', { folderPath });

      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (!workspaceFolder) {
        throw new Error('No workspace folder is open');
      }

      const fullPath = path.isAbsolute(folderPath) 
        ? folderPath 
        : path.join(workspaceFolder.uri.fsPath, folderPath);

      // Create the folder if it doesn't exist
      if (!fs.existsSync(fullPath)) {
        fs.mkdirSync(fullPath, { recursive: true });
        this.log('info', 'Folder created successfully', { fullPath });
      } else {
        this.log('info', 'Folder already exists', { fullPath });
      }

      await this.sendMessage('folder-created', {
        success: true,
        folderPath: fullPath
      });

    } catch (error) {
      await this.sendError('create-folder', error, data);
    }
  }

  /**
   * Delete a file or folder
   */
  private async handleDeleteFile(data: any): Promise<void> {
    try {
      const validation = this.validateData(data, ['filePath']);
      if (!validation.isValid) {
        throw new Error(validation.error);
      }

      const { filePath } = data;
      this.log('info', 'Deleting file/folder', { filePath });

      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (!workspaceFolder) {
        throw new Error('No workspace folder is open');
      }

      const fullPath = path.isAbsolute(filePath) 
        ? filePath 
        : path.join(workspaceFolder.uri.fsPath, filePath);

      // Check if file/folder exists
      if (!fs.existsSync(fullPath)) {
        throw new Error(`File or folder does not exist: ${fullPath}`);
      }

      // Delete the file or folder
      const stats = fs.statSync(fullPath);
      if (stats.isDirectory()) {
        fs.rmSync(fullPath, { recursive: true, force: true });
        this.log('info', 'Folder deleted successfully', { fullPath });
      } else {
        fs.unlinkSync(fullPath);
        this.log('info', 'File deleted successfully', { fullPath });
      }

      await this.sendMessage('file-deleted', {
        success: true,
        filePath: fullPath,
        wasDirectory: stats.isDirectory()
      });

    } catch (error) {
      await this.sendError('delete-file', error, data);
    }
  }

  /**
   * Rename a file or folder
   */
  private async handleRenameFile(data: any): Promise<void> {
    try {
      const validation = this.validateData(data, ['oldPath', 'newPath']);
      if (!validation.isValid) {
        throw new Error(validation.error);
      }

      const { oldPath, newPath } = data;
      this.log('info', 'Renaming file/folder', { oldPath, newPath });

      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (!workspaceFolder) {
        throw new Error('No workspace folder is open');
      }

      const fullOldPath = path.isAbsolute(oldPath) 
        ? oldPath 
        : path.join(workspaceFolder.uri.fsPath, oldPath);

      const fullNewPath = path.isAbsolute(newPath) 
        ? newPath 
        : path.join(workspaceFolder.uri.fsPath, newPath);

      // Check if source exists
      if (!fs.existsSync(fullOldPath)) {
        throw new Error(`Source file or folder does not exist: ${fullOldPath}`);
      }

      // Check if destination already exists
      if (fs.existsSync(fullNewPath)) {
        throw new Error(`Destination already exists: ${fullNewPath}`);
      }

      // Rename the file or folder
      fs.renameSync(fullOldPath, fullNewPath);
      
      this.log('info', 'File/folder renamed successfully', { 
        from: fullOldPath, 
        to: fullNewPath 
      });

      await this.sendMessage('file-renamed', {
        success: true,
        oldPath: fullOldPath,
        newPath: fullNewPath
      });

    } catch (error) {
      await this.sendError('rename-file', error, data);
    }
  }

  /**
   * Get files in workspace recursively
   */
  private async getWorkspaceFiles(workspacePath: string): Promise<any[]> {
    const files: any[] = [];
    
    const getFilesRecursive = (dir: string, relativePath: string = ''): void => {
      try {
        const items = fs.readdirSync(dir);
        
        for (const item of items) {
          // Skip hidden files and common ignore patterns
          if (item.startsWith('.') || 
              item === 'node_modules' || 
              item === '__pycache__' ||
              item === '.vscode' ||
              item === 'dist' ||
              item === 'build') {
            continue;
          }

          const fullPath = path.join(dir, item);
          const itemRelativePath = relativePath ? path.join(relativePath, item) : item;
          
          try {
            const stats = fs.statSync(fullPath);
            
            if (stats.isDirectory()) {
              files.push({
                name: item,
                path: itemRelativePath,
                fullPath,
                type: 'directory',
                size: 0,
                modified: stats.mtime
              });
              
              // Recursively get files from subdirectory
              getFilesRecursive(fullPath, itemRelativePath);
            } else {
              files.push({
                name: item,
                path: itemRelativePath,
                fullPath,
                type: 'file',
                size: stats.size,
                modified: stats.mtime,
                extension: path.extname(item)
              });
            }
          } catch (statError) {
            // Skip files we can't stat (permission issues, etc.)
            this.log('warn', `Could not stat file: ${fullPath}`, statError);
          }
        }
      } catch (readError) {
        // Skip directories we can't read
        this.log('warn', `Could not read directory: ${dir}`, readError);
      }
    };

    getFilesRecursive(workspacePath);
    
    // Sort files: directories first, then by name
    files.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === 'directory' ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });

    this.log('info', 'Found workspace files', { count: files.length });
    return files;
  }
}