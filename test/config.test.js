import { describe, it, expect, vi, beforeEach } from 'vitest';
import { installMockContext, installCharacterContext, installGroupContext } from './helpers/mockContext.js';

// config.js keeps module-level state (runtimeActiveProfileIds, lastSyncedKey),
// so every test gets a fully fresh module instance + fresh mock context.
async function freshConfig(contextOverrides) {
    vi.resetModules();
    const ctx = installMockContext(contextOverrides);
    const config = await import('../src/config.js');
    return { config, ctx };
}

describe('getEffectiveCastCap', () => {
    it('halves (rounding up) when stageSide is left/right', async () => {
        const { config } = await freshConfig();
        expect(config.getEffectiveCastCap({ maxCastSize: 7, stageSide: 'both' })).toBe(7);
        expect(config.getEffectiveCastCap({ maxCastSize: 7, stageSide: 'left' })).toBe(4);
        expect(config.getEffectiveCastCap({ maxCastSize: 7, stageSide: 'right' })).toBe(4);
        expect(config.getEffectiveCastCap({ maxCastSize: 8, stageSide: 'left' })).toBe(4);
    });

    it('clamps maxCastSize into [0, TRAY_CAP]', async () => {
        const { config } = await freshConfig();
        expect(config.getEffectiveCastCap({ maxCastSize: -5, stageSide: 'both' })).toBe(0);
        expect(config.getEffectiveCastCap({ maxCastSize: 999, stageSide: 'both' })).toBe(config.TRAY_CAP);
    });

    it('falls back to TRAY_CAP when maxCastSize is undefined', async () => {
        const { config } = await freshConfig();
        expect(config.getEffectiveCastCap({ stageSide: 'both' })).toBe(config.TRAY_CAP);
    });
});

describe('normalizeMember', () => {
    it('is idempotent via the non-enumerable __normalized flag', async () => {
        const { config } = await freshConfig();
        const member = { triggers: 'Alice' };
        config.normalizeMember(member);
        member.displayName = 'mutated after first pass';
        config.normalizeMember(member); // second pass should be a no-op
        expect(member.displayName).toBe('mutated after first pass');
    });

    it('fills in all defaults and mirrors variant label<->tag', async () => {
        const { config } = await freshConfig();
        const member = { variants: [{ tag: 'smiling' }, { label: 'angry' }] };
        config.normalizeMember(member);
        expect(member.hitsRequired).toBe(1);
        expect(member.useRegex).toBe(false);
        expect(member.excludeTriggers).toBe('');
        expect(member.sideBias).toBe('auto');
        expect(member.active).toBe(true);
        expect(member.displayName).toBe('');
        expect(member.triggers).toBe('');
        expect(member.portrait).toBe('');
        expect(member.lastArtIdx).toBe(0);
        expect(member.variants[0].label).toBe('smiling');
        expect(member.variants[1].tag).toBe('angry');
    });

    it('__normalized is non-enumerable (so it is silently dropped by JSON/structuredClone)', async () => {
        const { config } = await freshConfig();
        const member = config.normalizeMember({ triggers: 'A' });
        expect(Object.keys(member)).not.toContain('__normalized');
        expect(member.__normalized).toBe(true); // still readable directly
    });

    it('duplicateProfile drops __normalized (structuredClone omits non-enumerable props), but a second read stays safe and idempotent', async () => {
        const { config } = await freshConfig();
        const cast = config.getProfileCast('prof_default');
        cast.push({ triggers: 'Alice', displayName: 'custom name kept across renormalization' });
        config.normalizeMember(cast[0]);

        const dupId = config.duplicateProfile('prof_default', 'Copy');

        // Peek at the RAW cloned data before getProfileCast() has a chance to
        // re-normalize it (getProfileCast calls .forEach(normalizeMember)
        // internally before returning, so checking dupCast[0] afterwards would
        // always see __normalized=true and hide the bug).
        const raw = config.loadConfig();
        expect(raw.profiles[dupId].cast[0].__normalized).toBeUndefined();

        // But getProfileCast() re-normalizes on every read, and that re-normalization
        // must not throw and must not clobber values that are already set.
        let dupCast;
        expect(() => { dupCast = config.getProfileCast(dupId); }).not.toThrow();
        expect(dupCast[0].displayName).toBe('custom name kept across renormalization');
        expect(dupCast[0].__normalized).toBe(true); // re-flagged after the next read
    });
});

