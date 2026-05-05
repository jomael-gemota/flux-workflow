import { NodeExecutor } from '../engine/NodeExecutor';
import { WorkflowNode, ExecutionContext } from '../types/workflow.types';
import { BasecampAuthService } from '../services/BasecampAuthService';
import { ExpressionResolver } from '../engine/ExpressionResolver';

const USER_AGENT = 'WorkflowAutomationPlatform (basecamp-integration)';

type BasecampAction =
    | 'create_todo'
    | 'complete_todo'
    | 'uncomplete_todo'
    | 'post_message'
    | 'post_comment'
    | 'send_campfire'
    | 'list_todos'
    | 'invite_users'
    | 'remove_user'
    | 'list_organizations';

interface BasecampConfig {
    credentialId: string;
    action: BasecampAction;
    projectId?: string;
    todolistId?: string;
    groupId?: string;
    todoId?: string;
    recordingId?: string;
    // create_todo
    content?: string;
    description?: string;
    assigneeIds?: string;
    dueOn?: string;
    // create_todo — file attachment (populated from a GDrive download node)
    attachmentContent?: string;  // expression resolving to base64 file content
    attachmentName?: string;     // expression resolving to filename
    attachmentMimeType?: string; // expression resolving to MIME type
    // post_message
    subject?: string;
    // list_todos
    completed?: boolean;
    includeCompleted?: boolean;
    // shared
    text?: string;
    // invite_users
    inviteEmail?: string;
    inviteName?: string;
    inviteTitle?: string;
    inviteCompany?: string;
    // remove_user
    removeEmail?: string;
    removeCompany?: string;
    /** Single full-name search (preferred). Supports the three-tier matcher. */
    removeName?: string;
    /** @deprecated Kept for backwards compatibility with workflows that
     * pre-date the unified `removeName` field. New workflows should use
     * `removeName` instead. When `removeName` is empty, these two are
     * combined as a single name. */
    removeFirstName?: string;
    removeLastName?: string;
}

/**
 * Normalise a date string to YYYY-MM-DD as required by the Basecamp API.
 * Handles the most common spreadsheet formats (M/D/YYYY, MM/DD/YYYY) as well
 * as values that are already in the correct format.  Returns an empty string
 * when the input is empty or cannot be parsed.
 */
function normalizeDueDate(raw: string): string {
    const trimmed = raw.trim();
    if (!trimmed) return '';

    // Already YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;

    // M/D/YYYY or MM/DD/YYYY (typical US spreadsheet / Google Sheets format)
    const usSlash = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (usSlash) {
        const [, m, d, y] = usSlash;
        return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
    }

    // D-M-YYYY or M-D-YYYY with dashes (e.g. 4-23-2026)
    const dashDate = trimmed.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
    if (dashDate) {
        const [, m, d, y] = dashDate;
        return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
    }

    // Fallback: let JavaScript parse it (handles "April 23, 2026", ISO strings, etc.)
    // Use UTC to avoid timezone-shift issues when extracting the date parts.
    const parsed = new Date(trimmed);
    if (!isNaN(parsed.getTime())) {
        const y = parsed.getUTCFullYear();
        const mo = String(parsed.getUTCMonth() + 1).padStart(2, '0');
        const d  = String(parsed.getUTCDate()).padStart(2, '0');
        return `${y}-${mo}-${d}`;
    }

    return trimmed; // Return as-is; let the API reject with a clear error
}

/**
 * Extracts a concise, human-readable error description from a failed Basecamp
 * response.  Basecamp occasionally returns full HTML error pages (e.g. their
 * generic 404 page) instead of JSON.  This helper strips those down to the
 * visible heading text and falls back gracefully for JSON or plain-text bodies.
 */
async function extractBasecampError(res: Response): Promise<string> {
    const contentType = res.headers.get('content-type') ?? '';
    const body = await res.text();

    const looksLikeHtml =
        contentType.includes('text/html') ||
        body.trimStart().startsWith('<!DOCTYPE') ||
        body.trimStart().startsWith('<html');

    if (looksLikeHtml) {
        // Prefer the prominent <h3> heading Basecamp puts on error pages
        const h3 = body.match(/<h3[^>]*>\s*([^<]+?)\s*<\/h3>/i);
        if (h3) return h3[1].trim();
        // Fall back to the <title> tag
        const title = body.match(/<title>\s*([^<]+?)\s*<\/title>/i);
        if (title) return title[1].trim();
        return 'Basecamp returned an HTML error page (no JSON details available)';
    }

    // JSON body — pull out the first recognisable error field
    try {
        const json = JSON.parse(body) as Record<string, unknown>;
        const msg = json['error'] ?? json['message'] ?? json['errors'];
        if (msg) return typeof msg === 'string' ? msg : JSON.stringify(msg);
    } catch {
        // not JSON — fall through
    }

    return body || `HTTP ${res.status}`;
}

export class BasecampNode implements NodeExecutor {
    private auth: BasecampAuthService;
    private resolver = new ExpressionResolver();

    constructor(auth: BasecampAuthService) {
        this.auth = auth;
    }

