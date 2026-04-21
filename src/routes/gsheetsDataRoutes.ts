import { FastifyInstance } from 'fastify';
import { google } from 'googleapis';
import { GoogleAuthService } from '../services/GoogleAuthService';

export async function gsheetsDataRoutes(
    fastify: FastifyInstance,
    options: { googleAuth: GoogleAuthService }
): Promise<void> {
    const { googleAuth } = options;

    /**
     * GET /gsheets/spreadsheets?credentialId=xxx
     * Returns all Google Sheets files accessible to the connected credential,
     * ordered by most recently modified.
     */
    fastify.get<{ Querystring: { credentialId: string } }>(
        '/gsheets/spreadsheets',
        async (request, reply) => {
            const { credentialId } = request.query;
            if (!credentialId) return reply.badRequest('credentialId is required');

            const auth  = await googleAuth.getAuthenticatedClient(credentialId);
            const drive = google.drive({ version: 'v3', auth });

            const allFiles: Array<{ id: string; name: string; modifiedTime: string | null }> = [];
            let pageToken: string | undefined;

            do {
                const res = await drive.files.list({
                    q:         "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false",
                    pageSize:  200,
                    fields:    'nextPageToken,files(id,name,modifiedTime)',
                    orderBy:   'modifiedTime desc',
                    ...(pageToken ? { pageToken } : {}),
                });

                for (const f of res.data.files ?? []) {
                    allFiles.push({
                        id:           f.id!,
                        name:         f.name!,
                        modifiedTime: f.modifiedTime ?? null,
                    });
                }

                pageToken = res.data.nextPageToken ?? undefined;
            } while (pageToken);

            return reply.send({ spreadsheets: allFiles });
        }
    );

    /**
     * GET /gsheets/sheets?credentialId=xxx&spreadsheetId=xxx
     * Returns the list of sheet tabs inside a specific spreadsheet.
     */
    fastify.get<{ Querystring: { credentialId: string; spreadsheetId: string } }>(
        '/gsheets/sheets',
        async (request, reply) => {
            const { credentialId, spreadsheetId } = request.query;
            if (!credentialId)   return reply.badRequest('credentialId is required');
            if (!spreadsheetId)  return reply.badRequest('spreadsheetId is required');

            const auth   = await googleAuth.getAuthenticatedClient(credentialId);
            const sheets = google.sheets({ version: 'v4', auth });

            const res = await sheets.spreadsheets.get({
                spreadsheetId,
                fields: 'sheets(properties(sheetId,title,index))',
            });

            const sheetList = (res.data.sheets ?? [])
                .sort((a, b) => (a.properties?.index ?? 0) - (b.properties?.index ?? 0))
                .map((s) => ({
                    id:    s.properties?.sheetId ?? 0,
                    title: s.properties?.title   ?? '',
                    index: s.properties?.index   ?? 0,
                }));

            return reply.send({ sheets: sheetList });
        }
    );
}