describe('extensionSettings migration (old saves missing new fields)', () => {
    it('backfills missing DEFAULT_STATE keys without touching existing values', async () => {
        vi.resetModules();
        const ctx = installMockContext({
            extensionSettings: {
                scenecast_stage: {
                    isActive: false, // deliberately non-default, must survive
                    profiles: { prof_default: { name: 'Default', cast: [] } },
                    characterProfileMap: {},
                    fallbackProfileId: 'prof_default',
                    // everything else (stageMode, dismissMode, cardScale, ...) is
                    // "missing" the way an old save from before those settings existed would be.
                },
            },
        });
        const config = await import('../src/config.js');
        const state = config.loadConfig();
        expect(state.isActive).toBe(false); // preserved
        expect(state.stageMode).toBe('bento'); // backfilled default
        expect(state.dismissMode).toBe('replies');
        expect(state.cardScale).toBe(1);
        expect(state.showVariantTag).toBe(true);
    });
});

describe('ensureCastAccessor (merged cast getter)', () => {
    it('merges cast arrays from every active profile, and the setter warns instead of throwing', async () => {
        const { config } = await freshConfig({
            characterId: 0,
            characters: [{ avatar: 'a.png', name: 'A' }],
        });
        const idB = config.createProfile('Profile B');
        config.getProfileCast('prof_default').push({ triggers: 'Alice' });
        config.getProfileCast(idB).push({ triggers: 'Bob' });

        // Bind BOTH profiles to the current character, so the merged getter
        // has to combine cast arrays from more than one active profile.
        config.bindCharacterToProfile('prof_default');
        config.bindCharacterToProfile(idB);
        config.refreshActiveProfileForCurrentChat();

        const state = config.loadConfig();
        const merged = state.cast;
        expect(merged.map(m => m.triggers)).toEqual(expect.arrayContaining(['Alice', 'Bob']));

        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        state.cast = ['not allowed'];
        expect(warnSpy).toHaveBeenCalled();
        expect(config.loadConfig().cast.length).toBe(2); // unaffected by the assignment
    });

    it('does not recreate the accessor on repeated loadConfig() calls', async () => {
        const { config } = await freshConfig();
        const raw1 = config.loadConfig();
        const descriptor1 = Object.getOwnPropertyDescriptor(raw1, 'cast');
        const raw2 = config.loadConfig();
        const descriptor2 = Object.getOwnPropertyDescriptor(raw2, 'cast');
        expect(descriptor1.get).toBe(descriptor2.get);
    });
});

describe('resolveCharacterKey / resolveCharacterDisplayName / resolveDisplayNameForKey', () => {
    it('prefers group over character when both are present', async () => {
        vi.resetModules();
        installMockContext({
            groupId: 'g1',
            groups: [{ id: 'g1', name: 'Group One' }],
            characterId: 0,
            characters: [{ avatar: 'x.png', name: 'Solo' }],
        });
        const config = await import('../src/config.js');
        expect(config.resolveCharacterKey()).toBe('group:g1');
        expect(config.resolveCharacterDisplayName()).toBe('Group One');
    });

    it('resolves a character key/name when no group is active', async () => {
        vi.resetModules();
        installCharacterContext('alice.png', 'Alice');
        const config = await import('../src/config.js');
        expect(config.resolveCharacterKey()).toBe('char:alice.png');
        expect(config.resolveCharacterDisplayName()).toBe('Alice');
    });

    it('returns null with no group/character context', async () => {
        const { config } = await freshConfig();
        expect(config.resolveCharacterKey()).toBeNull();
        expect(config.resolveCharacterDisplayName()).toBeNull();
    });

    it('resolveDisplayNameForKey handles group: and char: keys, and unknown keys', async () => {
        vi.resetModules();
        installMockContext({
            groups: [{ id: 'g1', name: 'Group One' }],
            characters: [{ avatar: 'alice.png', name: 'Alice' }],
        });
        const config = await import('../src/config.js');
        expect(config.resolveDisplayNameForKey('group:g1')).toBe('Group One');
        expect(config.resolveDisplayNameForKey('char:alice.png')).toBe('Alice');
        expect(config.resolveDisplayNameForKey('char:unknown.png')).toBeNull();
        expect(config.resolveDisplayNameForKey(null)).toBeNull();
    });
});

describe('refreshActiveProfileForCurrentChat', () => {
    it('filters out ids for profiles that no longer exist', async () => {
        const { config } = await freshConfig({
            characterId: 0,
            characters: [{ avatar: 'a.png', name: 'A' }],
        });
        const raw = config.loadConfig();
        raw.characterProfileMap['char:a.png'] = ['prof_default', 'prof_ghost'];
        const ids = config.refreshActiveProfileForCurrentChat();
        expect(ids).toEqual(['prof_default']);
    });

    it('falls back to fallbackProfileId, then to the first profile, when no binding exists', async () => {
        const { config } = await freshConfig();
        const ids = config.refreshActiveProfileForCurrentChat();
        expect(ids).toEqual(['prof_default']);
    });
});

