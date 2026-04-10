import { FastifyInstance } from 'fastify';
import { google } from 'googleapis';
import { GoogleAuthService } from '../services/GoogleAuthService';

export async function gdriveDataRoutes(
    fastify: FastifyInstance,
    options: { googleAuth: GoogleAuthService }
): Promise<void> {
    const { googleAuth } = options;

    /**
     * GET /gdrive/items?credentialId=xxx&folderId=xxx&type=folders|files|all
     * Lists files/folders inside a given Drive folder for the UI browser.
     * folderId defaults to 'root' (My Drive).
     */
    fastify.get<{ Querystring: { credentialId: string; folderId?: string; type?: string } }>(
        '/gdrive/items',
        async (request, reply) => {
            const { credentialId, folderId, type = 'all' } = request.query;
            if (!credentialId) return reply.badRequest('credentialId is required');

            const auth  = await googleAuth.getAuthenticatedClient(credentialId);
            const drive = google.drive({ version: 'v3', auth });

            const parentId = folderId && folderId !== 'root' ? folderId : 'root';
            let q = `'${parentId}' in parents and trashed = false`;
            if (type === 'folders') {
                q += ` and mimeType = 'application/vnd.google-apps.folder'`;
            } else if (type === 'files') {
                q += ` and mimeType != 'application/vnd.google-apps.folder'`;
            }

            const res = await drive.files.list({
                q,
                pageSize: 200,
                fields: 'files(id,name,mimeType,parents,modifiedTime,size)',
                orderBy: 'folder,name',
                includeItemsFromAllDrives: true,
                supportsAllDrives: true,
            });

            return reply.send({ items: res.data.files ?? [] });
        }
    );

    /**
     * GET /gdrive/file?credentialId=xxx&fileId=xxx
     * Returns metadata for a single file/folder — used by the UI to resolve
     * the breadcrumb path when an existing fileId/folderId is pre-filled.
     */
    fastify.get<{ Querystring: { credentialId: string; fileId: string } }>(
        '/gdrive/file',
        async (request, reply) => {
            const { credentialId, fileId } = request.query;
            if (!credentialId) return reply.badRequest('credentialId is required');
            if (!fileId)       return reply.badRequest('fileId is required');

            const auth  = await googleAuth.getAuthenticatedClient(credentialId);
            const drive = google.drive({ version: 'v3', auth });

            const res = await drive.files.get({
                fileId,
                fields: 'id,name,mimeType,parents',
                supportsAllDrives: true,
            });

            return reply.send(res.data);
        }
    );
}
