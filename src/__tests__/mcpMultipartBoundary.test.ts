/**
 * Under Node, js-lib's bundled (browser) axios sends every drive upload through `fetch` with
 * its hard-coded `content-type: multipart/form-data` and no boundary — only a browser clears
 * that header so the real one is derived from the FormData body. Homebase can't parse such a
 * body and answers 500, so every MCP write (append/replace/create) failed.
 */
import { describe, it, expect, vi } from 'vitest';
import { withMultipartBoundary } from '../../mcp/client';

/** The request exactly as js-lib's axios fetch adapter builds it under Node. */
function axiosLikeUpload(): Request {
    const form = new FormData();
    form.append('instructions', new Blob(['{"a":1}']));
    form.append('payload', new Blob([new Uint8Array([1, 2, 3])]), 'content');
    return new Request('https://id.example/api/apps/v1/drive/files/update', {
        method: 'PATCH',
        headers: { 'Content-Type': 'multipart/form-data' },
        body: form,
    });
}

describe('withMultipartBoundary', () => {
    it('sends a boundary-less multipart upload with the boundary its body uses', async () => {
        expect(axiosLikeUpload().headers.get('content-type')).toBe('multipart/form-data');
        const inner = vi.fn(async (input: RequestInfo | URL) => {
            const request = input as Request;
            const form = await request.formData();
            return new Response(JSON.stringify([...form.keys()]));
        });

        const response = await withMultipartBoundary(inner as typeof fetch)(axiosLikeUpload());

        expect(await response.json()).toEqual(['instructions', 'payload']);
        const sent = inner.mock.calls[0][0] as Request;
        expect(sent.method).toBe('PATCH');
        expect(sent.headers.get('content-type')).toMatch(/^multipart\/form-data; boundary=\S+$/);
    });

    it('passes every other request through untouched', async () => {
        const inner = vi.fn(async () => new Response('ok'));
        const request = new Request('https://id.example/api/apps/v1/drive/query/batch');

        await withMultipartBoundary(inner as typeof fetch)(request);

        expect(inner).toHaveBeenCalledWith(request, undefined);
    });
});