    /** Follows Basecamp's Link: rel="next" pagination headers and collects all pages. */
    private async fetchAllPages(
        startUrl: string,
        headers: Record<string, string>,
    ): Promise<Array<Record<string, unknown>>> {
        const results: Array<Record<string, unknown>> = [];
        let nextUrl: string | null = startUrl;
        while (nextUrl) {
            const r: Response = await fetch(nextUrl, { headers });
            if (!r.ok) break;
            const page = await r.json() as Array<Record<string, unknown>>;
            results.push(...page);
            const linkHeader: string = r.headers.get('Link') ?? '';
            const nextMatch: RegExpMatchArray | null = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
            nextUrl = nextMatch ? nextMatch[1] : null;
        }
        return results;
    }

    /**
     * Returns `raw` unchanged when it is already a numeric Basecamp ID.
     * Otherwise fetches all projects and returns the ID of the first project
     * whose name matches `raw` (case-insensitive). Falls back to `raw` when
     * no match is found so the API returns a clear error.
     */
    private async resolveProjectId(
        raw: string,
        baseUrl: string,
        headers: Record<string, string>,
    ): Promise<string> {
        if (!raw || /^\d+$/.test(raw.trim())) return raw;
        const projects = await this.fetchAllPages(`${baseUrl}/projects.json`, headers);
        const needle   = raw.trim().toLowerCase();
        const match    = projects.find((p) => String(p.name ?? '').toLowerCase() === needle);
        return match ? String(match.id) : raw;
    }

    /**
     * Returns `raw` unchanged when it is already a numeric Basecamp ID.
     * Otherwise fetches the project's todoset todolists and returns the ID of
     * the first todolist whose name matches `raw` (case-insensitive).
     * Requires a resolved numeric `projectId`.
     */
    private async resolveTodolistId(
        raw: string,
        projectId: string,
        baseUrl: string,
        headers: Record<string, string>,
    ): Promise<string> {
        if (!raw || /^\d+$/.test(raw.trim())) return raw;
        if (!projectId || !/^\d+$/.test(projectId.trim())) return raw;
        const projRes = await fetch(`${baseUrl}/projects/${projectId}.json`, { headers });
        if (!projRes.ok) return raw;
        const project  = await projRes.json() as { dock: Array<{ name: string; id: number; enabled: boolean }> };
        const todoset  = project.dock.find((d) => d.name === 'todoset' && d.enabled);
        if (!todoset) return raw;
        const todolists = await this.fetchAllPages(`${baseUrl}/todosets/${todoset.id}/todolists.json`, headers);
        const needle    = raw.trim().toLowerCase();
        const match     = todolists.find((tl) => String(tl.name ?? tl.title ?? '').toLowerCase() === needle);
        return match ? String(match.id) : raw;
    }

    /**
     * Returns `raw` unchanged when it is already a numeric Basecamp ID.
     * Otherwise fetches the todolist's groups and returns the ID of the first
     * group whose name/title matches `raw` (case-insensitive).
     * Requires a resolved numeric `todolistId`.
     */
    private async resolveGroupId(
        raw: string,
        todolistId: string,
        baseUrl: string,
        headers: Record<string, string>,
    ): Promise<string> {
        if (!raw || /^\d+$/.test(raw.trim())) return raw;
        if (!todolistId || !/^\d+$/.test(todolistId.trim())) return raw;
        const groups = await this.fetchAllPages(`${baseUrl}/todolists/${todolistId}/groups.json`, headers);
        const needle = raw.trim().toLowerCase();
        const match  = groups.find((g) => String(g.name ?? g.title ?? '').toLowerCase() === needle);
        return match ? String(match.id) : raw;
    }

