/**
 * StorageCleanupService - Handles all browser storage cleanup operations
 * Replaces the removed CentralizedStorageManager and DatasetStorageService cleanup functions
 */

export class StorageCleanupService {
  private static instance: StorageCleanupService;

  private constructor() {}

  public static getInstance(): StorageCleanupService {
    if (!StorageCleanupService.instance) {
      StorageCleanupService.instance = new StorageCleanupService();
    }
    return StorageCleanupService.instance;
  }

  /**
   * Emergency cleanup for corrupted states
   */
  public async emergencyCleanup(): Promise<void> {
    // Focus on oversized localStorage entries that can cause corruption
    const criticalPatterns = ['hierarchy', 'clusters', 'analet', 'meridian'];
    
    for (const pattern of criticalPatterns) {
      const keysToRemove: string[] = [];
      
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.includes(pattern)) {
          const value = localStorage.getItem(key);
          if (value && value.length > 1024 * 1024) { // 1MB threshold
            keysToRemove.push(key);
          }
        }
      }
      
      keysToRemove.forEach(key => {
        const size = localStorage.getItem(key)?.length || 0;
        console.warn(`🚨 [StorageCleanup] Emergency: Removing oversized ${key} (${Math.round(size / 1024)} KB)`);
        localStorage.removeItem(key);
      });
    }
  }

  /**
   * Complete purge of ALL frontend storage
   */
  public async purgeAllStorage(): Promise<void> {
    const errors: string[] = [];
    let clearedCount = 0;

    try {
      // Clear localStorage
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (key.includes('meridian') || key.includes('analet') || key.includes('hierarchy'))) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach(key => {
        localStorage.removeItem(key);
      });
      clearedCount++;
    } catch (error) {
      errors.push(`localStorage: ${error}`);
    }

    try {
      // Clear sessionStorage
      sessionStorage.clear();
      clearedCount++;
    } catch (error) {
      errors.push(`sessionStorage: ${error}`);
    }

    try {
      // Clear IndexedDB databases
      if ('databases' in indexedDB) {
        const databases = await indexedDB.databases();
        for (const db of databases) {
          if (db.name && db.name.includes('meridian')) {
            await this.deleteIndexedDB(db.name);
          }
        }
      }
      clearedCount++;
    } catch (error) {
      errors.push(`IndexedDB: ${error}`);
    }
    if (errors.length > 0) {
      console.warn(`⚠️ [StorageCleanup] ${errors.length} errors during purge:`, errors);
    }

    // Force garbage collection if available
    if (window.gc) {
      window.gc();
    }
  }

  /**
   * Force close IndexedDB connections and delete database
   */
  public async forceDeleteIndexedDB(dbName: string = 'meridian-datasets'): Promise<void> {
    // Clear object stores first (often unblocks deletion)
    try {
      await this.clearObjectStoresFirst(dbName);
    } catch (error) {
      console.warn('⚠️ [StorageCleanup] Error clearing object stores:', error);
    }

    // Multiple deletion attempts with different strategies
    const strategies = [
      () => this.deleteIndexedDB(dbName),
      () => this.forceDeleteWithTimeout(dbName, 3000),
      () => this.forceDeleteWithTimeout(dbName, 5000)
    ];

    for (let i = 0; i < strategies.length; i++) {
      try {
        await strategies[i]();
        return;
      } catch (error) {
        console.warn(`⚠️ [StorageCleanup] Strategy ${i + 1} failed for ${dbName}:`, error);
        if (i === strategies.length - 1) {
          console.error(`❌ [StorageCleanup] All strategies failed for ${dbName}`);
        }
      }
    }
  }

  /**
   * Delete an IndexedDB database
   */
  private deleteIndexedDB(name: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const deleteRequest = indexedDB.deleteDatabase(name);
      
      deleteRequest.onsuccess = () => resolve();
      deleteRequest.onerror = () => reject(deleteRequest.error);
      deleteRequest.onblocked = () => {
        console.warn(`⚠️ [StorageCleanup] IndexedDB deletion blocked: ${name}`);
        // Try to resolve anyway after a timeout
        setTimeout(() => resolve(), 1000);
      };
      
      // Timeout fallback
      setTimeout(() => {
        console.warn(`⚠️ [StorageCleanup] IndexedDB deletion timeout: ${name}`);
        resolve();
      }, 5000);
    });
  }

  /**
   * Force delete IndexedDB with timeout
   */
  private forceDeleteWithTimeout(name: string, timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const deleteRequest = indexedDB.deleteDatabase(name);
      
      const timeout = setTimeout(() => {
        console.warn(`⚠️ [StorageCleanup] Force delete timeout (${timeoutMs}ms): ${name}`);
        resolve(); // Resolve anyway
      }, timeoutMs);

      deleteRequest.onsuccess = () => {
        clearTimeout(timeout);
        resolve();
      };

      deleteRequest.onerror = () => {
        clearTimeout(timeout);
        reject(deleteRequest.error);
      };

      deleteRequest.onblocked = () => {
        console.warn(`⚠️ [StorageCleanup] Force delete blocked: ${name}`);
        // Don't clear timeout, let it resolve
      };
    });
  }

  /**
   * Clear object stores first to unblock deletion
   */
  private clearObjectStoresFirst(dbName: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const openRequest = indexedDB.open(dbName);
      
      openRequest.onsuccess = () => {
        const db = openRequest.result;
        try {
          const storeNames = Array.from(db.objectStoreNames);
          if (storeNames.length === 0) {
            db.close();
            resolve();
            return;
          }

          const transaction = db.transaction(storeNames, 'readwrite');
          let completedStores = 0;

          storeNames.forEach(storeName => {
            try {
              const store = transaction.objectStore(storeName);
              const clearRequest = store.clear();
              
              clearRequest.onsuccess = () => {
                completedStores++;
                if (completedStores === storeNames.length) {
                  db.close();
                  resolve();
                }
              };

              clearRequest.onerror = () => {
                completedStores++;
                if (completedStores === storeNames.length) {
                  db.close();
                  resolve(); // Resolve anyway
                }
              };
            } catch (error) {
              completedStores++;
              if (completedStores === storeNames.length) {
                db.close();
                resolve(); // Resolve anyway
              }
            }
          });

          // Timeout fallback
          setTimeout(() => {
            db.close();
            resolve();
          }, 2000);

        } catch (error) {
          db.close();
          reject(error);
        }
      };

      openRequest.onerror = () => {
        reject(openRequest.error);
      };

      openRequest.onblocked = () => {
        console.warn(`⚠️ [StorageCleanup] Open blocked for clearing: ${dbName}`);
        setTimeout(() => resolve(), 1000);
      };
    });
  }

  /**
   * Get storage usage information
   */
  public async getStorageInfo(): Promise<{ [key: string]: any }> {
    const info: { [key: string]: any } = {};
    
    // localStorage info
    const localStorageInfo: { [key: string]: any } = {};
    let totalLocalStorageSize = 0;
    
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key) {
        const value = localStorage.getItem(key);
        if (value) {
          const size = value.length;
          totalLocalStorageSize += size;
          if (key.includes('meridian') || key.includes('analet') || key.includes('hierarchy')) {
            localStorageInfo[key] = {
              sizeBytes: size,
              sizeKB: Math.round(size / 1024),
              preview: value.substring(0, 100)
            };
          }
        }
      }
    }
    
    info.localStorage = {
      total: {
        entries: localStorage.length,
        sizeBytes: totalLocalStorageSize,
        sizeKB: Math.round(totalLocalStorageSize / 1024)
      },
      meridianEntries: localStorageInfo
    };

    // sessionStorage info
    info.sessionStorage = {
      entries: sessionStorage.length
    };

    // IndexedDB info
    try {
      if ('databases' in indexedDB) {
        const databases = await indexedDB.databases();
        info.indexedDB = {
          databases: databases.map(db => ({
            name: db.name,
            version: db.version
          }))
        };
      }
    } catch (error) {
      info.indexedDB = { error: error instanceof Error ? error.message : String(error) };
    }

    return info;
  }
}