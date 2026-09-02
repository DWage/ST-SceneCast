import { describe, it, expect, vi, beforeEach } from 'vitest';
import { installMockContext } from './helpers/mockContext.js';

async function freshImageGuard() {
    vi.resetModules();
    const ctx = installMockContext();
    const config = await import('../src/config.js');
    const imageGuard = await import('../src/image-guard.js');
    return { config, imageGuard, ctx };
}

describe('safeDeleteServerImage', () => {
    beforeEach(() => {
        global.fetch = vi.fn().mockResolvedValue({ ok: true });
    });

    it('does nothing for non-server paths (data URIs, empty)', async () => {
        const { imageGuard } = await freshImageGuard();
        imageGuard.safeDeleteServerImage('');
        imageGuard.safeDeleteServerImage('data:image/png;base64,xxx');
        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('deletes when there are zero references anywhere', async () => {
        const { imageGuard } = await freshImageGuard();
        imageGuard.safeDeleteServerImage('user/images/scenecast/orphan.png');
        expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('blocks deletion when the image is used as a main portrait', async () => {
        const { config, imageGuard } = await freshImageGuard();
        config.getProfileCast('prof_default').push({ triggers: 'Alice', portrait: 'user/images/scenecast/shared.png', variants: [] });
        imageGuard.safeDeleteServerImage('user/images/scenecast/shared.png');
        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('blocks deletion when the image is used ONLY as a variant', async () => {
        const { config, imageGuard } = await freshImageGuard();
        config.getProfileCast('prof_default').push({
            triggers: 'Alice', portrait: 'main.png',
            variants: [{ tag: 'v', label: 'v', portrait: 'user/images/scenecast/shared.png' }],
        });
        imageGuard.safeDeleteServerImage('user/images/scenecast/shared.png');
        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('blocks deletion when the image is used as BOTH the main portrait and a variant of the same member', async () => {
        const { config, imageGuard } = await freshImageGuard();
        config.getProfileCast('prof_default').push({
            triggers: 'Alice', portrait: 'user/images/scenecast/shared.png',
            variants: [{ tag: 'v', label: 'v', portrait: 'user/images/scenecast/shared.png' }],
        });
        imageGuard.safeDeleteServerImage('user/images/scenecast/shared.png');
        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('blocks deletion when referenced by a DIFFERENT profile entirely', async () => {
        const { config, imageGuard } = await freshImageGuard();
        const idB = config.createProfile('Profile B');
        config.getProfileCast(idB).push({ triggers: 'Zoe', portrait: 'user/images/scenecast/shared.png', variants: [] });
        imageGuard.safeDeleteServerImage('user/images/scenecast/shared.png');
        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('blocks deletion when referenced by a different CHARACTER but the same profile', async () => {
        const { config, imageGuard } = await freshImageGuard();
        config.getProfileCast('prof_default').push(
            { triggers: 'Alice', portrait: 'user/images/scenecast/shared.png', variants: [] },
            { triggers: 'Bob', portrait: 'other.png', variants: [{ tag: 'v', label: 'v', portrait: 'user/images/scenecast/shared.png' }] },
        );
        imageGuard.safeDeleteServerImage('user/images/scenecast/shared.png');
        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('deletes once every reference has been cleared', async () => {
        const { config, imageGuard } = await freshImageGuard();
        const member = { triggers: 'Alice', portrait: 'user/images/scenecast/shared.png', variants: [] };
        config.getProfileCast('prof_default').push(member);
        imageGuard.safeDeleteServerImage('user/images/scenecast/shared.png');
        expect(global.fetch).not.toHaveBeenCalled();

        member.portrait = ''; // reference removed
        imageGuard.safeDeleteServerImage('user/images/scenecast/shared.png');
        expect(global.fetch).toHaveBeenCalledTimes(1);
    });
});
