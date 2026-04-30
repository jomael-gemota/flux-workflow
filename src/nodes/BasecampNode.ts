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
                    throw new Error(`Basecamp attachment upload failed (${uploadRes.status}): ${await uploadRes.text()}`);
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
            if (!res.ok) throw new Error(`Basecamp create_todo failed (${res.status}): ${await res.text()}`);
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
                throw new Error(`Basecamp complete_todo failed (${res.status}): ${await res.text()}`);
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
                throw new Error(`Basecamp uncomplete_todo failed (${res.status}): ${await res.text()}`);
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
            if (!projRes.ok) throw new Error(`Basecamp: failed to fetch project (${projRes.status})`);
            const project = await projRes.json() as { dock: Array<{ name: string; id: number; enabled: boolean }> };
            const board = project.dock.find((d) => d.name === 'message_board' && d.enabled);
            if (!board) throw new Error('Basecamp: Message Board is not enabled for this project.');

            const body = { subject, content: content || '', status: 'active' };
            const res = await fetch(`${baseUrl}/message_boards/${board.id}/messages.json`, {
                method: 'POST', headers, body: JSON.stringify(body),
            });
            if (!res.ok) throw new Error(`Basecamp post_message failed (${res.status}): ${await res.text()}`);
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
            if (!res.ok) throw new Error(`Basecamp post_comment failed (${res.status}): ${await res.text()}`);
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
            if (!projRes.ok) throw new Error(`Basecamp: failed to fetch project (${projRes.status})`);
            const project = await projRes.json() as { dock: Array<{ name: string; id: number; enabled: boolean }> };
            const chat = project.dock.find((d) => d.name === 'chat' && d.enabled);
            if (!chat) throw new Error('Basecamp: Campfire (Chat) is not enabled for this project.');

            const res = await fetch(`${baseUrl}/chats/${chat.id}/lines.json`, {
                method: 'POST', headers, body: JSON.stringify({ content }),
            });
            if (!res.ok) throw new Error(`Basecamp send_campfire failed (${res.status}): ${await res.text()}`);
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
            const email   = this.resolver.resolveTemplate(config.inviteEmail   ?? '', context).trim();
            const name    = this.resolver.resolveTemplate(config.inviteName    ?? '', context).trim();
            const title   = this.resolver.resolveTemplate(config.inviteTitle   ?? '', context).trim();
            const company = this.resolver.resolveTemplate(config.inviteCompany ?? '', context).trim();

            if (!email) throw new Error('Basecamp invite_users: email address is required');
            if (!name)  throw new Error('Basecamp invite_users: name is required');

            const body: Record<string, unknown> = { email_address: email, name };
            if (title)   body.title        = title;
            if (company) body.company_name = company;

            const res = await fetch(`${baseUrl}/people/users.json`, {
                method: 'POST', headers, body: JSON.stringify(body),
            });
            if (!res.ok) throw new Error(`Basecamp invite_users failed (${res.status}): ${await res.text()}`);
            const person = await res.json() as Record<string, unknown>;

            const companyObj = person.company as Record<string, unknown> | undefined;
            return {
                id:      person.id,
                name:    (person.name as string | undefined)          ?? name,
                email:   (person.email_address as string | undefined) ?? email,
                title:   (person.title as string | undefined)         ?? title,
                company: (companyObj?.name as string | undefined)     ?? company,
                status:  'invited',
            };
        }

        throw new Error(`Basecamp node: unknown action "${action}"`);
    }
}
