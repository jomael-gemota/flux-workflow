import { google } from 'googleapis';
import { Readable } from 'stream';
import { NodeExecutor } from '../engine/NodeExecutor';
import { WorkflowNode, ExecutionContext } from '../types/workflow.types';
import { GoogleAuthService } from '../services/GoogleAuthService';
import { ExpressionResolver } from '../engine/ExpressionResolver';

type GDriveAction =
    | 'list' | 'upload' | 'download'
    | 'create_file' | 'copy_file' | 'delete_file' | 'move_file'
    | 'share_file' | 'update_file' | 'rename_file'
    | 'create_folder' | 'delete_folder' | 'share_folder';

interface GDriveConfig {
    credentialId: string;
    action: GDriveAction;

    // ── list ──────────────────────────────────────────────────────────────────
    searchQuery?: string;           // plain text — auto-translated to Drive query
    searchFolderId?: string;        // folder to search in (ID from browser)
    includeType?: 'files' | 'folders' | 'both';
    owner?: string;                 // filter by owner email
    fileNameFilter?: string;        // filter by filename fragment
    dateField?: 'createdTime' | 'modifiedTime';
    dateAfter?: string;             // ISO date string
    dateBefore?: string;            // ISO date string
    includeShared?: boolean;        // include shared-with-me items
    fileTypes?: string[];           // 'image' | 'pdf' | 'docs' | 'sheets' | 'slides' | 'video' | 'audio' | 'zip'
    maxResults?: number;

    // ── upload ────────────────────────────────────────────────────────────────
    uploadSource?: 'content' | 'local' | 'drive';
    uploadFileName?: string;
    uploadContent?: string;         // text / expression (for 'content')
    uploadData?: string;            // base64 (for 'local')
    uploadMimeType?: string;        // auto-detected; overridable
    sourceFileId?: string;          // source Drive file (for 'drive' source)
    destinationFolderId?: string;   // destination folder (upload, copy_file, move_file)

    // ── download ──────────────────────────────────────────────────────────────
    downloadFolderId?: string;      // folder to search in
    downloadFileName?: string;      // filename to match

    // ── create_file ───────────────────────────────────────────────────────────
    fileName?: string;
    content?: string;
    mimeType?: string;
    folderId?: string;              // destination for create_file; target for delete_folder

    // ── copy / delete / move / share / update / rename (file) ─────────────────
    fileId?: string;                // target file (legacy download + all per-file actions)
    permanent?: boolean;            // trash (false) vs permanent delete (true)
    newName?: string;               // rename_file / copy_file override name

    // ── share_file / share_folder ─────────────────────────────────────────────
    shareMode?: 'grant' | 'restrict';        // default: 'grant'
    shareEmail?: string;
    shareRole?: 'reader' | 'commenter' | 'writer';
    shareType?: 'user' | 'anyone';
    sendNotification?: boolean;
    // restrict mode
    restrictType?: 'user' | 'anyone' | 'all'; // remove user, remove public link, or make fully private

    // ── create_folder ─────────────────────────────────────────────────────────
    folderName?: string;
    parentFolderId?: string;        // parent for new folder
}

/** Infer a MIME type from a filename extension. */
function guessMime(filename: string): string {
    const ext = (filename.split('.').pop() ?? '').toLowerCase();
    const map: Record<string, string> = {
        pdf:  'application/pdf',
        doc:  'application/msword',
        docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        xls:  'application/vnd.ms-excel',
        xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        ppt:  'application/vnd.ms-powerpoint',
        pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        png:  'image/png',
        jpg:  'image/jpeg',
        jpeg: 'image/jpeg',
        gif:  'image/gif',
        webp: 'image/webp',
        svg:  'image/svg+xml',
        txt:  'text/plain',
        csv:  'text/csv',
        html: 'text/html',
        json: 'application/json',
        zip:  'application/zip',
        mp4:  'video/mp4',
        mp3:  'audio/mpeg',
        wav:  'audio/wav',
    };
    return map[ext] ?? 'application/octet-stream';
}

/** Escape single quotes for Drive query strings. */
const driveEscape = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

export class GDriveNode implements NodeExecutor {
    private googleAuth: GoogleAuthService;
    private resolver = new ExpressionResolver();

