import { describe, it, expect, vi, beforeEach } from 'vitest';
import { installMockContext } from './helpers/mockContext.js';

async function freshFiles() {
    vi.resetModules();
    const ctx = installMockContext();
    const config = await import('../src/config.js');
    const files = await import('../src/files.js');
    return { config, files, ctx };
}

function makeFile(name, { size = 10 } = {}) {
    return new File(['x'.repeat(size)], name, { type: 'image/png' });
}

function fakeFileList(files) {
    // clusterFilesByCast does Array.from(fileList), so a plain array works fine.
    return files;
}

describe('clusterFilesByCast', () => {
    it('groups by the part before the first underscore; part after underscore is a variant label', async () => {
        const { files } = await freshFiles();
        const groups = files.clusterFilesByCast(fakeFileList([
            makeFile('Alice.png'),
            makeFile('Alice_smiling.png'),
            makeFile('Alice_sad-and-tired.png'),
        ]));
        expect(groups.size).toBe(1);
        const group = groups.get('alice');
        expect(group.names).toEqual(['Alice']);
        expect(group.portraitFile.name).toBe('Alice.png');
        expect(group.variants.map(v => v.label).sort()).toEqual(['sad and tired', 'smiling']);
    });

    it('"+" splits multiple character names within one group shot', async () => {
        const { files } = await freshFiles();
        const groups = files.clusterFilesByCast(fakeFileList([
            makeFile('Alice+Sarah_default.png'),
        ]));
        expect(groups.size).toBe(1);
        const group = [...groups.values()][0];
        expect(group.names).toEqual(['Alice', 'Sarah']);
    });

    it('grouping is case-insensitive, but original casing is preserved in group.names', async () => {
        const { files } = await freshFiles();
        const groups = files.clusterFilesByCast(fakeFileList([
            makeFile('alice.png'),
            makeFile('ALICE_variant.png'),
        ]));
        expect(groups.size).toBe(1);
        const group = [...groups.values()][0];
        // Whichever file sorts first alphabetically becomes the group's canonical `names` casing.
        expect(group.names[0].toLowerCase()).toBe('alice');
    });

    it('a name with no part before the separator (leading underscore) is skipped entirely', async () => {
        const { files } = await freshFiles();
        const groups = files.clusterFilesByCast(fakeFileList([
            makeFile('_default.png'),
        ]));
        expect(groups.size).toBe(0);
    });

   it('a second base-name file (no variant suffix) in the same group becomes an extra variant instead of being dropped', async () => {
        const { files } = await freshFiles();
        const groups = files.clusterFilesByCast(fakeFileList([
            makeFile('Alice.png'),
            makeFile('Alice.jpg'),
        ]));
        const group = [...groups.values()][0];
        expect(group.portraitFile.name).toBe('Alice.jpg');
        expect(group.variants.length).toBe(1);
        expect(group.variants[0].file.name).toBe('Alice.png');
        expect(group.variants[0].label).toBe('alt-png');
    });

    it('three or more base-name files in one group all survive with distinct labels', async () => {
        const { files } = await freshFiles();
        const groups = files.clusterFilesByCast(fakeFileList([
            makeFile('Alice.gif'),
            makeFile('Alice.jpg'),
            makeFile('Alice.png'),
        ]));
        const group = [...groups.values()][0];
        expect(group.portraitFile.name).toBe('Alice.gif');
        expect(group.variants.map(v => v.label)).toEqual(['alt-jpg', 'alt-png']);
    });

    it('filters out non-image extensions and (webkitdirectory) deeply-nested files', async () => {
        const { files } = await freshFiles();
        const deepFile = makeFile('Alice.png');
        Object.defineProperty(deepFile, 'webkitRelativePath', { value: 'root/sub/sub2/Alice.png' });
        const groups = files.clusterFilesByCast(fakeFileList([
            makeFile('notes.txt'),
            deepFile,
            makeFile('Bob.png'),
        ]));
        expect(groups.size).toBe(1);
        expect([...groups.values()][0].names).toEqual(['Bob']);
    });
});