    async execute(node: WorkflowNode, context: ExecutionContext): Promise<unknown> {
        const config = node.config as unknown as BasecampConfig;
        const { credentialId, action } = config;

        if (!credentialId) throw new Error('Basecamp node: credentialId is required');
        if (!action)       throw new Error('Basecamp node: action is required');

        const token     = await this.auth.getToken(credentialId);
        const accountId = await this.auth.getAccountId(credentialId);
        const baseUrl   = `https://3.basecampapi.com/${accountId}`;

        const headers = {
            Authorization:  `Bearer ${token}`,
            'Content-Type': 'application/json; charset=utf-8',
            'User-Agent':   USER_AGENT,
        };

        if (action === 'create_todo') {
            // Resolve project → todolist → group, each supporting name or numeric ID
            const projectId  = await this.resolveProjectId(
                this.resolver.resolveTemplate(config.projectId  ?? '', context), baseUrl, headers,
            );
            const todolistId = await this.resolveTodolistId(
                this.resolver.resolveTemplate(config.todolistId ?? '', context), projectId, baseUrl, headers,
            );
            const groupId    = await this.resolveGroupId(
                this.resolver.resolveTemplate(config.groupId    ?? '', context), todolistId, baseUrl, headers,
            );
            const content    = this.resolver.resolveTemplate(config.content ?? '', context);
            if (!todolistId) throw new Error('Basecamp create_todo: todolistId is required');
            if (!content)    throw new Error('Basecamp create_todo: content is required');

            let description = this.resolver.resolveTemplate(config.description ?? '', context);
            const dueOn       = normalizeDueDate(this.resolver.resolveTemplate(config.dueOn ?? '', context));
            const rawAssignees = this.resolver.resolveTemplate(config.assigneeIds ?? '', context);
            // Strip JSON array brackets in case the variable resolved to e.g. "[123,456]"
            const normalizedAssignees = rawAssignees.replace(/^\[|\]$/g, '');
            // Split on any mix of commas, semicolons, or whitespace as delimiters
            const rawTokens = normalizedAssignees
                ? normalizedAssignees.split(/[\s,;]+/).map((t) => t.trim()).filter(Boolean)
                : [];

            const assigneeIds: number[] = [];
            if (rawTokens.length > 0) {
                const emailTokens = rawTokens.filter((t) => t.includes('@'));
                const idTokens    = rawTokens.filter((t) => !t.includes('@'));

                // Numeric IDs — use directly
                for (const t of idTokens) {
                    const n = Number(t);
                    if (n) assigneeIds.push(n);
                }

                // Email addresses — look up person IDs from the project's people list
                if (emailTokens.length > 0) {
                    const peoplePath = projectId
                        ? `/projects/${projectId}/people.json`
                        : '/people.json';
                    const people = await this.fetchAllPages(`${baseUrl}${peoplePath}`, headers);
                    const emailToId = new Map(
                        people.map((p) => [(p.email_address as string ?? '').toLowerCase(), p.id as number])
                    );
                    for (const email of emailTokens) {
                        const id = emailToId.get(email.toLowerCase());
                        if (id) assigneeIds.push(id);
                    }
                }
            }

            // ── optional file attachment ───────────────────────────────────────
            // When attachment fields are configured (typically from a preceding
            // GDrive download node), upload the file to Basecamp's Attachments
            // API first, then embed the returned sgid in the description as a
            // rich-text <bc-attachment> tag.
            const rawAttachmentContent  = config.attachmentContent
                ? this.resolver.resolveTemplate(config.attachmentContent, context)
                : '';
            const attachmentName     = config.attachmentName
                ? this.resolver.resolveTemplate(config.attachmentName, context).trim()
                : 'attachment';
            const attachmentMimeType = config.attachmentMimeType
                ? this.resolver.resolveTemplate(config.attachmentMimeType, context).trim()
                : 'application/octet-stream';

            if (rawAttachmentContent) {
                // The GDrive download node returns content as base64 for binary
                // files.  Decode to raw bytes before uploading.
                const fileBuffer = Buffer.from(rawAttachmentContent, 'base64');

                const uploadRes = await fetch(`${baseUrl}/attachments.json?name=${encodeURIComponent(attachmentName)}`, {
                    method:  'POST',
                    headers: {
                        Authorization:    `Bearer ${token}`,
                        'Content-Type':   attachmentMimeType,
                        'Content-Length': String(fileBuffer.length),
                        'User-Agent':     USER_AGENT,
                    },
                    body: fileBuffer,
                });
                if (!uploadRes.ok) {
                    throw new Error(`Basecamp attachment upload failed (${uploadRes.status}): ${await extractBasecampError(uploadRes)}`);
                }
                const uploaded = await uploadRes.json() as { attachable_sgid: string };
                const sgid = uploaded.attachable_sgid;

                // Append the attachment tag to the description (rich text / HTML)
                const attachTag = `<bc-attachment sgid="${sgid}" caption="${attachmentName}"></bc-attachment>`;
                description = description
                    ? `${description}\n${attachTag}`
                    : attachTag;
            }
            // ──────────────────────────────────────────────────────────────────

            const body: Record<string, unknown> = { content };
            if (description) body.description = description;
            if (dueOn)       body.due_on = dueOn;
            if (assigneeIds.length > 0) {
                body.assignee_ids = assigneeIds;
                body.notify = true;
            }

            // Post to the group if specified, otherwise to the top-level to-do list
            const targetId = groupId || todolistId;
            const res = await fetch(`${baseUrl}/todolists/${targetId}/todos.json`, {
                method: 'POST', headers, body: JSON.stringify(body),
            });
            if (!res.ok) throw new Error(`Basecamp create_todo failed (${res.status}): ${await extractBasecampError(res)}`);
            const todo = await res.json() as Record<string, unknown>;

            // Normalise assignees to a simple [{id, name, email}] list
            const todoAssignees = ((todo.assignees as Array<Record<string, unknown>>) ?? []).map((a) => ({
                id:    a.id,
                name:  a.name,
                email: a.email_address,
            }));

            return {
                id:          todo.id,
                title:       content,
                description: (todo.description as string) ?? description ?? '',
                status:      'created',
                appUrl:      todo.app_url,
                url:         todo.url,
                dueOn:       todo.due_on ?? (dueOn || null),
                assignees:   todoAssignees,
                completed:   todo.completed ?? false,
                createdAt:   todo.created_at,
                projectId,
                todolistId:  groupId || todolistId,
            };
        }

        if (action === 'complete_todo') {
            const todoId = this.resolver.resolveTemplate(config.todoId ?? '', context);
            if (!todoId) throw new Error('Basecamp complete_todo: todoId is required');

            const res = await fetch(`${baseUrl}/todos/${todoId}/completion.json`, {
                method: 'POST', headers,
            });
            if (!res.ok && res.status !== 204) {
                throw new Error(`Basecamp complete_todo failed (${res.status}): ${await extractBasecampError(res)}`);
            }
            return { todoId, completed: true };
        }

        if (action === 'uncomplete_todo') {
            const todoId = this.resolver.resolveTemplate(config.todoId ?? '', context);
            if (!todoId) throw new Error('Basecamp uncomplete_todo: todoId is required');

            const res = await fetch(`${baseUrl}/todos/${todoId}/completion.json`, {
                method: 'DELETE', headers,
            });
            if (!res.ok && res.status !== 204) {
                throw new Error(`Basecamp uncomplete_todo failed (${res.status}): ${await extractBasecampError(res)}`);
            }
            return { todoId, completed: false };
        }

        if (action === 'post_message') {
            const projectId = await this.resolveProjectId(
                this.resolver.resolveTemplate(config.projectId ?? '', context), baseUrl, headers,
            );
            const subject   = this.resolver.resolveTemplate(config.subject ?? '', context);
            const content   = this.resolver.resolveTemplate(config.text ?? '', context);
            if (!projectId) throw new Error('Basecamp post_message: projectId is required');
            if (!subject)   throw new Error('Basecamp post_message: subject is required');

            // Fetch project to get message_board ID from the dock
            const projRes = await fetch(`${baseUrl}/projects/${projectId}.json`, { headers });
            if (!projRes.ok) throw new Error(`Basecamp: failed to fetch project (${projRes.status}): ${await extractBasecampError(projRes)}`);
            const project = await projRes.json() as { dock: Array<{ name: string; id: number; enabled: boolean }> };
            const board = project.dock.find((d) => d.name === 'message_board' && d.enabled);
            if (!board) throw new Error('Basecamp: Message Board is not enabled for this project.');

            const body = { subject, content: content || '', status: 'active' };
            const res = await fetch(`${baseUrl}/message_boards/${board.id}/messages.json`, {
                method: 'POST', headers, body: JSON.stringify(body),
            });
            if (!res.ok) throw new Error(`Basecamp post_message failed (${res.status}): ${await extractBasecampError(res)}`);
            const msg = await res.json() as Record<string, unknown>;
            return { id: msg.id, subject, status: 'posted' };
        }

        if (action === 'post_comment') {
            const recordingId = this.resolver.resolveTemplate(config.recordingId ?? '', context);
            const content     = this.resolver.resolveTemplate(config.text ?? '', context);
            if (!recordingId) throw new Error('Basecamp post_comment: recordingId is required');
            if (!content)     throw new Error('Basecamp post_comment: content is required');

            const res = await fetch(`${baseUrl}/recordings/${recordingId}/comments.json`, {
                method: 'POST', headers, body: JSON.stringify({ content }),
            });
            if (!res.ok) throw new Error(`Basecamp post_comment failed (${res.status}): ${await extractBasecampError(res)}`);
            const comment = await res.json() as Record<string, unknown>;
            return { id: comment.id, recordingId, status: 'commented' };
        }

        if (action === 'send_campfire') {
            const projectId = await this.resolveProjectId(
                this.resolver.resolveTemplate(config.projectId ?? '', context), baseUrl, headers,
            );
            const content   = this.resolver.resolveTemplate(config.text ?? '', context);
            if (!projectId) throw new Error('Basecamp send_campfire: projectId is required');
            if (!content)   throw new Error('Basecamp send_campfire: content is required');

            const projRes = await fetch(`${baseUrl}/projects/${projectId}.json`, { headers });
            if (!projRes.ok) throw new Error(`Basecamp: failed to fetch project (${projRes.status}): ${await extractBasecampError(projRes)}`);
            const project = await projRes.json() as { dock: Array<{ name: string; id: number; enabled: boolean }> };
            const chat = project.dock.find((d) => d.name === 'chat' && d.enabled);
            if (!chat) throw new Error('Basecamp: Campfire (Chat) is not enabled for this project.');

            const res = await fetch(`${baseUrl}/chats/${chat.id}/lines.json`, {
                method: 'POST', headers, body: JSON.stringify({ content }),
            });
            if (!res.ok) throw new Error(`Basecamp send_campfire failed (${res.status}): ${await extractBasecampError(res)}`);
            const line = await res.json() as Record<string, unknown>;
            return { id: line.id, status: 'sent' };
        }

        if (action === 'list_todos') {
            const projectId  = await this.resolveProjectId(
                this.resolver.resolveTemplate(config.projectId  ?? '', context), baseUrl, headers,
            );
            const todolistId = await this.resolveTodolistId(
                this.resolver.resolveTemplate(config.todolistId ?? '', context), projectId, baseUrl, headers,
            );
            const groupId    = await this.resolveGroupId(
                this.resolver.resolveTemplate(config.groupId    ?? '', context), todolistId, baseUrl, headers,
            );
            const includeCompleted = Boolean(config.includeCompleted);
            if (!todolistId) throw new Error('Basecamp list_todos: todolistId is required');

            const suffixes = [''];
            if (includeCompleted) suffixes.push('?completed=true');

            const fetchAllPages = this.fetchAllPages.bind(this);

            async function fetchTodos(
                url: string,
                hdrs: Record<string, string>,
                groupName?: string,
            ): Promise<Array<Record<string, unknown>>> {
                const results: Array<Record<string, unknown>> = [];
                for (const qs of suffixes) {
                    const items = await fetchAllPages(`${url}${qs}`, hdrs);
                    results.push(...items.map((t) => (groupName ? { ...t, _groupName: groupName } : t)));
                }
                return results;
            }

            let allTodos: Array<Record<string, unknown>>;

            if (groupId) {
                const groups = await fetchAllPages(`${baseUrl}/todolists/${todolistId}/groups.json`, headers);
                let groupName = 'Group';
                const match = groups.find((g) => String(g.id) === groupId);
                if (match) groupName = (match.name ?? match.title ?? 'Group') as string;
                allTodos = await fetchTodos(
                    `${baseUrl}/todolists/${groupId}/todos.json`, headers, groupName,
                );
            } else {
                const topTodos = await fetchTodos(
                    `${baseUrl}/todolists/${todolistId}/todos.json`, headers,
                );

                const groups = await fetchAllPages(`${baseUrl}/todolists/${todolistId}/groups.json`, headers);
                const nested = await Promise.all(
                    groups.map((g) =>
                        fetchTodos(
                            `${baseUrl}/todolists/${g.id}/todos.json`,
                            headers,
                            (g.name ?? g.title ?? 'Unnamed Group') as string,
                        )
                    )
                );

                allTodos = [...topTodos, ...nested.flat()];
            }

            return {
                todos: allTodos.map((t) => ({
                    id:        t.id,
                    title:     t.title ?? t.content,
                    completed: t.completed,
                    dueOn:     t.due_on,
                    group:     (t as Record<string, unknown>)._groupName ?? null,
                    assignees: ((t.assignees as Array<{ id: number; name: string }>) ?? []).map((a) => ({ id: a.id, name: a.name })),
                })),
                count: allTodos.length,
            };
        }

        if (action === 'list_organizations') {
            // Basecamp 3 has no dedicated companies endpoint.
            // Companies are embedded in each person object as { id, name }.
            // Fetch all account people and derive the unique company list.
            const people = await this.fetchAllPages(`${baseUrl}/people.json`, headers);

            const seen = new Map<number, { id: number; name: string }>();
            for (const p of people) {
                const co = p.company as { id?: number; name?: string } | null | undefined;
                if (co?.id && co.name && !seen.has(co.id)) {
                    seen.set(co.id, { id: co.id, name: String(co.name) });
                }
            }

            const organizations = [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
            return { organizations, count: organizations.length };
        }

        if (action === 'invite_users') {
            // Basecamp 3 has no organization-wide invite endpoint.
            // The only way to add a new person is via the project access endpoint:
            //   PUT /projects/{projectId}/people/users.json  with a `create` array.
            // Granting them access to a project automatically adds them to the
            // organization (they receive an invitation email to set up their account).
            //
            // To match the Basecamp website's UX — where you can invite a teammate
            // without picking a project — we auto-select the first available
            // project when none is provided.  The end result is identical: the
            // person becomes an org member; the project is only required as the
            // API transport.
            let projectId = await this.resolveProjectId(
                this.resolver.resolveTemplate(config.projectId ?? '', context), baseUrl, headers,
            );
            const projectWasAutoSelected = !projectId;
            if (!projectId) {
                const allProjects = await this.fetchAllPages(`${baseUrl}/projects.json`, headers);
                const firstProject = allProjects[0];
                if (!firstProject?.id) {
                    throw new Error(
                        'Basecamp invite_users: no Project was provided and no projects were found in the ' +
                        'account to use as the invite container. Create at least one project, or pick a ' +
                        'specific Project in the node settings.'
                    );
                }
                projectId = String(firstProject.id);
            }

            const email   = this.resolver.resolveTemplate(config.inviteEmail   ?? '', context).trim();
            const name    = this.resolver.resolveTemplate(config.inviteName    ?? '', context).trim();
            const title   = this.resolver.resolveTemplate(config.inviteTitle   ?? '', context).trim();
            const company = this.resolver.resolveTemplate(config.inviteCompany ?? '', context).trim();

            if (!email) throw new Error('Basecamp invite_users: email address is required');
            if (!name)  throw new Error('Basecamp invite_users: name is required');

            // ── Trust-but-verify lookup ────────────────────────────────────
            // Basecamp's people endpoints occasionally return "ghost" records
            // for users who were once in the account but have since been
            // removed.  Those ghosts cause `grant` calls to silently no-op.
            // We therefore always re-fetch the project's people list after
            // any grant/create operation and fall back to a fresh `create`
            // if the grant didn't actually take effect.
            const isOnProject = async (): Promise<boolean> => {
                const projectPeople = await this.fetchAllPages(
                    `${baseUrl}/projects/${projectId}/people.json`, headers,
                );
                return projectPeople.some(
                    (p) => String(p.email_address ?? '').toLowerCase() === email.toLowerCase()
                );
            };

            const accountPeople = await this.fetchAllPages(`${baseUrl}/people.json`, headers);
            const existingAccountPerson = accountPeople.find(
                (p) => String(p.email_address ?? '').toLowerCase() === email.toLowerCase()
            );

            // ── Path 1: existing record found — try the grant route ────────
            if (existingAccountPerson) {
                if (await isOnProject()) {
                    const co = existingAccountPerson.company as Record<string, unknown> | undefined;
                    return {
                        id:        existingAccountPerson.id,
                        name:      existingAccountPerson.name,
                        email:     existingAccountPerson.email_address,
                        title:     existingAccountPerson.title,
                        company:   (co?.name as string | undefined) ?? null,
                        status:    'already_member',
                        message:   `${email} is already a member of this organization.`,
                        projectId,
                        projectAutoSelected: projectWasAutoSelected,
                    };
                }

                // Try to grant the existing person access to the project
                const grantRes = await fetch(`${baseUrl}/projects/${projectId}/people/users.json`, {
                    method:  'PUT',
                    headers,
                    body:    JSON.stringify({ grant: [existingAccountPerson.id] }),
                });
                if (!grantRes.ok) {
                    throw new Error(`Basecamp invite_users (grant) failed (${grantRes.status}): ${await extractBasecampError(grantRes)}`);
                }

                // Verify: did the grant actually land them on the project?
                if (await isOnProject()) {
                    const co = existingAccountPerson.company as Record<string, unknown> | undefined;
                    return {
                        id:        existingAccountPerson.id,
                        name:      existingAccountPerson.name,
                        email:     existingAccountPerson.email_address,
                        title:     existingAccountPerson.title,
                        company:   (co?.name as string | undefined) ?? null,
                        status:    'granted_project_access',
                        message:   projectWasAutoSelected
                            ? `${email} was already in the organization. Granted access to the default project (none was specified).`
                            : `${email} was already in the organization. Granted access to this project.`,
                        projectId,
                        projectAutoSelected: projectWasAutoSelected,
                    };
                }

                // Grant returned 200 but nothing changed — Basecamp's people
                // endpoint returned a stale "ghost" of a previously-removed
                // person.  Fall through to the create flow to issue a proper
                // re-invitation that actually shows up in the account.
            }

            // ── Path 2: fresh create (brand-new OR ghost recovery) ─────────
            const newPerson: Record<string, unknown> = { name, email_address: email };
            if (title)   newPerson.title        = title;
            if (company) newPerson.company_name = company;

            const res = await fetch(`${baseUrl}/projects/${projectId}/people/users.json`, {
                method:  'PUT',
                headers,
                body:    JSON.stringify({ create: [newPerson] }),
            });
            if (!res.ok) {
                throw new Error(`Basecamp invite_users failed (${res.status}): ${await extractBasecampError(res)}`);
            }

            const result = await res.json() as { granted?: Array<Record<string, unknown>> };
            const granted = result.granted ?? [];
            // Find the person matching this email (Basecamp returns everyone who
            // was added, which includes both newly-created people and existing ones)
            const created = granted.find(
                (p) => String(p.email_address ?? '').toLowerCase() === email.toLowerCase()
            ) ?? granted[0];

            // Verify: confirm the create actually landed them on the project.
            // If it didn't, throw a clear error rather than reporting a false
            // success — this catches the rare case where Basecamp accepts the
            // request but rejects the email under the hood (e.g. domain
            // restrictions, account-level policies).
            if (!(await isOnProject())) {
                throw new Error(
                    `Basecamp invite_users: invitation for "${email}" was accepted by the API but ` +
                    `the person does not appear in the project's people list afterwards. ` +
                    `This usually means Basecamp rejected the email address (e.g. an account-level ` +
                    `policy or domain restriction). Please verify in Basecamp.`
                );
            }

            if (!created) {
                throw new Error(
                    `Basecamp invite_users: invitation request succeeded but Basecamp returned no person ` +
                    `matching "${email}". This usually means the email address was rejected.`
                );
            }

            const companyObj = created.company as Record<string, unknown> | undefined;
            const recoveredFromGhost = Boolean(existingAccountPerson);
            return {
                id:        created.id,
                name:      (created.name as string | undefined)          ?? name,
                email:     (created.email_address as string | undefined) ?? email,
                title:     (created.title as string | undefined)         ?? title,
                company:   (companyObj?.name as string | undefined)      ?? company,
                status:    recoveredFromGhost ? 'reinvited' : 'invited',
                message:   recoveredFromGhost
                    ? `${email} had a stale record from a previous removal. A fresh invitation has been sent and they now have access to the project.`
                    : undefined,
                projectId,
                projectAutoSelected: projectWasAutoSelected,
            };
        }

        if (action === 'remove_user') {
            const email     = this.resolver.resolveTemplate(config.removeEmail     ?? '', context).trim().toLowerCase();
            const company   = this.resolver.resolveTemplate(config.removeCompany   ?? '', context).trim().toLowerCase();

            // Resolve the unified `removeName` field; fall back to combining the
            // legacy `removeFirstName` + `removeLastName` so existing workflows
            // continue to work without modification.
            const rawName       = this.resolver.resolveTemplate(config.removeName      ?? '', context).trim();
            const rawFirst      = this.resolver.resolveTemplate(config.removeFirstName ?? '', context).trim();
            const rawLast       = this.resolver.resolveTemplate(config.removeLastName  ?? '', context).trim();
            const fullName      = rawName || [rawFirst, rawLast].filter(Boolean).join(' ').trim();
            const fullNameLower = fullName.toLowerCase();

            if (!email && !fullName) {
                throw new Error(
                    'Basecamp remove_user: provide at least an Email Address or a Full Name to search by.'
                );
            }

            // Helper used both before deletion (to filter ghosts) and after a 404
            // (to confirm Basecamp considers the person gone).  GET /people/{id}.json
            // returns 404 when the person has been trashed/removed, even though
            // the same person may still appear in the (occasionally stale)
            // /people.json listing.
            const isPersonStillActive = async (personId: number): Promise<boolean> => {
                const verifyRes = await fetch(`${baseUrl}/people/${personId}.json`, { headers });
                return verifyRes.ok;
            };

            // Fetch all account people once, then filter in memory.
            // Note: /people.json *should* only return active people, but in
            // practice it occasionally returns "ghost" records for users who
            // have already been trashed (see invite_users for the same
            // observation). We verify activeness with a per-candidate GET
            // before attempting the DELETE.
            const people = await this.fetchAllPages(`${baseUrl}/people.json`, headers);

            // Compose a human-readable description of the search criteria for messages
            const criteriaParts: string[] = [];
            if (email)    criteriaParts.push(`email "${email}"`);
            if (fullName) criteriaParts.push(`name "${fullName}"`);
            if (company)  criteriaParts.push(`company "${company}"`);
            const criteriaSummary = criteriaParts.join(' and ');

            // Shape used whenever the search yields no active match — workflows
            // can branch on `status === 'not_found'` rather than catching an error.
            const notFoundResult = {
                id:      null as number | null,
                name:    fullName || null,
                email:   email    || null,
                company: company  || null,
                status:  'not_found' as const,
                message: 'The user does not exist anymore.',
            };

            /**
             * Split a name string into lowercase whitespace-separated tokens.
             * "Jules O. Manguroban" → ["jules", "o.", "manguroban"]
             */
            const tokenize = (full: string): string[] =>
                full.trim().toLowerCase().split(/\s+/).filter(Boolean);

            const searchTokens = tokenize(fullNameLower);

            /**
             * Strict matcher — Basecamp tokens === search tokens (same length,
             * same order, no extras anywhere). The cleanest possible match.
             *
             *   "Jules Manguroban"           → "Jules Manguroban"           ✓
             *   "Sczali Jewess Fe Caintic"   → "Sczali Jewess Fe Caintic"   ✓
             *   "Jules Manguroban"           → "Jules O. Manguroban"        ✗ (lengths differ)
             */
            const nameMatchesStrict = (bcName: string): boolean => {
                const bcTokens = tokenize(bcName);
                if (bcTokens.length !== searchTokens.length) return false;
                return bcTokens.every((t, i) => t === searchTokens[i]);
            };

            /**
             * Subsequence matcher — every search token appears in the Basecamp
             * display name in the SAME ORDER, with arbitrary tokens allowed
             * between them. This is the user-friendly "all words present" rule.
             *
             *   "Sczali Jewess Fe Caintic"   → "Sczali Jewess M. Fe Caintic"   ✓
             *   "Jules Manguroban"           → "Jules O. Manguroban"           ✓
             *   "Mary Anne Smith"            → "Mary Smith"                    ✗ ("anne" missing)
             *
             * Order is preserved on purpose: "Jewess Sczali" should NOT
             * silently match "Sczali Jewess..." — that is almost always a typo
             * or a different person worth surfacing.
             */
            const nameMatchesSubsequence = (bcName: string): boolean => {
                const bcTokens = tokenize(bcName);
                if (searchTokens.length === 0)             return false;
                if (searchTokens.length > bcTokens.length) return false;

                let bcIdx = 0;
                for (const tok of searchTokens) {
                    while (bcIdx < bcTokens.length && bcTokens[bcIdx] !== tok) bcIdx++;
                    if (bcIdx >= bcTokens.length) return false;
                    bcIdx++; // step past the matched token so the next search token must come after
                }
                return true;
            };

            /**
             * Tolerant matcher — last-resort fallback. Compares only the FIRST
             * and LAST tokens of the search to the corresponding ends of the
             * Basecamp display name. Handles the inverse case where the SEARCH
             * has more tokens than the Basecamp record:
             *
             *   "Lawrence Kent P. Daan"      → "Lawrence Daan"   ✓
             *   "Mary Anne Smith"            → "Mary Smith"      ✓
             */
            const nameMatchesTolerant = (bcName: string): boolean => {
                const bcTokens = tokenize(bcName);
                if (bcTokens.length === 0 || searchTokens.length === 0) return false;
                return bcTokens[0] === searchTokens[0] &&
                    bcTokens[bcTokens.length - 1] === searchTokens[searchTokens.length - 1];
            };

            // Apply each filter in sequence — every provided criterion must match.
            let candidates: Array<Record<string, unknown>> = people;
            let nameMatchType: 'exact' | 'partial' | 'tolerant' | undefined;

            if (email) {
                candidates = candidates.filter(
                    (p) => (p.email_address as string ?? '').toLowerCase() === email
                );
            }

            if (fullName) {
                // Tier 1 — clean strict match (search === BC, exact equality)
                const strictMatches = candidates.filter((p) => nameMatchesStrict(String(p.name ?? '')));

                if (strictMatches.length > 0) {
                    candidates = strictMatches;
                    nameMatchType = 'exact';
                } else {
                    // Tier 2 — subsequence match: every search token appears in BC in order
                    const subsequenceMatches = candidates.filter((p) => nameMatchesSubsequence(String(p.name ?? '')));
                    if (subsequenceMatches.length > 0) {
                        candidates = subsequenceMatches;
                        nameMatchType = 'partial';
                    } else {
                        // Tier 3 — tolerant first/last token match (search has more tokens than BC)
                        const tolerantMatches = candidates.filter((p) => nameMatchesTolerant(String(p.name ?? '')));
                        candidates = tolerantMatches;
                        if (tolerantMatches.length > 0) nameMatchType = 'tolerant';
                    }
                }
            }

            if (company) {
                const filtered = candidates.filter((p) => {
                    const co = p.company as { name?: string } | null | undefined;
                    return String(co?.name ?? '').toLowerCase() === company;
                });
                // Only narrow when the company filter actually matches something —
                // otherwise the user gets a more useful "not found" error
                if (filtered.length > 0) candidates = filtered;
            }

            if (candidates.length === 0) {
                // Caller asked us to surface a soft "not found" rather than
                // failing the workflow when nobody matched the search.
                return notFoundResult;
            }

            // Filter out ghost records (people who appear in /people.json but
            // are already trashed). Doing this *after* name/email/company
            // filtering keeps the per-candidate verification cost minimal.
            const activeCandidates: Array<Record<string, unknown>> = [];
            for (const candidate of candidates) {
                const candidateId = candidate.id as number | undefined;
                if (typeof candidateId !== 'number') continue;
                if (await isPersonStillActive(candidateId)) {
                    activeCandidates.push(candidate);
                }
            }

            if (activeCandidates.length === 0) {
                // Every match was a ghost — the user has already been removed.
                return notFoundResult;
            }

            if (activeCandidates.length > 1) {
                const names = activeCandidates
                    .map((p) => {
                        const co = p.company as { name?: string } | null | undefined;
                        const em = p.email_address as string | undefined;
                        return `${p.name}${em ? ` <${em}>` : ''} (${co?.name ?? 'no company'})`;
                    })
                    .join(', ');
                const suggestions: string[] = [];
                if (!email)    suggestions.push('Email Address');
                if (!company)  suggestions.push('Company');
                if (!fullName) suggestions.push('Full Name');
                throw new Error(
                    `Basecamp remove_user: multiple people found with ${criteriaSummary}: ${names}. ` +
                    `Provide ${suggestions.length ? suggestions.join(' or ') : 'additional details'} to disambiguate.`
                );
            }

            const person   = activeCandidates[0];
            const personId = person.id as number;

            // Basecamp 3's documented "trash a person" endpoint is
            //   DELETE /people/{personId}.json
            // (NOT /people/users/{personId}.json — that path doesn't exist and
            // returns Basecamp's generic HTML 404 page, which is what users
            // saw in the wild before this fix.)
            const res = await fetch(`${baseUrl}/people/${personId}.json`, {
                method: 'DELETE', headers,
            });

            // 404 here means a race: the person was trashed between our active-
            // check and the DELETE, OR our token isn't an admin so the endpoint
            // hides them.  Either way the practical result is the same — the
            // user isn't there to remove. Surface it as a soft not-found.
            if (res.status === 404) {
                return notFoundResult;
            }

            // 204 No Content = success; Basecamp also returns 200 in some cases
            if (!res.ok && res.status !== 204) {
                throw new Error(`Basecamp remove_user failed (${res.status}): ${await extractBasecampError(res)}`);
            }

            const coObj = person.company as Record<string, unknown> | null | undefined;
            const matchNote =
                nameMatchType === 'partial'
                    ? `Search "${fullName}" did not match any Basecamp display name exactly, so a ` +
                      `subsequence match (every search token present in order, with extra tokens ` +
                      `allowed in between) was used and resolved to "${String(person.name ?? '')}".`
                : nameMatchType === 'tolerant'
                    ? `Search "${fullName}" did not match any Basecamp display name via strict or ` +
                      `subsequence matching, so a tolerant first-/last-token match was used and ` +
                      `resolved to "${String(person.name ?? '')}".`
                : undefined;

            return {
                id:      personId,
                name:    person.name    as string | undefined,
                email:   person.email_address as string | undefined,
                company: (coObj?.name as string | undefined) ?? null,
                status:  'removed',
                ...(nameMatchType ? { nameMatchType }                : {}),
                ...(matchNote     ? { nameMatchNote: matchNote }      : {}),
            };
        }

        throw new Error(`Basecamp node: unknown action "${action}"`);
    }
}
