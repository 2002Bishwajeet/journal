/**
 * Database Operations Integration Tests
 * 
 * These tests use a real in-memory PGlite database - no mocks!
 * They verify that all database functions work correctly.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { createTestDatabase, closeTestDatabase, resetTestDatabase } from './testDb';
import type { DocumentMetadata } from '@/types';
import { MAIN_FOLDER_ID } from '@/lib/homebase';

// We'll create query functions that work with the test database
// instead of importing from the real module (which has a singleton)



// Helper to generate UUIDs for tests
function generateTestId(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

describe('Database Operations', () => {
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
    // Document Updates (Yjs blobs) Tests
    // ============================================
    describe('Document Updates', () => {
        it('should save and retrieve document updates', async () => {
            const docId = generateTestId();
            const updateBlob = new Uint8Array([1, 2, 3, 4, 5]);

            // Save update
            await db.query(
                'INSERT INTO document_updates (doc_id, update_blob) VALUES ($1, $2)',
                [docId, updateBlob]
            );

            // Retrieve updates
            const result = await db.query<{ update_blob: Uint8Array }>(
                'SELECT update_blob FROM document_updates WHERE doc_id = $1 ORDER BY created_at ASC',
                [docId]
            );

            expect(result.rows.length).toBe(1);
            expect(result.rows[0].update_blob).toEqual(updateBlob);
        });

        it('should store multiple updates for same document', async () => {
            const docId = generateTestId();

            // Save multiple updates
            await db.query('INSERT INTO document_updates (doc_id, update_blob) VALUES ($1, $2)', [docId, new Uint8Array([1])]);
            await db.query('INSERT INTO document_updates (doc_id, update_blob) VALUES ($1, $2)', [docId, new Uint8Array([2])]);
            await db.query('INSERT INTO document_updates (doc_id, update_blob) VALUES ($1, $2)', [docId, new Uint8Array([3])]);

            const result = await db.query<{ update_blob: Uint8Array }>(
                'SELECT update_blob FROM document_updates WHERE doc_id = $1 ORDER BY created_at ASC',
                [docId]
            );

            expect(result.rows.length).toBe(3);
        });

        it('should delete all updates for a document', async () => {
            const docId = generateTestId();

            await db.query('INSERT INTO document_updates (doc_id, update_blob) VALUES ($1, $2)', [docId, new Uint8Array([1])]);
            await db.query('INSERT INTO document_updates (doc_id, update_blob) VALUES ($1, $2)', [docId, new Uint8Array([2])]);

            await db.query('DELETE FROM document_updates WHERE doc_id = $1', [docId]);

            const result = await db.query('SELECT * FROM document_updates WHERE doc_id = $1', [docId]);
            expect(result.rows.length).toBe(0);
        });
    });

    // ============================================
    // Search Index Tests
    // ============================================
    describe('Search Index', () => {
        const createTestMetadata = (): DocumentMetadata => ({
            title: 'Test Note',
            folderId: MAIN_FOLDER_ID,
            tags: ['test', 'demo'],
            timestamps: {
                created: new Date().toISOString(),
                modified: new Date().toISOString()
            },
            excludeFromAI: false,
        });

        it('should insert a new search index entry', async () => {
            const docId = generateTestId();
            const metadata = createTestMetadata();

            await db.query(
                `INSERT INTO search_index (doc_id, title, plain_text_content, metadata)
         VALUES ($1, $2, $3, $4)`,
                [docId, 'Test Note', 'This is test content', JSON.stringify(metadata)]
            );

            const result = await db.query<{ doc_id: string; title: string }>(
                'SELECT doc_id, title FROM search_index WHERE doc_id = $1',
                [docId]
            );

            expect(result.rows.length).toBe(1);
            expect(result.rows[0].title).toBe('Test Note');
        });

        it('should upsert (update) existing entry', async () => {
            const docId = generateTestId();
            const metadata = createTestMetadata();

            // Insert
            await db.query(
                `INSERT INTO search_index (doc_id, title, plain_text_content, metadata)
         VALUES ($1, $2, $3, $4)`,
                [docId, 'Original Title', 'Original content', JSON.stringify(metadata)]
            );

            // Update using upsert
            await db.query(
                `INSERT INTO search_index (doc_id, title, plain_text_content, metadata, updated_at)
         VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
         ON CONFLICT (doc_id) DO UPDATE SET
           title = EXCLUDED.title,
           plain_text_content = EXCLUDED.plain_text_content,
           metadata = EXCLUDED.metadata,
           updated_at = CURRENT_TIMESTAMP`,
                [docId, 'Updated Title', 'Updated content', JSON.stringify(metadata)]
            );

            const result = await db.query<{ title: string; plain_text_content: string }>(
                'SELECT title, plain_text_content FROM search_index WHERE doc_id = $1',
                [docId]
            );

            expect(result.rows.length).toBe(1);
            expect(result.rows[0].title).toBe('Updated Title');
            expect(result.rows[0].plain_text_content).toBe('Updated content');
        });

        it('should search by title (case insensitive)', async () => {
            const metadata = createTestMetadata();

            await db.query(
                `INSERT INTO search_index (doc_id, title, plain_text_content, metadata) VALUES ($1, $2, $3, $4)`,
                [generateTestId(), 'Meeting Notes', 'Discussion about project', JSON.stringify(metadata)]
            );
            await db.query(
                `INSERT INTO search_index (doc_id, title, plain_text_content, metadata) VALUES ($1, $2, $3, $4)`,
                [generateTestId(), 'Shopping List', 'Milk, bread, eggs', JSON.stringify(metadata)]
            );
            await db.query(
                `INSERT INTO search_index (doc_id, title, plain_text_content, metadata) VALUES ($1, $2, $3, $4)`,
                [generateTestId(), 'Project meeting summary', 'Summary of meeting', JSON.stringify(metadata)]
            );

            const result = await db.query<{ title: string }>(
                `SELECT title FROM search_index WHERE LOWER(title) LIKE $1`,
                ['%meeting%']
            );

            expect(result.rows.length).toBe(2);
            expect(result.rows.map(r => r.title)).toContain('Meeting Notes');
            expect(result.rows.map(r => r.title)).toContain('Project meeting summary');
        });

        it('should search by content', async () => {
            const metadata = createTestMetadata();

            await db.query(
                `INSERT INTO search_index (doc_id, title, plain_text_content, metadata) VALUES ($1, $2, $3, $4)`,
                [generateTestId(), 'Note 1', 'JavaScript is awesome', JSON.stringify(metadata)]
            );
            await db.query(
                `INSERT INTO search_index (doc_id, title, plain_text_content, metadata) VALUES ($1, $2, $3, $4)`,
                [generateTestId(), 'Note 2', 'Python programming', JSON.stringify(metadata)]
            );
            await db.query(
                `INSERT INTO search_index (doc_id, title, plain_text_content, metadata) VALUES ($1, $2, $3, $4)`,
                [generateTestId(), 'Note 3', 'TypeScript extends JavaScript', JSON.stringify(metadata)]
            );

            const result = await db.query<{ title: string }>(
                `SELECT title FROM search_index WHERE LOWER(plain_text_content) LIKE $1`,
                ['%javascript%']
            );

            expect(result.rows.length).toBe(2);
        });

        it('should filter by folder', async () => {
            const folder1 = generateTestId();
            const folder2 = generateTestId();

            const meta1 = { ...createTestMetadata(), folderId: folder1 };
            const meta2 = { ...createTestMetadata(), folderId: folder2 };

            await db.query(
                `INSERT INTO search_index (doc_id, title, plain_text_content, metadata) VALUES ($1, $2, $3, $4)`,
                [generateTestId(), 'Note in Folder 1', 'Content', JSON.stringify(meta1)]
            );
            await db.query(
                `INSERT INTO search_index (doc_id, title, plain_text_content, metadata) VALUES ($1, $2, $3, $4)`,
                [generateTestId(), 'Another in Folder 1', 'Content', JSON.stringify(meta1)]
            );
            await db.query(
                `INSERT INTO search_index (doc_id, title, plain_text_content, metadata) VALUES ($1, $2, $3, $4)`,
                [generateTestId(), 'Note in Folder 2', 'Content', JSON.stringify(meta2)]
            );

            const result = await db.query<{ title: string }>(
                `SELECT title FROM search_index WHERE metadata->>'folderId' = $1`,
                [folder1]
            );

            expect(result.rows.length).toBe(2);
        });

        it('should store and retrieve vector embeddings', async () => {
            const docId = generateTestId();
            const metadata = createTestMetadata();
            const embedding = [0.1, 0.2, 0.3, 0.4, 0.5];

            await db.query(
                `INSERT INTO search_index (doc_id, title, plain_text_content, metadata) VALUES ($1, $2, $3, $4)`,
                [docId, 'Test', 'Content', JSON.stringify(metadata)]
            );

            await db.query(
                `UPDATE search_index SET vector_embedding = $1 WHERE doc_id = $2`,
                [embedding, docId]
            );

            const result = await db.query<{ vector_embedding: number[] }>(
                `SELECT vector_embedding FROM search_index WHERE doc_id = $1`,
                [docId]
            );

            expect(result.rows.length).toBe(1);
            expect(result.rows[0].vector_embedding).toEqual(embedding);
        });
    });

    // ============================================
    // Folders Tests
    // ============================================
    describe('Folders', () => {
        it('should have Main folder by default', async () => {
            const result = await db.query<{ id: string; name: string }>(
                'SELECT id, name FROM folders WHERE id = $1',
                [MAIN_FOLDER_ID]
            );

            expect(result.rows.length).toBe(1);
            expect(result.rows[0].name).toBe('Main');
        });

        it('should create a new folder', async () => {
            const folderId = generateTestId();

            await db.query(
                'INSERT INTO folders (id, name) VALUES ($1, $2)',
                [folderId, 'Work Projects']
            );

            const result = await db.query<{ name: string }>(
                'SELECT name FROM folders WHERE id = $1',
                [folderId]
            );

            expect(result.rows.length).toBe(1);
            expect(result.rows[0].name).toBe('Work Projects');
        });

        it('should list all folders sorted by name', async () => {
            await db.query('INSERT INTO folders (id, name) VALUES ($1, $2)', [generateTestId(), 'Zebra']);
            await db.query('INSERT INTO folders (id, name) VALUES ($1, $2)', [generateTestId(), 'Apple']);
            await db.query('INSERT INTO folders (id, name) VALUES ($1, $2)', [generateTestId(), 'Banana']);

            const result = await db.query<{ name: string }>(
                'SELECT name FROM folders ORDER BY name ASC'
            );

            const names = result.rows.map(r => r.name);
            expect(names).toEqual(['Apple', 'Banana', 'Main', 'Zebra']);
        });

        it('should delete a folder', async () => {
            const folderId = generateTestId();

            await db.query('INSERT INTO folders (id, name) VALUES ($1, $2)', [folderId, 'To Delete']);
            await db.query('DELETE FROM folders WHERE id = $1', [folderId]);

            const result = await db.query('SELECT * FROM folders WHERE id = $1', [folderId]);
            expect(result.rows.length).toBe(0);
        });

        it('should not allow duplicate folder IDs', async () => {
            const folderId = generateTestId();

            await db.query('INSERT INTO folders (id, name) VALUES ($1, $2)', [folderId, 'First']);

            // This should fail due to PRIMARY KEY constraint
            await expect(
                db.query('INSERT INTO folders (id, name) VALUES ($1, $2)', [folderId, 'Second'])
            ).rejects.toThrow();
        });
    });

    // ============================================
    // Job Queue Tests
    // ============================================
    describe('Job Queue', () => {
        it('should create a new job', async () => {
            const result = await db.query<{ id: number }>(
                `INSERT INTO job_queue (job_type, payload) VALUES ($1, $2) RETURNING id`,
                ['generate_embedding', JSON.stringify({ docId: '123', text: 'test' })]
            );

            expect(result.rows.length).toBe(1);
            expect(result.rows[0].id).toBeDefined();
        });

        it('should default job status to pending', async () => {
            await db.query(
                `INSERT INTO job_queue (job_type, payload) VALUES ($1, $2)`,
                ['generate_embedding', JSON.stringify({ docId: '123' })]
            );

            const result = await db.query<{ status: string }>(
                'SELECT status FROM job_queue WHERE job_type = $1',
                ['generate_embedding']
            );

            expect(result.rows[0].status).toBe('pending');
        });

        it('should update job status', async () => {
            const insertResult = await db.query<{ id: number }>(
                `INSERT INTO job_queue (job_type, payload) VALUES ($1, $2) RETURNING id`,
                ['generate_embedding', JSON.stringify({})]
            );
            const jobId = insertResult.rows[0].id;

            await db.query(
                `UPDATE job_queue SET status = 'processing' WHERE id = $1`,
                [jobId]
            );

            await db.query(
                `UPDATE job_queue SET status = 'completed', processed_at = CURRENT_TIMESTAMP WHERE id = $1`,
                [jobId]
            );

            const result = await db.query<{ status: string; processed_at: Date }>(
                'SELECT status, processed_at FROM job_queue WHERE id = $1',
                [jobId]
            );

            expect(result.rows[0].status).toBe('completed');
            expect(result.rows[0].processed_at).toBeTruthy();
        });

        it('should retrieve pending jobs in order', async () => {
            await db.query(`INSERT INTO job_queue (job_type, payload) VALUES ($1, $2)`, ['type_a', JSON.stringify({ order: 1 })]);
            await db.query(`INSERT INTO job_queue (job_type, payload) VALUES ($1, $2)`, ['type_b', JSON.stringify({ order: 2 })]);
            await db.query(`INSERT INTO job_queue (job_type, payload) VALUES ($1, $2)`, ['type_c', JSON.stringify({ order: 3 })]);

            const result = await db.query<{ job_type: string }>(
                `SELECT job_type FROM job_queue WHERE status = 'pending' ORDER BY created_at ASC`
            );

            expect(result.rows.length).toBe(3);
            expect(result.rows.map(r => r.job_type)).toEqual(['type_a', 'type_b', 'type_c']);
        });

        it('should store error messages for failed jobs', async () => {
            const insertResult = await db.query<{ id: number }>(
                `INSERT INTO job_queue (job_type, payload) VALUES ($1, $2) RETURNING id`,
                ['generate_embedding', JSON.stringify({})]
            );
            const jobId = insertResult.rows[0].id;

            await db.query(
                `UPDATE job_queue SET status = 'failed', error_message = $1 WHERE id = $2`,
                ['Network timeout', jobId]
            );

            const result = await db.query<{ status: string; error_message: string }>(
                'SELECT status, error_message FROM job_queue WHERE id = $1',
                [jobId]
            );

            expect(result.rows[0].status).toBe('failed');
            expect(result.rows[0].error_message).toBe('Network timeout');
        });
    });

    // ============================================
    // App State Tests
    // ============================================
    describe('App State', () => {
        it('should save and retrieve app state', async () => {
            const state = { lastNoteId: '123', lastFolderId: '456' };

            await db.query(
                `INSERT INTO app_state (key, value) VALUES ($1, $2)`,
                ['session', JSON.stringify(state)]
            );

            const result = await db.query<{ value: typeof state }>(
                'SELECT value FROM app_state WHERE key = $1',
                ['session']
            );

            expect(result.rows.length).toBe(1);
            expect(result.rows[0].value).toEqual(state);
        });

        it('should upsert app state', async () => {
            await db.query(
                `INSERT INTO app_state (key, value) VALUES ($1, $2)`,
                ['theme', JSON.stringify({ mode: 'light' })]
            );

            await db.query(
                `INSERT INTO app_state (key, value, updated_at)
         VALUES ($1, $2, CURRENT_TIMESTAMP)
         ON CONFLICT (key) DO UPDATE SET 
           value = EXCLUDED.value,
           updated_at = CURRENT_TIMESTAMP`,
                ['theme', JSON.stringify({ mode: 'dark' })]
            );

            const result = await db.query<{ value: { mode: string } }>(
                'SELECT value FROM app_state WHERE key = $1',
                ['theme']
            );

            expect(result.rows[0].value.mode).toBe('dark');
        });

        it('should delete app state', async () => {
            await db.query(
                `INSERT INTO app_state (key, value) VALUES ($1, $2)`,
                ['temp', JSON.stringify({})]
            );

            await db.query('DELETE FROM app_state WHERE key = $1', ['temp']);

            const result = await db.query('SELECT * FROM app_state WHERE key = $1', ['temp']);
            expect(result.rows.length).toBe(0);
        });
    });

    // ============================================
    // Complex Query Tests (Hybrid Search)
    // ============================================
    describe('Hybrid Search', () => {
        it('should perform combined title and content search', async () => {
            const metadata = {
                title: '',
                folderId: MAIN_FOLDER_ID,
                tags: [],
                timestamps: { created: new Date().toISOString(), modified: new Date().toISOString() },
                excludeFromAI: false,
            };

            // Insert test data
            await db.query(
                `INSERT INTO search_index (doc_id, title, plain_text_content, metadata) VALUES ($1, $2, $3, $4)`,
                [generateTestId(), 'React Tutorial', 'Learn React hooks and components', JSON.stringify(metadata)]
            );
            await db.query(
                `INSERT INTO search_index (doc_id, title, plain_text_content, metadata) VALUES ($1, $2, $3, $4)`,
                [generateTestId(), 'Vue Guide', 'Vue.js state management', JSON.stringify(metadata)]
            );
            await db.query(
                `INSERT INTO search_index (doc_id, title, plain_text_content, metadata) VALUES ($1, $2, $3, $4)`,
                [generateTestId(), 'JavaScript Basics', 'React is built on JavaScript', JSON.stringify(metadata)]
            );

            const searchPattern = '%react%';
            const result = await db.query<{ title: string; title_match: boolean; content_match: boolean }>(
                `SELECT 
            title,
            LOWER(title) LIKE $1 as title_match,
            LOWER(plain_text_content) LIKE $1 as content_match
         FROM search_index 
         WHERE LOWER(title) LIKE $1 OR LOWER(plain_text_content) LIKE $1
         ORDER BY 
           CASE WHEN LOWER(title) LIKE $1 THEN 0 ELSE 1 END,
           title`,
                [searchPattern]
            );

            expect(result.rows.length).toBe(2);
            // Title match should come first
            expect(result.rows[0].title).toBe('React Tutorial');
            expect(result.rows[0].title_match).toBe(true);
            // Content match second
            expect(result.rows[1].title).toBe('JavaScript Basics');
            expect(result.rows[1].content_match).toBe(true);
        });

        it('should calculate result limit correctly', async () => {
            const metadata = {
                title: 'Test',
                folderId: MAIN_FOLDER_ID,
                tags: [],
                timestamps: { created: new Date().toISOString(), modified: new Date().toISOString() },
                excludeFromAI: false,
            };

            // Insert 60 test documents
            for (let i = 0; i < 60; i++) {
                await db.query(
                    `INSERT INTO search_index (doc_id, title, plain_text_content, metadata) VALUES ($1, $2, $3, $4)`,
                    [generateTestId(), `Note ${i}`, 'Common content', JSON.stringify(metadata)]
                );
            }

            const result = await db.query(
                `SELECT title FROM search_index 
         WHERE LOWER(plain_text_content) LIKE $1
         LIMIT 50`,
                ['%common%']
            );

            expect(result.rows.length).toBe(50);
        });
    });
});
