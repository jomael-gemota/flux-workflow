import { describe, it, expect } from 'vitest';
import { ExpressionResolver } from '../../engine/ExpressionResolver';
import { ExecutionContext } from '../../types/workflow.types';

function makeContext(variables: Record<string, unknown> = {}): ExecutionContext {
    return { workflowId: 'wf', executionId: 'exec', variables, startedAt: new Date() };
}

describe('ExpressionResolver', () => {
    const resolver = new ExpressionResolver();

    describe('dot notation', () => {
        it('resolves nested field', () => {
            const ctx = makeContext({ 'node-1': { status: 200 } });
            expect(resolver.resolve('nodes.node-1.status', ctx)).toBe(200);
        });

        it('returns undefined for missing field', () => {
            const ctx = makeContext({ 'node-1': { status: 200 } });
            expect(resolver.resolve('nodes.node-1.missing', ctx)).toBeUndefined();
        });

        it('throws for unknown node', () => {
            const ctx = makeContext({});
            expect(() => resolver.resolve('nodes.unknown.output', ctx))
                .toThrow('Node "unknown" has no output in context');
        });

        it('throws for invalid dot notation format', () => {
            const ctx = makeContext({});
            expect(() => resolver.resolve('nodes.only', ctx))
                .toThrow('Invalid dot notation expression');
        });
    });

    describe('JSONPath', () => {
        it('resolves via JSONPath', () => {
            const ctx = makeContext({ 'node-1': { count: 42 } });
            expect(resolver.resolve('$.nodes.node-1.count', ctx)).toBe(42);
        });

        it('returns undefined for non-matching path', () => {
            const ctx = makeContext({ 'node-1': {} });
            expect(resolver.resolve('$.nodes.node-1.missing', ctx)).toBeUndefined();
        });
    });

    describe('literal', () => {
        it('returns literal string unchanged', () => {
            const ctx = makeContext({});
            expect(resolver.resolve('hello', ctx)).toBe('hello');
        });
    });

    describe('{{...}} wrapper stripping', () => {
        it('resolves expression wrapped in {{ }}', () => {
            const ctx = makeContext({ 'node-1': { status: 200 } });
            expect(resolver.resolve('{{nodes.node-1.status}}', ctx)).toBe(200);
        });

        it('handles whitespace inside {{ }}', () => {
            const ctx = makeContext({ 'node-1': { status: 200 } });
            expect(resolver.resolve('{{ nodes.node-1.status }}', ctx)).toBe(200);
        });

        it('returns plain string wrapped in {{ }} that is not an expression', () => {
            const ctx = makeContext({});
            expect(resolver.resolve('{{hello}}', ctx)).toBe('hello');
        });
    });

    describe('array indexing', () => {
        it('resolves body[0] bracket notation on a property', () => {
            const ctx = makeContext({ 'n1': { body: [42, 99] } });
            expect(resolver.resolve('nodes.n1.body[0]', ctx)).toBe(42);
        });

        it('resolves second element body[1]', () => {
            const ctx = makeContext({ 'n1': { body: [42, 99] } });
            expect(resolver.resolve('nodes.n1.body[1]', ctx)).toBe(99);
        });

        it('resolves {{nodes.n1.body[0]}} (wrapper + array index)', () => {
            const ctx = makeContext({ 'n1': { body: [7] } });
            expect(resolver.resolve('{{nodes.n1.body[0]}}', ctx)).toBe(7);
        });

        it('returns undefined for out-of-bounds index', () => {
            const ctx = makeContext({ 'n1': { body: [1] } });
            expect(resolver.resolve('nodes.n1.body[5]', ctx)).toBeUndefined();
        });

        it('throws when property is not an array', () => {
            const ctx = makeContext({ 'n1': { body: { nested: true } } });
            expect(() => resolver.resolve('nodes.n1.body[0]', ctx))
                .toThrow('"body" is not an array');
        });
    });

    describe('resolveTemplate', () => {
        it('replaces {{ }} placeholders', () => {
            const ctx = makeContext({ 'node-1': { name: 'world' } });
            const result = resolver.resolveTemplate('Hello {{ nodes.node-1.name }}!', ctx);
            expect(result).toBe('Hello world!');
        });

        it('returns [missing: ...] placeholder when a referenced node is not in context', () => {
            const ctx = makeContext({});
            const result = resolver.resolveTemplate('Value: {{ nodes.missing.field }}', ctx);
            expect(result).toBe('Value: [missing: nodes.missing.field]');
        });

        it('replaces multiple placeholders', () => {
            const ctx = makeContext({ 'n1': { a: 'foo' }, 'n2': { b: 'bar' } });
            const result = resolver.resolveTemplate('{{ nodes.n1.a }} and {{ nodes.n2.b }}', ctx);
            expect(result).toBe('foo and bar');
        });

        it('serialises object values as JSON instead of [object Object]', () => {
            const ctx = makeContext({ 'n1': { body: { id: 1, name: 'Test' } } });
            const result = resolver.resolveTemplate('Data: {{ nodes.n1.body }}', ctx);
            expect(result).toBe('Data: {"id":1,"name":"Test"}');
        });
    });

    describe('resolveTemplateJson', () => {
        it('JSON-encodes string values so unquoted tokens form valid JSON', () => {
            const ctx = makeContext({ 'n1': { a: 'foo', b: 'bar', c: 'baz' } });
            const result = resolver.resolveTemplateJson(
                '[[{{nodes.n1.a}}, {{nodes.n1.b}}, {{nodes.n1.c}}]]',
                ctx,
            );
            expect(result).toBe('[["foo", "bar", "baz"]]');
            expect(JSON.parse(result)).toEqual([['foo', 'bar', 'baz']]);
        });

        it('leaves numbers and booleans bare', () => {
            const ctx = makeContext({ 'n1': { n: 5, flag: true } });
            const result = resolver.resolveTemplateJson('[{{nodes.n1.n}}, {{nodes.n1.flag}}]', ctx);
            expect(JSON.parse(result)).toEqual([5, true]);
        });

        it('stringifies nested objects/arrays', () => {
            const ctx = makeContext({ 'n1': { obj: { id: 1 } } });
            const result = resolver.resolveTemplateJson('[{{nodes.n1.obj}}]', ctx);
            expect(JSON.parse(result)).toEqual([{ id: 1 }]);
        });

        it('encodes missing references as a quoted placeholder to keep JSON valid', () => {
            const ctx = makeContext({});
            const result = resolver.resolveTemplateJson('[{{nodes.missing.field}}]', ctx);
            expect(JSON.parse(result)).toEqual(['[missing: nodes.missing.field]']);
        });
    });
});
