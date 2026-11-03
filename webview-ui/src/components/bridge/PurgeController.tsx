import { useEffect, useState } from 'react';
import { MessageService } from '../../services/MessageService';
import { StorageCleanupService } from '../../services/StorageCleanupService';

interface PurgeControllerProps {
  onDeletingChange?: (deleting: boolean) => void;
}

export function PurgeController(props: PurgeControllerProps) {
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    const messageService = MessageService.getInstance();
    const handlePurgeFrontendStorage = async (data: any) => {
      setIsDeleting(true);
      props.onDeletingChange?.(true);

      try {
        await new Promise(resolve => setTimeout(resolve, 100));
        const storageCleanup = StorageCleanupService.getInstance();
        if (data.emergency) {
          await storageCleanup.emergencyCleanup();
        }
        await storageCleanup.purgeAllStorage();
        messageService.sendMessage('frontend-storage-purged', {
          success: true,
          message: 'Frontend storage successfully cleared'
        });
      } catch (error) {
        console.error('❌ [PurgeController] Error during frontend storage purge:', error);
        messageService.sendMessage('frontend-storage-purged', {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      } finally {
        setIsDeleting(false);
        props.onDeletingChange?.(false);
      }
    };

    const unsubscribe = messageService.onMessage('purge-frontend-storage', handlePurgeFrontendStorage);
    return unsubscribe;
  }, [props]);

  if (!isDeleting) return null;

  return (
    <div className="absolute inset-0 bg-black bg-opacity-60 z-[9999] flex items-center justify-center">
      <div className="text-center">
        <div className="text-lg mb-2 text-white">Deleting...</div>
        <div className="text-sm text-gray-300">Clearing all data and storage</div>
      </div>
    </div>
  );
}