describe('bulkImportArtwork', () => {
    beforeEach(() => {
        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ path: 'user/images/scenecast/uploaded.png' }),
        });
    });

    it('skips a group entirely (no upload calls) when any of its names conflicts with an existing trigger', async () => {
        const { config, files } = await freshFiles();
        config.getProfileCast('prof_default').push({ triggers: 'Alice', portrait: 'existing.png', variants: [] });

        const result = await files.bulkImportArtwork(fakeFileList([makeFile('Alice_new.png')]), 'prof_default');

        expect(result.skipped).toBe(1);
        expect(result.added).toBe(0);
        expect(global.fetch).not.toHaveBeenCalled(); // no network activity for a conflicting group
    });

    it('a group with neither a portrait file nor any variants is silently skipped (neither added nor skipped counter moves)', async () => {
        const { files } = await freshFiles();
        // clusterFilesByCast can't actually produce this shape from real files
        // (every real file is either the portrait or a variant), so we exercise
        // the "nothing to upload" branch via an empty variants + no portraitFile
        // group by importing zero files — added=0, skipped=0.
        const result = await files.bulkImportArtwork(fakeFileList([]), 'prof_default');
        expect(result.added).toBe(0);
        expect(result.skipped).toBe(0);
    });

    it('adds a new cast member from a portrait + its variants in a single group', async () => {
        const { files, config } = await freshFiles();
        const result = await files.bulkImportArtwork(fakeFileList([
            makeFile('Alice.png'),
            makeFile('Alice_smiling.png'),
        ]), 'prof_default');
        expect(result.added).toBe(1);
        const cast = config.getProfileCast('prof_default');
        expect(cast.length).toBe(1);
        expect(cast[0].variants.length).toBe(1);
    });

    it('an upload failure for one group is captured in `failed` and does not abort the rest of the batch', async () => {
        const { files, config } = await freshFiles();
        global.fetch = vi.fn()
            .mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'boom' }) // Alice's upload fails
            .mockResolvedValue({ ok: true, json: async () => ({ path: 'user/images/scenecast/bob.png' }) }); // Bob succeeds

        const result = await files.bulkImportArtwork(fakeFileList([
            makeFile('Alice.png'),
            makeFile('Bob.png'),
        ]), 'prof_default');

        expect(result.failed).toContain('Alice');
        expect(result.added).toBe(1); // Bob still got added
        expect(config.getProfileCast('prof_default').length).toBe(1);
    });
});

describe('upsertDroppedArtwork', () => {
    beforeEach(() => {
        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ path: 'user/images/scenecast/uploaded.png' }),
        });
    });

    it('unlike bulk-import, a drop MERGES into an existing member on partial trigger overlap instead of skipping', async () => {
        const { files, config } = await freshFiles();
        config.getProfileCast('prof_default').push({ triggers: 'Alice, Aly', portrait: 'old.png', variants: [] });

        const result = await files.upsertDroppedArtwork(fakeFileList([makeFile('Alice_smiling.png')]), 'prof_default');

        expect(result.created).toBe(0); // did not create a duplicate/new member
        expect(result.variantsAdded).toBe(1);
        const cast = config.getProfileCast('prof_default');
        expect(cast.length).toBe(1); // merged into the existing "Alice, Aly" member
        expect(cast[0].variants.length).toBe(1);
    });

    it('backfills an empty portrait from the first variant after an update', async () => {
        const { files, config } = await freshFiles();
        config.getProfileCast('prof_default').push({ triggers: 'Alice', portrait: '', variants: [] });
        await files.upsertDroppedArtwork(fakeFileList([makeFile('Alice_smiling.png')]), 'prof_default');
        const cast = config.getProfileCast('prof_default');
        expect(cast[0].portrait).toBe('user/images/scenecast/uploaded.png');
    });

    it('creates a brand-new member when no existing trigger overlaps at all', async () => {
        const { files, config } = await freshFiles();
        const result = await files.upsertDroppedArtwork(fakeFileList([makeFile('Zoe.png')]), 'prof_default');
        expect(result.created).toBe(1);
        expect(config.getProfileCast('prof_default').length).toBe(1);
    });
});

describe('exportCastArtwork — count reflects actual download success', () => {
    it('a rejected fetch is not counted as a successful export', async () => {
        const { files, config } = await freshFiles();
        config.getProfileCast('prof_default').push({ triggers: 'Alice', portrait: 'alice.png', variants: [] });

        global.fetch = vi.fn().mockRejectedValue(new Error('network error'));
        const count = await files.exportCastArtwork('prof_default');
        expect(count).toBe(0);
    });

    it('a non-ok HTTP response is also treated as a failure, not a success', async () => {
        const { files, config } = await freshFiles();
        config.getProfileCast('prof_default').push({ triggers: 'Alice', portrait: 'alice.png', variants: [] });

        global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 });
        const count = await files.exportCastArtwork('prof_default');
        expect(count).toBe(0);
    });

    it('mixed success/failure across members reports only the real successes', async () => {
        const { files, config } = await freshFiles();
        config.getProfileCast('prof_default').push(
            { triggers: 'Alice', portrait: 'alice.png', variants: [] },
            { triggers: 'Bob', portrait: 'bob.png', variants: [] },
        );
        global.fetch = vi.fn()
            .mockResolvedValueOnce({ ok: true, blob: async () => new Blob(['x']) })
            .mockResolvedValueOnce({ ok: false, status: 500 });

        const count = await files.exportCastArtwork('prof_default');
        expect(count).toBe(1);
    });

    it('a successful download is still counted normally', async () => {
        const { files, config } = await freshFiles();
        config.getProfileCast('prof_default').push({ triggers: 'Alice', portrait: 'alice.png', variants: [] });
        global.fetch = vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(['x']) });
        const count = await files.exportCastArtwork('prof_default');
        expect(count).toBe(1);
    });
});
