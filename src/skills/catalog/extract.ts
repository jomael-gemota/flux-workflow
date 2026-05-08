import type { Skill } from '../types';

export const skill: Skill = {
    name: 'extract',
    title: 'Extract — Parse Fields from Text or JSON',
    summary: 'Extract structured fields from text, JSON, or LLM output using regex, patterns, JSONPath, or AI.',
    whenToUse:
        'Use when the user wants to pull specific values out of text or a JSON object — ' +
        '"extract the invoice number from the email body", "get the price from the API response", ' +
        '"parse the name and date from this message". Pairs naturally after an LLM or HTTP node.',
    keywords: ['extract', 'parse', 'regex', 'jsonpath', 'field', 'pull', 'scrape', 'pattern', 'ai', 'structured'],
    category: 'data',
    nodeType: 'extract',
    body: `
# Extract — Parse Fields from Text or JSON

Runs one or more extraction strategies against a source value and outputs
the results as named fields.

## Required config
- \`source\` (string): Expression for the text/object to extract from.
  E.g. \`"{{ nodes.llm-1.content }}"\` or \`"{{ nodes.http-1.body }}"\`.
- \`fields\` (array): One entry per field to extract.

## Field shape
Each field has:
- \`name\` (string): Output key — accessible as \`{{ nodes.<extractId>.<name> }}\`.
- \`strategy\` (object): How to extract the value.
- \`required\` (boolean, optional): Throw if missing. Default \`false\`.
- \`default\` (string, optional): Fallback when not found.
- \`transform\` (\`"trim" | "lower" | "upper" | "normalize-email"\`, optional): Post-processing.

## Strategies

### \`{ "kind": "regex", "pattern": "<regex>", "flags": "i", "group": 1 }\`
Extracts the first match (or a capture group).

### \`{ "kind": "between", "before": "Invoice:", "after": "\\n" }\`
Extracts text between two delimiters.

### \`{ "kind": "labeled", "label": "Amount:", "stopAt": "\\n" }\`
Finds a label and extracts the value after it.

### \`{ "kind": "jsonpath", "path": "$.order.total" }\`
JSONPath expression against a parsed JSON source.

### \`{ "kind": "ai", "description": "The customer email address", "type": "string" }\`
Uses an LLM to extract the value using a natural-language description.
Types: \`"string"\`, \`"number"\`, \`"boolean"\`, \`"string[]"\`.

## Preprocessing (\`preprocess\` field, optional)
- \`"none"\` (default): Use source as-is.
- \`"plain-text"\`: Strip HTML.
- \`"strip-quoted-reply"\`: Remove quoted email content.
- \`"strip-signature"\`: Remove email signature.

## Output
Each \`name\` becomes a key on the node output:
\`{{ nodes.extract-1.invoiceNumber }}\`, \`{{ nodes.extract-1.amount }}\`, etc.

## Fluxelle workflow
1. Ask the user what fields they want to extract.
2. For each field, decide the best strategy:
   - If extracting from JSON → use \`jsonpath\`.
   - If extracting a well-defined labeled value from text → use \`labeled\` or \`between\`.
   - If the value is hard to describe precisely → use \`ai\` strategy.
3. Propose the node with the \`source\` expression pointing to the upstream node.

## Example — extract invoice fields from an email body
\`\`\`json
{
  "id": "extract-1",
  "type": "extract",
  "name": "Parse Invoice Fields",
  "config": {
    "source": "{{ nodes.gmail-read-1.messages[0].body }}",
    "preprocess": "strip-quoted-reply",
    "fields": [
      {
        "name": "invoiceNumber",
        "strategy": { "kind": "labeled", "label": "Invoice #:", "stopAt": "\\n" },
        "transform": "trim"
      },
      {
        "name": "amount",
        "strategy": { "kind": "regex", "pattern": "\\\\$([\\\\d,\\\\.]+)", "group": 1 }
      },
      {
        "name": "dueDate",
        "strategy": { "kind": "ai", "description": "The payment due date in ISO format", "type": "string" }
      }
    ]
  },
  "next": []
}
\`\`\`
`,
};
