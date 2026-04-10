import { useQuery } from '@tanstack/react-query';
import { listGDriveItems, getGDriveFile } from '../api/client';

/** Lists files and/or folders inside a given Drive folder. */
export function useGDriveItems(credentialId: string, folderId?: string, type: string = 'all') {
  return useQuery({
    queryKey:  ['gdrive-items', credentialId, folderId ?? 'root', type],
    queryFn:   () => listGDriveItems(credentialId, folderId, type),
    enabled:   !!credentialId,
    staleTime: 30 * 1000,
    retry:     false,
  });
}

/** Fetches metadata for a single Drive file/folder — used to resolve breadcrumbs. */
export function useGDriveFile(credentialId: string, fileId: string) {
  return useQuery({
    queryKey:  ['gdrive-file', credentialId, fileId],
    queryFn:   () => getGDriveFile(credentialId, fileId),
    enabled:   !!credentialId && !!fileId,
    staleTime: 60 * 1000,
    retry:     false,
  });
}
