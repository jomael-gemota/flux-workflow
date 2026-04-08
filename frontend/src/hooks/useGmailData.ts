import { useQuery } from '@tanstack/react-query';
import { listGmailLabels } from '../api/client';

export function useGmailLabels(credentialId: string) {
  return useQuery({
    queryKey:  ['gmail-labels', credentialId],
    queryFn:   () => listGmailLabels(credentialId),
    enabled:   !!credentialId,
    staleTime: 5 * 60 * 1000,
    retry:     false,
  });
}