describe('loadConfig caching by lastSyncedKey', () => {
    it('does NOT pick up a newly-bound profile on a second call with the SAME character key', async () => {
        const { config } = await freshConfig({
            characterId: 0,
            characters: [{ avatar: 'a.png', name: 'A' }],
        });
        config.loadConfig(); // first call: key 'char:a.png' is new -> resolves + caches it
        expect(config.getActiveProfileIds()).toEqual(['prof_default']); // fallback, nothing bound yet

        const idB = config.createProfile('B');
        config.bindCharacterToProfile(idB); // bind AFTER the key was already synced

        // The character key hasn't changed, so this documented caching behavior
        // means the newly-bound profile is NOT picked up by loadConfig() alone.
        config.loadConfig();
        expect(config.getActiveProfileIds()).toEqual(['prof_default']);

        // An explicit refresh call (e.g. what CHAT_CHANGED triggers) DOES pick it up.
        config.refreshActiveProfileForCurrentChat();
        expect(config.getActiveProfileIds()).toEqual([idB]);
    });

    it('re-resolves when the character key changes', async () => {
        vi.resetModules();
        const ctx = installCharacterContext('a.png', 'A');
        const config = await import('../src/config.js');
        config.loadConfig(); // syncs lastSyncedKey to 'char:a.png', resolves fallback
        expect(config.getActiveProfileIds()).toEqual(['prof_default']);

        const idB = config.createProfile('B');

        // Switch the live context to group mode and bind idB to it BEFORE the
        // next loadConfig() call — bindCharacterToProfile resolves the key
        // itself but does not touch runtimeActiveProfileIds/lastSyncedKey.
        ctx.characterId = undefined;
        ctx.groupId = 'g1';
        ctx.groups = [{ id: 'g1', name: 'G' }];
        config.bindCharacterToProfile(idB);

        // Only now does the key genuinely differ from the cached lastSyncedKey,
        // so this loadConfig() call must re-resolve and pick up the new binding.
        config.loadConfig();
        expect(config.getActiveProfileIds()).toEqual([idB]);
    });
});

describe('profile CRUD', () => {
    it('createProfile trims the name and defaults empty names to "New Profile"', async () => {
        const { config } = await freshConfig();
        const id1 = config.createProfile('  My World  ');
        expect(config.listProfiles().find(p => p.id === id1).name).toBe('My World');
        const id2 = config.createProfile('   ');
        expect(config.listProfiles().find(p => p.id === id2).name).toBe('New Profile');
    });

    it('duplicateProfile deep-clones cast so mutating the copy never touches the original', async () => {
        const { config } = await freshConfig();
        config.getProfileCast('prof_default').push({ triggers: 'Alice', variants: [{ tag: 'x', portrait: 'p1' }] });
        const dupId = config.duplicateProfile('prof_default');
        const dupCast = config.getProfileCast(dupId);
        dupCast[0].triggers = 'Mutated';
        dupCast[0].variants[0].portrait = 'mutated-path';

        const originalCast = config.getProfileCast('prof_default');
        expect(originalCast[0].triggers).toBe('Alice');
        expect(originalCast[0].variants[0].portrait).toBe('p1');
    });

    it('duplicateProfile returns null for an unknown source', async () => {
        const { config } = await freshConfig();
        expect(config.duplicateProfile('does-not-exist')).toBeNull();
    });

    it('deleteProfile refuses to delete the last remaining profile', async () => {
        const { config } = await freshConfig();
        expect(config.deleteProfile('prof_default')).toBe(false);
        expect(config.listProfiles().length).toBe(1);
    });

    it('deleteProfile cascades: cleans characterProfileMap, fixes fallbackProfileId, and fixes runtimeActiveProfileIds', async () => {
        const { config } = await freshConfig({
            characterId: 0,
            characters: [{ avatar: 'a.png', name: 'A' }],
        });
        const idB = config.createProfile('B');
        config.bindCharacterToProfile(idB);
        config.refreshActiveProfileForCurrentChat();
        expect(config.getActiveProfileIds()).toContain(idB);

        const raw = config.loadConfig();
        raw.fallbackProfileId = idB;

        const removedCast = config.deleteProfile(idB);
        expect(Array.isArray(removedCast)).toBe(true);

        const rawAfter = config.loadConfig();
        expect(rawAfter.profiles[idB]).toBeUndefined();
        expect(Object.values(rawAfter.characterProfileMap).flat()).not.toContain(idB);
        expect(rawAfter.fallbackProfileId).toBe('prof_default'); // reassigned, not left dangling
        expect(config.getActiveProfileIds()).toEqual(['prof_default']); // runtime ids repaired too
    });

    it('moveCastMember moves a member and auto-creates the target profile if missing', async () => {
        const { config } = await freshConfig();
        config.getProfileCast('prof_default').push({ triggers: 'Alice' });
        const moved = config.moveCastMember('prof_default', 0, 'prof_new_target');
        expect(moved).toBe(true);
        expect(config.getProfileCast('prof_default').length).toBe(0);
        expect(config.getProfileCast('prof_new_target')[0].triggers).toBe('Alice');
    });

    it('moveCastMember rejects same-profile moves and missing members', async () => {
        const { config } = await freshConfig();
        expect(config.moveCastMember('prof_default', 0, 'prof_default')).toBe(false);
        expect(config.moveCastMember('prof_default', 5, 'prof_other')).toBe(false);
    });
});

