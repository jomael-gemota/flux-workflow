import { useQuery } from '@tanstack/react-query';
import { listGSheetsSpreadsheets, listGSheetsSheets } from '../api/client';

/** Lists all Google Sheets spreadsheets accessible to the connected credential. */
export function useGSheetsSpreadsheets(credentialId: string) {
  const query = useQuery({
    queryKey:  ['gsheets-spreadsheets', credentialId],
    queryFn:   () => listGSheetsSpreadsheets(credentialId),
    enabled:   !!credentialId,
    staleTime: 5 * 60 * 1000,
    retry:     false,
  });

  return {
    ...query,
    spreadsheets: query.data?.spreadsheets ?? [],
  };
}

/** Lists all sheet tabs within a specific spreadsheet. */
export function useGSheetsSheets(credentialId: string, spreadsheetId: string) {
  const query = useQuery({
    queryKey:  ['gsheets-sheets', credentialId, spreadsheetId],
    queryFn:   () => listGSheetsSheets(credentialId, spreadsheetId),
    enabled:   !!credentialId && !!spreadsheetId,
    staleTime: 5 * 60 * 1000,
    retry:     false,
  });

  return {
    ...query,
    sheets: query.data?.sheets ?? [],
  };
}