    constructor(googleAuth: GoogleAuthService) {
        this.googleAuth = googleAuth;
    }

    async execute(node: WorkflowNode, context: ExecutionContext): Promise<unknown> {
        const config = node.config as unknown as GDriveConfig;
        const { credentialId, action } = config;

        if (!credentialId) throw new Error('Google Drive node: credentialId is required');
        if (!action)       throw new Error('Google Drive node: action is required');

        const auth  = await this.googleAuth.getAuthenticatedClient(credentialId);
        const drive = google.drive({ version: 'v3', auth });

        // ── list ──────────────────────────────────────────────────────────────

        if (action === 'list') {
            const queryParts: string[] = ['trashed = false'];

            // Folder scope
            const searchFolderId = config.searchFolderId
                ? this.resolver.resolveTemplate(config.searchFolderId, context)
                : undefined;
            if (searchFolderId) {
                queryParts.push(`'${driveEscape(searchFolderId)}' in parents`);
            }

            // Type filter
            if (config.includeType === 'folders') {
                queryParts.push(`mimeType = 'application/vnd.google-apps.folder'`);
            } else if (config.includeType === 'files') {
                queryParts.push(`mimeType != 'application/vnd.google-apps.folder'`);
            }

            // Plain-text search (name or full text)
            const searchQuery = config.searchQuery
                ? this.resolver.resolveTemplate(config.searchQuery, context).trim()
                : '';
            if (searchQuery) {
                queryParts.push(
                    `(name contains '${driveEscape(searchQuery)}' or fullText contains '${driveEscape(searchQuery)}')`
                );
            }

            // Filename fragment filter (separate from full-text search)
            const fileNameFilter = config.fileNameFilter
                ? this.resolver.resolveTemplate(config.fileNameFilter, context).trim()
                : '';
            if (fileNameFilter) {
                queryParts.push(`name contains '${driveEscape(fileNameFilter)}'`);
            }

            // Owner filter
            const owner = config.owner
                ? this.resolver.resolveTemplate(config.owner, context).trim()
                : '';
            if (owner) {
                queryParts.push(`'${driveEscape(owner)}' in owners`);
            }

            // Date filters
            if (config.dateField) {
                if (config.dateAfter) {
                    const dateAfter = this.resolver.resolveTemplate(config.dateAfter, context).trim();
                    if (dateAfter) queryParts.push(`${config.dateField} > '${dateAfter}'`);
                }
                if (config.dateBefore) {
                    const dateBefore = this.resolver.resolveTemplate(config.dateBefore, context).trim();
                    if (dateBefore) queryParts.push(`${config.dateField} < '${dateBefore}'`);
                }
            }

            // File type filters (translated to MIME queries)
            if (config.fileTypes && config.fileTypes.length > 0) {
                const typeMimeMap: Record<string, string[]> = {
                    image:  ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml', 'image/bmp'],
                    pdf:    ['application/pdf'],
                    docs:   ['application/vnd.google-apps.document',
                             'application/msword',
                             'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
                    sheets: ['application/vnd.google-apps.spreadsheet',
                             'application/vnd.ms-excel',
                             'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
                    slides: ['application/vnd.google-apps.presentation',
                             'application/vnd.ms-powerpoint',
                             'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
                    video:  ['video/mp4', 'video/avi', 'video/quicktime', 'video/x-msvideo'],
                    audio:  ['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/flac'],
                    zip:    ['application/zip', 'application/x-zip-compressed', 'application/x-rar-compressed'],
                };
                const mimeFilters: string[] = [];
                for (const t of config.fileTypes) {
                    (typeMimeMap[t] ?? []).forEach((m) => mimeFilters.push(`mimeType = '${m}'`));
                }
                if (mimeFilters.length > 0) {
                    queryParts.push(`(${mimeFilters.join(' or ')})`);
                }
            }

            const pageSize = config.maxResults ?? 20;

            // Drive API forbids orderBy when fullText is present in the query —
            // results are returned in descending relevance order instead.
            const hasFullText = !!searchQuery;

            const res = await drive.files.list({
                q:        queryParts.join(' and '),
                pageSize,
                fields:   'files(id,name,mimeType,size,modifiedTime,createdTime,webViewLink,parents,owners,shared)',
                ...(hasFullText ? {} : { orderBy: 'folder,name' }),
                includeItemsFromAllDrives: !!config.includeShared,
                supportsAllDrives:         !!config.includeShared,
            });

            const files = res.data.files ?? [];
            return { files, total: files.length };
        }

        // ── upload ────────────────────────────────────────────────────────────

        if (action === 'upload') {
            const uploadSource      = config.uploadSource ?? 'content';
            const fileName          = this.resolver.resolveTemplate(config.uploadFileName ?? 'untitled', context);
            const destinationFolderId = config.destinationFolderId
                ? this.resolver.resolveTemplate(config.destinationFolderId, context)
                : undefined;

            const requestBody: { name: string; parents?: string[] } = { name: fileName };
            if (destinationFolderId) requestBody.parents = [destinationFolderId];

            if (uploadSource === 'content') {
                const content  = this.resolver.resolveTemplate(config.uploadContent ?? '', context);
                const mimeType = config.uploadMimeType ?? guessMime(fileName);
                const res = await drive.files.create({
                    requestBody,
                    media:  { mimeType, body: Readable.from([content]) },
                    fields: 'id,name,mimeType,size,webViewLink',
                });
                return res.data;
            }

            if (uploadSource === 'local') {
                const rawData  = config.uploadData ?? '';
                const b64      = rawData.includes(',') ? rawData.split(',')[1] : rawData;
                const buffer   = Buffer.from(b64, 'base64');
                const mimeType = config.uploadMimeType ?? guessMime(fileName);
                const res = await drive.files.create({
                    requestBody,
                    media:  { mimeType, body: Readable.from(buffer) },
                    fields: 'id,name,mimeType,size,webViewLink',
                });
                return res.data;
            }

            if (uploadSource === 'drive') {
                // Copy a file (or multiple files) from another Drive location.
                // The expression may resolve to:
                //   • a plain file ID string            → single copy
                //   • a JSON file object { id, ... }   → single copy
                //   • a JSON array of file objects      → copy all (bulk)
                const rawResolved = config.sourceFileId
                    ? this.resolver.resolveTemplate(config.sourceFileId, context).trim()
                    : '';
                if (!rawResolved) throw new Error('Google Drive upload: sourceFileId is required for Drive source');

                // Extract one or many file IDs from whatever the expression resolved to
                let fileIds: string[] = [];
                try {
                    const parsed = JSON.parse(rawResolved);
                    if (Array.isArray(parsed)) {
                        fileIds = parsed
                            .map((f: unknown) =>
                                typeof f === 'object' && f !== null && 'id' in f
                                    ? String((f as Record<string, unknown>).id)
                                    : ''
                            )
                            .filter(Boolean);
                    } else if (typeof parsed === 'object' && parsed !== null && 'id' in parsed) {
                        fileIds = [String((parsed as Record<string, unknown>).id)];
                    } else {
                        fileIds = [rawResolved]; // treat as plain ID
                    }
                } catch {
                    fileIds = [rawResolved]; // not JSON — treat as plain file ID
                }

                if (fileIds.length === 0) {
                    throw new Error('Google Drive upload: no valid file ID found in the expression result');
                }

                const overrideName = this.resolver.resolveTemplate(config.uploadFileName ?? '', context).trim();

                const copyOne = async (fileId: string) => {
                    const reqBody: { name?: string; parents?: string[] } = {};
                    // Only apply override name for single-file copies; bulk keeps original names
                    if (overrideName && fileIds.length === 1) reqBody.name = overrideName;
                    if (destinationFolderId) reqBody.parents = [destinationFolderId];
                    const res = await drive.files.copy({
                        fileId,
                        requestBody:       reqBody,
                        fields:            'id,name,mimeType,size,webViewLink',
                        supportsAllDrives: true,
                    });
                    return res.data;
                };

                if (fileIds.length === 1) {
                    return copyOne(fileIds[0]);
                }

                // Bulk copy — run concurrently and return summary
                const copied = await Promise.all(fileIds.map(copyOne));
                return { files: copied, total: copied.length };
            }

            throw new Error(`Google Drive upload: unknown source "${uploadSource}"`);
        }

        // ── download ──────────────────────────────────────────────────────────

        if (action === 'download') {
            let fileId: string;

            if (config.downloadFileName) {
                // Find file by folder + filename
                const dlFolderId   = config.downloadFolderId
                    ? this.resolver.resolveTemplate(config.downloadFolderId, context)
                    : 'root';
                const dlFileName   = this.resolver.resolveTemplate(config.downloadFileName, context).trim();
                const q = `'${driveEscape(dlFolderId)}' in parents and name contains '${driveEscape(dlFileName)}' and trashed = false`;

                const searchRes = await drive.files.list({
                    q,
                    pageSize: 1,
                    fields:   'files(id,name,mimeType)',
                });
                const found = searchRes.data.files?.[0];
                if (!found) throw new Error(`Google Drive download: no file matching "${dlFileName}" in the specified folder`);
                fileId = found.id!;
            } else {
                fileId = config.fileId
                    ? this.resolver.resolveTemplate(config.fileId, context)
                    : '';
                if (!fileId) throw new Error('Google Drive download: provide a folder + filename or a File ID');
            }

            const meta = await drive.files.get({ fileId, fields: 'id,name,mimeType' });

            const googleMimeTypes: Record<string, string> = {
                'application/vnd.google-apps.document':     'text/plain',
                'application/vnd.google-apps.spreadsheet':  'text/csv',
                'application/vnd.google-apps.presentation': 'text/plain',
            };
            const exportMime = googleMimeTypes[meta.data.mimeType ?? ''];

            let content: string;
            if (exportMime) {
                const res = await drive.files.export({ fileId, mimeType: exportMime }, { responseType: 'text' });
                content = res.data as string;
            } else {
                const res = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'text' });
                content = res.data as string;
            }

            return { fileId, name: meta.data.name, mimeType: meta.data.mimeType, content };
        }

        // ── create_file ───────────────────────────────────────────────────────

        if (action === 'create_file') {
            const fileName = this.resolver.resolveTemplate(config.fileName ?? 'untitled', context);
            const folderId = config.folderId
                ? this.resolver.resolveTemplate(config.folderId, context)
                : undefined;

            // Use the explicitly chosen mimeType; fall back to extension detection
            const mimeType = config.mimeType && config.mimeType !== 'auto'
                ? config.mimeType
                : guessMime(fileName);

            const requestBody: { name: string; mimeType?: string; parents?: string[] } = { name: fileName };
            if (folderId) requestBody.parents = [folderId];

            // Google-native types (Docs, Sheets, Slides, Forms) must be created
            // without a media body — the API rejects binary/text content for them.
            const googleNativeTypes = new Set([
                'application/vnd.google-apps.document',
                'application/vnd.google-apps.spreadsheet',
                'application/vnd.google-apps.presentation',
                'application/vnd.google-apps.form',
            ]);

            if (googleNativeTypes.has(mimeType)) {
                requestBody.mimeType = mimeType;
                const res = await drive.files.create({
                    requestBody,
                    fields: 'id,name,mimeType,webViewLink',
                });
                return res.data;
            }

            // Text-based file — create with content body
            const content = this.resolver.resolveTemplate(config.content ?? '', context);
            const res = await drive.files.create({
                requestBody,
                media:  { mimeType, body: Readable.from([content]) },
                fields: 'id,name,mimeType,webViewLink',
            });
            return res.data;
        }

        // ── copy_file ─────────────────────────────────────────────────────────

        if (action === 'copy_file') {
            const fileId = this.resolver.resolveTemplate(config.fileId ?? '', context);
            if (!fileId) throw new Error('Google Drive copy file: fileId is required');

            const requestBody: { name?: string; parents?: string[] } = {};
            if (config.newName) {
                requestBody.name = this.resolver.resolveTemplate(config.newName, context);
            }
            const destFolderId = config.destinationFolderId
                ? this.resolver.resolveTemplate(config.destinationFolderId, context)
                : undefined;
            if (destFolderId) requestBody.parents = [destFolderId];

            const res = await drive.files.copy({
                fileId,
                requestBody,
                fields: 'id,name,mimeType,webViewLink',
                supportsAllDrives: true,
            });
            return res.data;
        }

        // ── delete_file ───────────────────────────────────────────────────────

        if (action === 'delete_file') {
            const fileId = this.resolver.resolveTemplate(config.fileId ?? '', context);
            if (!fileId) throw new Error('Google Drive delete file: fileId is required');

            if (config.permanent) {
                await drive.files.delete({ fileId, supportsAllDrives: true });
                return { deleted: true, permanent: true, fileId };
            } else {
                const res = await drive.files.update({
                    fileId,
                    requestBody: { trashed: true },
                    fields:      'id,name,trashed',
                    supportsAllDrives: true,
                });
                return { deleted: true, permanent: false, movedToTrash: true, fileId: res.data.id, name: res.data.name };
            }
        }

        // ── move_file ─────────────────────────────────────────────────────────

        if (action === 'move_file') {
            const fileId = this.resolver.resolveTemplate(config.fileId ?? '', context);
            if (!fileId) throw new Error('Google Drive move file: fileId is required');

            const destFolderId = config.destinationFolderId
                ? this.resolver.resolveTemplate(config.destinationFolderId, context)
                : '';
            if (!destFolderId) throw new Error('Google Drive move file: destinationFolderId is required');

            // Retrieve current parents to remove them
            const current = await drive.files.get({ fileId, fields: 'parents', supportsAllDrives: true });
            const previousParents = (current.data.parents ?? []).join(',');

            const res = await drive.files.update({
                fileId,
                addParents:    destFolderId,
                removeParents: previousParents,
                fields:        'id,name,parents,webViewLink',
                supportsAllDrives: true,
                requestBody:   {},
            });
            return { fileId: res.data.id, name: res.data.name, movedTo: destFolderId };
        }

        // ── share_file ────────────────────────────────────────────────────────

        if (action === 'share_file') {
            const fileId = this.resolver.resolveTemplate(config.fileId ?? '', context);
            if (!fileId) throw new Error('Google Drive share file: fileId is required');

            return config.shareMode === 'restrict'
                ? this.applyRestrict(drive, fileId, config, context)
                : this.applyShare(drive, fileId, config, context);
        }

        // ── update_file ───────────────────────────────────────────────────────

        if (action === 'update_file') {
            const fileId = this.resolver.resolveTemplate(config.fileId ?? '', context);
            if (!fileId) throw new Error('Google Drive update file: fileId is required');

            const content  = this.resolver.resolveTemplate(config.content ?? '', context);
            const meta     = await drive.files.get({ fileId, fields: 'mimeType' });
            const mimeType = meta.data.mimeType ?? 'text/plain';

            const res = await drive.files.update({
                fileId,
                media:  { mimeType, body: Readable.from([content]) },
                fields: 'id,name,mimeType,modifiedTime,webViewLink',
                supportsAllDrives: true,
                requestBody: {},
            });
            return res.data;
        }

        // ── rename_file ───────────────────────────────────────────────────────

        if (action === 'rename_file') {
            const fileId  = this.resolver.resolveTemplate(config.fileId ?? '', context);
            if (!fileId) throw new Error('Google Drive rename file: fileId is required');

            const newName = this.resolver.resolveTemplate(config.newName ?? '', context);
            if (!newName) throw new Error('Google Drive rename file: newName is required');

            const res = await drive.files.update({
                fileId,
                requestBody: { name: newName },
                fields:      'id,name,mimeType,webViewLink',
                supportsAllDrives: true,
            });
            return { fileId: res.data.id, newName: res.data.name, webViewLink: res.data.webViewLink };
        }

        // ── create_folder ─────────────────────────────────────────────────────

        if (action === 'create_folder') {
            const folderName     = this.resolver.resolveTemplate(config.folderName ?? 'New Folder', context);
            const parentFolderId = config.parentFolderId
                ? this.resolver.resolveTemplate(config.parentFolderId, context)
                : undefined;

            const requestBody: { name: string; mimeType: string; parents?: string[] } = {
                name:     folderName,
                mimeType: 'application/vnd.google-apps.folder',
            };
            if (parentFolderId) requestBody.parents = [parentFolderId];

            const res = await drive.files.create({
                requestBody,
                fields: 'id,name,webViewLink,parents',
            });
            return { folderId: res.data.id, name: res.data.name, webViewLink: res.data.webViewLink };
        }

        // ── delete_folder ─────────────────────────────────────────────────────

        if (action === 'delete_folder') {
            const folderId = this.resolver.resolveTemplate(config.folderId ?? '', context);
            if (!folderId) throw new Error('Google Drive delete folder: folderId is required');

            if (config.permanent) {
                await drive.files.delete({ fileId: folderId });
                return { deleted: true, permanent: true, folderId };
            } else {
                const res = await drive.files.update({
                    fileId:      folderId,
                    requestBody: { trashed: true },
                    fields:      'id,name,trashed',
                });
                return { deleted: true, permanent: false, movedToTrash: true, folderId: res.data.id, name: res.data.name };
            }
        }

        // ── share_folder ──────────────────────────────────────────────────────

        if (action === 'share_folder') {
            const folderId = this.resolver.resolveTemplate(config.folderId ?? '', context);
            if (!folderId) throw new Error('Google Drive share folder: folderId is required');

            return config.shareMode === 'restrict'
                ? this.applyRestrict(drive, folderId, config, context)
                : this.applyShare(drive, folderId, config, context);
        }

        throw new Error(`Google Drive node: unknown action "${action}"`);
    }

    /** Shared permission-creation logic for both share_file and share_folder. */
    private async applyShare(
        drive: ReturnType<typeof google.drive>,
        targetId: string,
        config: GDriveConfig,
        context: ExecutionContext,
    ): Promise<unknown> {
        const shareType  = config.shareType  ?? 'user';
        const shareRole  = config.shareRole  ?? 'reader';
        const shareEmail = config.shareEmail
            ? this.resolver.resolveTemplate(config.shareEmail, context)
            : undefined;

        const permBody: { role: string; type: string; emailAddress?: string } = {
            role: shareRole,
            type: shareType,
        };
        if (shareType !== 'anyone' && shareEmail) permBody.emailAddress = shareEmail;

        const res = await drive.permissions.create({
            fileId:                targetId,
            requestBody:           permBody,
            sendNotificationEmail: (config.sendNotification !== false) && shareType === 'user',
            supportsAllDrives:     true,
            fields:                'id,role,type,emailAddress',
        });

        return {
            targetId,
            shared:       true,
            permissionId: res.data.id,
            role:         res.data.role,
            type:         res.data.type,
            email:        res.data.emailAddress,
        };
    }

    /** Remove one or all permissions — used by share_file / share_folder in restrict mode. */
    private async applyRestrict(
        drive: ReturnType<typeof google.drive>,
        targetId: string,
        config: GDriveConfig,
        context: ExecutionContext,
    ): Promise<unknown> {
        const restrictType = config.restrictType ?? 'user';

        const permsRes = await drive.permissions.list({
            fileId:            targetId,
            fields:            'permissions(id,role,type,emailAddress)',
            supportsAllDrives: true,
        });
        const permissions = permsRes.data.permissions ?? [];

        if (restrictType === 'user') {
            const email = config.shareEmail
                ? this.resolver.resolveTemplate(config.shareEmail, context).trim().toLowerCase()
                : '';
            if (!email) throw new Error('Google Drive restrict: an email address is required to remove a specific user');

            const perm = permissions.find(
                p => p.emailAddress?.toLowerCase() === email && p.role !== 'owner',
            );
            if (!perm) throw new Error(`Google Drive restrict: no removable permission found for ${email}`);

            await drive.permissions.delete({
                fileId:            targetId,
                permissionId:      perm.id!,
                supportsAllDrives: true,
            });
            return { targetId, restricted: true, removedEmail: email, permissionId: perm.id };
        }

        if (restrictType === 'anyone') {
            const perm = permissions.find(p => p.type === 'anyone');
            if (!perm) return { targetId, restricted: true, note: 'No public link permission was present' };

            await drive.permissions.delete({
                fileId:            targetId,
                permissionId:      perm.id!,
                supportsAllDrives: true,
            });
            return { targetId, restricted: true, removedType: 'anyone', permissionId: perm.id };
        }

        if (restrictType === 'all') {
            const toRemove = permissions.filter(p => p.role !== 'owner');
            await Promise.all(
                toRemove.map(p =>
                    drive.permissions.delete({
                        fileId:            targetId,
                        permissionId:      p.id!,
                        supportsAllDrives: true,
                    }),
                ),
            );
            return { targetId, restricted: true, removedCount: toRemove.length };
        }

        throw new Error(`Google Drive restrict: unknown restrictType "${restrictType}"`);
    }
}