describe('bind/unbind', () => {
    it('bindCharacterToProfile requires a resolvable character key', async () => {
        const { config } = await freshConfig(); // no character/group context
        expect(config.bindCharacterToProfile('prof_default')).toBe(false);
    });

    it('bind then unbind round-trips cleanly and removes the map entry entirely when empty', async () => {
        const { config } = await freshConfig({
            characterId: 0,
            characters: [{ avatar: 'a.png', name: 'A' }],
        });
        config.bindCharacterToProfile('prof_default');
        expect(config.getCurrentBinding().isBound).toBe(true);
        config.unbindCharacterFromProfile('prof_default');
        expect(config.getCurrentBinding().isBound).toBe(false);
        expect(config.loadConfig().characterProfileMap['char:a.png']).toBeUndefined();
    });
});

describe('pathsReferSameImage — exact-path matching only (no basename fallback)', () => {
    it('clearPortraitReferencesEverywhere does NOT wipe a different image that merely shares a basename', async () => {
        const { config } = await freshConfig();
        const idB = config.createProfile('Profile B');

        config.getProfileCast('prof_default').push({
            triggers: 'Alice', portrait: 'user/images/scenecast/profileA/shared.png',
        });
        config.getProfileCast(idB).push({
            triggers: 'Zoe', portrait: 'user/images/scenecast/profileB/shared.png',
        });

        const cleared = config.clearPortraitReferencesEverywhere('user/images/scenecast/profileA/shared.png');

        expect(cleared).toBe(1);
        expect(config.getProfileCast('prof_default')[0].portrait).toBe('');
        // Zoe's (different) image with the same basename must survive untouched.
        expect(config.getProfileCast(idB)[0].portrait).toBe('user/images/scenecast/profileB/shared.png');
    });

    it('findPortraitReferences does not report a false positive for a shared basename in a different path', async () => {
        const { config } = await freshConfig();
        const idB = config.createProfile('Profile B');
        config.getProfileCast('prof_default').push({ triggers: 'Alice', portrait: 'a/dir1/pic.png' });
        config.getProfileCast(idB).push({ triggers: 'Zoe', portrait: 'a/dir2/pic.png' });

        const refs = config.findPortraitReferences('a/dir1/pic.png');
        expect(refs.length).toBe(1);
        expect(refs.some(r => r.includes('Alice'))).toBe(true);
        expect(refs.some(r => r.includes('Zoe'))).toBe(false);
    });

    it('still matches the same image referenced with a different leading slash', async () => {
        const { config } = await freshConfig();
        config.getProfileCast('prof_default').push({ triggers: 'Alice', portrait: '/a/dir1/alice.png' });
        const cleared = config.clearPortraitReferencesEverywhere('a/dir1/alice.png');
        expect(cleared).toBe(1);
        expect(config.getProfileCast('prof_default')[0].portrait).toBe('');
    });

    it('exact-path matches still work correctly when basenames differ', async () => {
        const { config } = await freshConfig();
        config.getProfileCast('prof_default').push({ triggers: 'Alice', portrait: 'a/dir1/alice.png' });
        const cleared = config.clearPortraitReferencesEverywhere('a/dir1/alice.png');
        expect(cleared).toBe(1);
        expect(config.getProfileCast('prof_default')[0].portrait).toBe('');
    });

    it('does not touch unrelated images entirely (different path AND different basename)', async () => {
        const { config } = await freshConfig();
        config.getProfileCast('prof_default').push({ triggers: 'Alice', portrait: 'a/dir1/alice.png' });
        const cleared = config.clearPortraitReferencesEverywhere('a/dir1/completely-different.png');
        expect(cleared).toBe(0);
        expect(config.getProfileCast('prof_default')[0].portrait).toBe('a/dir1/alice.png');
    });
});
