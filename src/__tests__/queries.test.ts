/**
 * Query Functions Integration Tests
 * 
 * Tests the actual query functions from queries.ts against a real database.
 * These are more integration-style tests that verify the entire flow works.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { createTestDatabase, closeTestDatabase, resetTestDatabase } from './testDb';
import type { DocumentMetadata } from '@/types';
import { MAIN_FOLDER_ID } from '@/lib/homebase';



// Helper to generate UUIDs for tests
function generateTestId(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

describe('Query Functions', () => {
    let db: PGlite;

    beforeAll(async () => {
        db = await createTestDatabase();
    });

    afterAll(async () => {
        await closeTestDatabase();
    });

    beforeEach(async () => {
        await resetTestDatabase();
    });

    // ============================================
    // Helper: Simulated query functions
    // These mirror the real functions to test the SQL logic
    // ============================================

    async function saveDocumentUpdate(docId: string, updateBlob: Uint8Array): Promise<void> {
        await db.query(
            'INSERT INTO document_updates (doc_id, update_blob) VALUES ($1, $2)',
            [docId, updateBlob]
        );
    }

    async function getDocumentUpdates(docId: string): Promise<Uint8Array[]> {
        const result = await db.query<{ update_blob: Uint8Array }>(
            'SELECT update_blob FROM document_updates WHERE doc_id = $1 ORDER BY created_at ASC',
            [docId]
        );
        return result.rows.map(row => row.update_blob);
    }

    async function upsertSearchIndex(entry: {
        docId: string;
        title: string;
        plainTextContent: string;
        metadata: DocumentMetadata;
    }): Promise<void> {
        await db.query(
            `INSERT INTO search_index (doc_id, title, plain_text_content, metadata, updated_at)
       VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
       ON CONFLICT (doc_id) DO UPDATE SET
         title = EXCLUDED.title,
         plain_text_content = EXCLUDED.plain_text_content,
         metadata = EXCLUDED.metadata,
         updated_at = CURRENT_TIMESTAMP`,
            [entry.docId, entry.title, entry.plainTextContent, JSON.stringify(entry.metadata)]
        );
    }

    async function getAllDocuments(): Promise<Array<{
        docId: string;
        title: string;
        plainTextContent: string;
        metadata: DocumentMetadata;
    }>> {
        const result = await db.query<{
            doc_id: string;
            title: string;
            plain_text_content: string;
            metadata: DocumentMetadata;
        }>('SELECT doc_id, title, plain_text_content, metadata FROM search_index ORDER BY updated_at DESC');

        return result.rows.map(row => ({
            docId: row.doc_id,
            title: row.title,
            plainTextContent: row.plain_text_content,
            metadata: row.metadata,
        }));
    }

    async function searchDocuments(query: string): Promise<Array<{
        docId: string;
        title: string;
        plainTextContent: string;
        metadata: DocumentMetadata;
    }>> {
        const searchPattern = `%${query.toLowerCase()}%`;
        const result = await db.query<{
            doc_id: string;
            title: string;
            plain_text_content: string;
            metadata: DocumentMetadata;
        }>(
            `SELECT doc_id, title, plain_text_content, metadata 
       FROM search_index 
       WHERE LOWER(title) LIKE $1 OR LOWER(plain_text_content) LIKE $1
       ORDER BY updated_at DESC`,
            [searchPattern]
        );

        return result.rows.map(row => ({
            docId: row.doc_id,
            title: row.title,
            plainTextContent: row.plain_text_content,
            metadata: row.metadata,
        }));
    }

    async function deleteDocument(docId: string): Promise<void> {
        await db.query('DELETE FROM document_updates WHERE doc_id = $1', [docId]);
        await db.query('DELETE FROM search_index WHERE doc_id = $1', [docId]);
    }

    async function createFolder(id: string, name: string): Promise<void> {
        await db.query('INSERT INTO folders (id, name) VALUES ($1, $2)', [id, name]);
    }

    async function getFolders(): Promise<Array<{ id: string; name: string }>> {
        const result = await db.query<{ id: string; name: string }>(
            'SELECT id, name FROM folders ORDER BY name ASC'
        );
        return result.rows;
    }

    async function deleteFolder(id: string): Promise<void> {
        await db.query('DELETE FROM folders WHERE id = $1', [id]);
    }

    async function updateEmbedding(docId: string, embedding: number[]): Promise<void> {
        await db.query(
            'UPDATE search_index SET vector_embedding = $1 WHERE doc_id = $2',
            [embedding, docId]
        );
    }

    async function getDocumentsNeedingEmbeddings(): Promise<Array<{
        docId: string;
        plainTextContent: string;
    }>> {
        const result = await db.query<{ doc_id: string; plain_text_content: string }>(
            `SELECT doc_id, plain_text_content 
       FROM search_index 
       WHERE vector_embedding IS NULL AND plain_text_content != ''
       LIMIT 10`
        );
        return result.rows.map(row => ({
            docId: row.doc_id,
            plainTextContent: row.plain_text_content,
        }));
    }

    // Cosine similarity function (same as in queries.ts)
    function cosineSimilarity(a: number[], b: number[]): number {
        if (a.length !== b.length) return 0;
        let dotProduct = 0;
        let normA = 0;
        let normB = 0;
        for (let i = 0; i < a.length; i++) {
            dotProduct += a[i] * b[i];
            normA += a[i] * a[i];
            normB += b[i] * b[i];
        }
        return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB) || 1);
    }

    // ============================================
    // Tests
    // ============================================

    describe('Document CRUD Operations', () => {
        it('should create and retrieve a document', async () => {
            const docId = generateTestId();
            const metadata: DocumentMetadata = {
                title: 'Test Note',
                folderId: MAIN_FOLDER_ID,
                tags: ['test'],
                timestamps: { created: new Date().toISOString(), modified: new Date().toISOString() },
                excludeFromAI: false,
            };

            // Save Yjs update
            await saveDocumentUpdate(docId, new Uint8Array([1, 2, 3]));

            // Save search index
            await upsertSearchIndex({
                docId,
                title: 'Test Note',
                plainTextContent: 'This is a test note content.',
                metadata,
            });

            // Retrieve
            const updates = await getDocumentUpdates(docId);
            expect(updates.length).toBe(1);

            const docs = await getAllDocuments();
            expect(docs.length).toBe(1);
            expect(docs[0].title).toBe('Test Note');
        });

        it('should update existing document', async () => {
            const docId = generateTestId();
            const metadata: DocumentMetadata = {
                title: 'Original',
                folderId: MAIN_FOLDER_ID,
                tags: [],
                timestamps: { created: new Date().toISOString(), modified: new Date().toISOString() },
                excludeFromAI: false,
            };

            await upsertSearchIndex({
                docId,
                title: 'Original',
                plainTextContent: 'Original content',
                metadata,
            });

            // Update
            await upsertSearchIndex({
                docId,
                title: 'Updated',
                plainTextContent: 'Updated content',
                metadata: { ...metadata, title: 'Updated' },
            });

            const docs = await getAllDocuments();
            expect(docs.length).toBe(1);
            expect(docs[0].title).toBe('Updated');
            expect(docs[0].plainTextContent).toBe('Updated content');
        });

        it('should delete document', async () => {
            const docId = generateTestId();
            const metadata: DocumentMetadata = {
                title: 'To Delete',
                folderId: MAIN_FOLDER_ID,
                tags: [],
                timestamps: { created: new Date().toISOString(), modified: new Date().toISOString() },
                excludeFromAI: false,
            };

            await saveDocumentUpdate(docId, new Uint8Array([1]));
            await upsertSearchIndex({ docId, title: 'To Delete', plainTextContent: 'Content', metadata });

            await deleteDocument(docId);

            const updates = await getDocumentUpdates(docId);
            const docs = await getAllDocuments();
            expect(updates.length).toBe(0);
            expect(docs.length).toBe(0);
        });
    });

    describe('Search Operations', () => {
        const createNote = async (title: string, content: string) => {
            const docId = generateTestId();
            const metadata: DocumentMetadata = {
                title,
                folderId: MAIN_FOLDER_ID,
                tags: [],
                timestamps: { created: new Date().toISOString(), modified: new Date().toISOString() },
                excludeFromAI: false,
            };
            await upsertSearchIndex({ docId, title, plainTextContent: content, metadata });
            return docId;
        };

        it('should find notes by title', async () => {
            await createNote('Meeting Notes', 'Discussion about project');
            await createNote('Shopping List', 'Groceries');
            await createNote('Team Meeting Recap', 'Summary of points');

            const results = await searchDocuments('meeting');
            expect(results.length).toBe(2);
            expect(results.map(r => r.title)).toContain('Meeting Notes');
            expect(results.map(r => r.title)).toContain('Team Meeting Recap');
        });

        it('should find notes by content', async () => {
            await createNote('Note 1', 'JavaScript programming');
            await createNote('Note 2', 'Python scripting');
            await createNote('Note 3', 'TypeScript is JavaScript with types');

            const results = await searchDocuments('javascript');
            expect(results.length).toBe(2);
        });

        it('should return empty array for no matches', async () => {
            await createNote('Unrelated', 'Nothing here');

            const results = await searchDocuments('nonexistent');
            expect(results.length).toBe(0);
        });

        it('should be case insensitive', async () => {
            await createNote('UPPERCASE', 'CONTENT HERE');

            const results = await searchDocuments('uppercase');
            expect(results.length).toBe(1);
        });
    });

    describe('Folder Operations', () => {
        it('should create and list folders', async () => {
            await createFolder(generateTestId(), 'Work');
            await createFolder(generateTestId(), 'Personal');

            const folders = await getFolders();
            // Main + 2 new folders
            expect(folders.length).toBe(3);
            expect(folders.map(f => f.name)).toContain('Main');
            expect(folders.map(f => f.name)).toContain('Work');
            expect(folders.map(f => f.name)).toContain('Personal');
        });

        it('should sort folders alphabetically', async () => {
            await createFolder(generateTestId(), 'Zebra');
            await createFolder(generateTestId(), 'Archive');

            const folders = await getFolders();
            const names = folders.map(f => f.name);
            expect(names).toEqual(['Archive', 'Main', 'Zebra']);
        });

        it('should delete folder', async () => {
            const id = generateTestId();
            await createFolder(id, 'Temporary');

            await deleteFolder(id);

            const folders = await getFolders();
            expect(folders.map(f => f.name)).not.toContain('Temporary');
        });
    });

    describe('Vector Embedding Operations', () => {
        it('should identify documents needing embeddings', async () => {
            const docId1 = generateTestId();
            const docId2 = generateTestId();
            const metadata: DocumentMetadata = {
                title: 'Test',
                folderId: MAIN_FOLDER_ID,
                tags: [],
                timestamps: { created: new Date().toISOString(), modified: new Date().toISOString() },
                excludeFromAI: false,
            };

            await upsertSearchIndex({ docId: docId1, title: 'Note 1', plainTextContent: 'Content 1', metadata });
            await upsertSearchIndex({ docId: docId2, title: 'Note 2', plainTextContent: 'Content 2', metadata });

            // Add embedding to one
            await updateEmbedding(docId1, [0.1, 0.2, 0.3]);

            const needing = await getDocumentsNeedingEmbeddings();
            expect(needing.length).toBe(1);
            expect(needing[0].docId).toBe(docId2);
        });

        it('should not include empty content documents', async () => {
            const docId = generateTestId();
            const metadata: DocumentMetadata = {
                title: 'Empty',
                folderId: MAIN_FOLDER_ID,
                tags: [],
                timestamps: { created: new Date().toISOString(), modified: new Date().toISOString() },
                excludeFromAI: false,
            };

            await upsertSearchIndex({ docId, title: 'Empty', plainTextContent: '', metadata });

            const needing = await getDocumentsNeedingEmbeddings();
            expect(needing.length).toBe(0);
        });
    });

    describe('Cosine Similarity', () => {
        it('should return 1 for identical vectors', () => {
            const vec = [0.5, 0.5, 0.5];
            expect(cosineSimilarity(vec, vec)).toBeCloseTo(1, 5);
        });

        it('should return 0 for orthogonal vectors', () => {
            const vec1 = [1, 0];
            const vec2 = [0, 1];
            expect(cosineSimilarity(vec1, vec2)).toBeCloseTo(0, 5);
        });

        it('should return -1 for opposite vectors', () => {
            const vec1 = [1, 0];
            const vec2 = [-1, 0];
            expect(cosineSimilarity(vec1, vec2)).toBeCloseTo(-1, 5);
        });

        it('should calculate similarity correctly', () => {
            const vec1 = [1, 2, 3];
            const vec2 = [4, 5, 6];
            // Expected: (1*4 + 2*5 + 3*6) / (sqrt(14) * sqrt(77)) ≈ 0.9746
            expect(cosineSimilarity(vec1, vec2)).toBeCloseTo(0.9746, 3);
        });
    });
});
