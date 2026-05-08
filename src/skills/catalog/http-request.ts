import type { Skill } from '../types';

export const skill: Skill = {
    name: 'http-request',
    title: 'HTTP Request',
    summary: 'Make an arbitrary HTTP request to any API or webhook.',
    whenToUse:
        'Use when the user wants to call an external HTTP API that does not have ' +
        'a dedicated Flux integration — e.g. third-party REST APIs, webhooks, or ' +
        'private internal services.',
    keywords: ['http', 'api', 'request', 'rest', 'fetch', 'webhook', 'get', 'post', 'put', 'delete'],
    category: 'integration',
    nodeType: 'http',
    body: `
# HTTP Request

Sends a request to any URL and returns the response.

## Required config
- \`method\` (string): \`"GET" | "POST" | "PUT" | "PATCH" | "DELETE"\`. Default \`"GET"\`.
- \`url\` (string): Full URL. Supports template expressions.

## Optional config
- \`headers\` (object): Key-value header map. Common: \`{ "Content-Type": "application/json", "Authorization": "Bearer ..." }\`.
- \`body\` (string): Request body — typically a JSON string with template expressions.
- \`bodyLanguage\` (\`"json" | "xml" | "html" | "text"\`): Defaults to \`"json"\`.
- \`timeoutMs\` (number): Request timeout in milliseconds.

## Output fields
- \`status\`: HTTP status code
- \`body\`: Parsed response body (JSON if parseable, otherwise string)
- \`headers\`: Response headers

## Example — POST JSON
\`\`\`json
{
  "id": "http-1",
  "type": "http",
  "name": "Notify External API",
  "config": {
    "method": "POST",
    "url": "https://api.example.com/events",
    "headers": { "Content-Type": "application/json", "Authorization": "Bearer xxx" },
    "body": "{ \\"summary\\": \\"{{ nodes.llm-1.content }}\\" }"
  },
  "next": []
}
\`\`\`

## Fluxelle workflow
1. If the user hasn't specified the HTTP method, use \`ask_user\` with options:
   - GET (retrieve data)
   - POST (create / send data)
   - PUT (replace a resource)
   - PATCH (partial update)
   - DELETE (remove a resource)
2. Always populate \`url\` — ask for it if not provided.
3. For authenticated APIs, include the \`Authorization\` header with the correct
   scheme (Bearer token, Basic auth, API key header, etc.).
4. Use template expressions in \`url\` and \`body\` to pass dynamic data from
   upstream nodes.
`,
};
