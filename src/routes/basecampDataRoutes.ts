import { FastifyInstance } from 'fastify';
import { BasecampAuthService } from '../services/BasecampAuthService';

const USER_AGENT = 'WorkflowAutomationPlatform (basecamp-integration)';

export async function basecampDataRoutes(
    fastify: FastifyInstance,
    options: { basecampAuth: BasecampAuthService }
): Promise<void> {
    const { basecampAuth } = options;

    async function basecampFetch(credentialId: string, path: string) {
        const token     = await basecampAuth.getToken(credentialId);
        const accountId = await basecampAuth.getAccountId(credentialId);
        const url       = `https://3.basecampapi.com/${accountId}${path}`;

        const res = await fetch(url, {
            headers: {
                Authorization: `Bearer ${token}`,
                'User-Agent':  USER_AGENT,
            },
        });

        if (!res.ok) {
            throw new Error(`Basecamp API error (${res.status}): ${await res.text()}`);
        }

        return res.json();
    }

    /**
     * Fetches all pages of a paginated Basecamp list endpoint.
     * Basecamp signals the next page via a `Link: <url>; rel="next"` header.
     */
    async function basecampFetchAll(credentialId: string, path: string): Promise<Array<Record<string, unknown>>> {
        const token     = await basecampAuth.getToken(credentialId);
        const accountId = await basecampAuth.getAccountId(credentialId);
        let nextUrl: string | null = `https://3.basecampapi.com/${accountId}${path}`;

        const allResults: Array<Record<string, unknown>> = [];

        while (nextUrl) {
            const res: Response = await fetch(nextUrl, {
                headers: {
                    Authorization: `Bearer ${token}`,
                    'User-Agent':  USER_AGENT,
                },
            });

            if (!res.ok) {
                throw new Error(`Basecamp API error (${res.status}): ${await res.text()}`);
            }

            const page = await res.json() as Array<Record<string, unknown>>;
            allResults.push(...page);

            const linkHeader: string = res.headers.get('Link') ?? '';
            const nextMatch: RegExpMatchArray | null = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
            nextUrl = nextMatch ? nextMatch[1] : null;
        }

        return allResults;
    }

    fastify.get<{ Querystring: { credentialId: string } }>(
        '/basecamp/projects',
        async (request, reply) => {
            const { credentialId } = request.query;
            if (!credentialId) return reply.badRequest('credentialId is required');

            const projects = await basecampFetchAll(credentialId, '/projects.json');
            return reply.send(
                projects.map((p) => ({
                    id:   p.id,
                    name: p.name,
                    description: p.description ?? '',
                }))
            );
        }
    );

    fastify.get<{ Querystring: { credentialId: string; projectId: string } }>(
        '/basecamp/todolists',
        async (request, reply) => {
            const { credentialId, projectId } = request.query;
            if (!credentialId) return reply.badRequest('credentialId is required');
            if (!projectId)    return reply.badRequest('projectId is required');

            // Fetch the project to find the todoset tool from the dock
            const project = await basecampFetch(credentialId, `/projects/${projectId}.json`) as {
                dock: Array<{ name: string; id: number; enabled: boolean; url?: string }>;
            };
            const todoset = project.dock.find((d) => d.name === 'todoset' && d.enabled);
            if (!todoset) {
                return reply.send([]);
            }

            const todolists = await basecampFetchAll(credentialId, `/todosets/${todoset.id}/todolists.json`);
            return reply.send(
                todolists.map((tl) => ({
                    id:   tl.id,
                    name: tl.name ?? tl.title,
                    todosRemaining: tl.todos_remaining ?? 0,
                }))
            );
        }
    );

    fastify.get<{ Querystring: { credentialId: string; todolistId: string; status?: string } }>(
        '/basecamp/todos',
        async (request, reply) => {
            const { credentialId, todolistId, status } = request.query;
            if (!credentialId) return reply.badRequest('credentialId is required');
            if (!todolistId)   return reply.badRequest('todolistId is required');

            // Determine which statuses to fetch: 'active' (default), 'completed', or 'all'
            const fetchActive    = status !== 'completed';
            const fetchCompleted = status === 'completed' || status === 'all';

            async function fetchTodosForList(listId: string | number, suffix?: string): Promise<Array<Record<string, unknown>>> {
                const gIdStr    = String(listId);
                const gName     = suffix ?? null;
                const results: Array<Record<string, unknown>> = [];

                if (fetchActive) {
                    const active = await basecampFetchAll(credentialId, `/todolists/${gIdStr}/todos.json`);
                    results.push(...active.map((t): Record<string, unknown> => ({ ...t, _groupId: gName ? listId : null, _groupName: gName })));
                }
                if (fetchCompleted) {
                    const done = await basecampFetchAll(credentialId, `/todolists/${gIdStr}/todos.json?completed=true`);
                    results.push(...done.map((t): Record<string, unknown> => ({ ...t, _groupId: gName ? listId : null, _groupName: gName })));
                }
                return results;
            }

            // Fetch ungrouped (top-level) to-dos
            const topLevelTodos = await fetchTodosForList(todolistId);

            // Fetch groups, then to-dos inside each group
            const groups = await basecampFetchAll(credentialId, `/todolists/${todolistId}/groups.json`);
            const groupedArrays = await Promise.all(
                groups.map((g) => fetchTodosForList(g.id as number, (g.name ?? g.title ?? 'Unnamed Group') as string))
            );
            const groupedTodos = groupedArrays.flat();

            const allTodos: Array<Record<string, unknown>> = [...topLevelTodos, ...groupedTodos];
            return reply.send(
                allTodos.map((t) => ({
                    id:        t.id,
                    title:     t.title ?? t.content,
                    completed: t.completed,
                    dueOn:     t.due_on ?? null,
                    groupId:   t._groupId ?? null,
                    groupName: t._groupName ?? null,
                }))
            );
        }
    );

    /** List groups (sections) within a to-do list */
    fastify.get<{ Querystring: { credentialId: string; todolistId: string } }>(
        '/basecamp/todogroups',
        async (request, reply) => {
            const { credentialId, todolistId } = request.query;
            if (!credentialId) return reply.badRequest('credentialId is required');
            if (!todolistId)   return reply.badRequest('todolistId is required');

            const groups = await basecampFetchAll(credentialId, `/todolists/${todolistId}/groups.json`);
            return reply.send(
                groups.map((g) => ({
                    id:   g.id,
                    name: g.name ?? g.title,
                }))
            );
        }
    );

    fastify.get<{ Querystring: { credentialId: string; projectId?: string } }>(
        '/basecamp/people',
        async (request, reply) => {
            const { credentialId, projectId } = request.query;
            if (!credentialId) return reply.badRequest('credentialId is required');

            const path = projectId
                ? `/projects/${projectId}/people.json`
                : '/people.json';

            const people = await basecampFetchAll(credentialId, path);
            return reply.send(
                people.map((p) => ({
                    id:    p.id,
                    name:  p.name,
                    email: p.email_address ?? '',
                    company: (p.company as Record<string, unknown>)?.name ?? null,
                }))
            );
        }
    );

    /**
     * Derives all unique companies/organizations from the account's people list.
     * Basecamp 3 has no dedicated companies endpoint; company info is embedded in
     * each person object as `{ id, name }`.
     */
    fastify.get<{ Querystring: { credentialId: string } }>(
        '/basecamp/companies',
        async (request, reply) => {
            const { credentialId } = request.query;
            if (!credentialId) return reply.badRequest('credentialId is required');

            const people = await basecampFetchAll(credentialId, '/people.json');

            const seen  = new Map<number, { id: number; name: string }>();
            for (const p of people) {
                const co = p.company as { id?: number; name?: string } | null | undefined;
                if (co?.id && co.name && !seen.has(co.id)) {
                    seen.set(co.id, { id: co.id, name: co.name });
                }
            }

            const companies = [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
            return reply.send(companies);
        }
    );
}
