import { parseTriggerList } from './utils.js';

const CONFIG_KEY = 'scenecast_stage';

export const TRAY_CAP = 12;

export const IMAGE_SUBFOLDER = 'scenecast';

export const STAGE_MODES = [
    { value: 'bento-fit', label: '1. Bento Grid' },
    { value: 'bento', label: '2. Bento Grid (Cropped)' },
    { value: '3d', label: '3. 3D Diorama' },
    { value: 'accordion', label: '4. Vertical Accordion' },
    { value: 'organic', label: '5. Organic Blobs' },
    { value: 'manga', label: '6. Manga Cut-In' },
    { value: 'cyber', label: '7. Cyberpunk HUD' },
    { value: 'aurora', label: '8. Aurora Glass' },
    { value: 'polaroid', label: '9. Polaroid Scrapbook' },
    { value: 'holo', label: '10. Holographic Foil' },
    { value: 'neon', label: '11. Neon Pulse' },
];

export const STAGE_EFFECTS = [
    { value: 'none', label: 'None' },
    { value: 'sparkle', label: 'Sparkle' },
    { value: 'grain', label: 'Film Grain' },
    { value: 'vignette', label: 'Vignette' },
    { value: 'scanlines', label: 'Scanlines' },
    { value: 'crt', label: 'CRT Monitor' },
    { value: 'glitch', label: 'VHS Glitch' },
    { value: 'prism', label: 'Prism Leaks' },
    { value: 'embers', label: 'Embers' },
    { value: 'snow', label: 'Falling Snow' },
    { value: 'fog', label: 'Mystic Fog' },
    { value: 'holoscan', label: 'Holo Scan' },
];

export const DISMISS_MODES = [
    { value: 'replies', label: 'By reply count' },
    { value: 'time', label: 'By time (seconds)' },
    { value: 'manual', label: 'Manual only (never auto-dismisses)' },
];

export const DISMISS_HINTS = {
    replies: 'The card stays on stage until this many AI replies pass without that character being mentioned again. 0 = remove them the instant they stop being mentioned.',
    time: 'The card disappears this many seconds after the character was last mentioned, no matter how many replies happen in that window.',
    manual: 'Cards never disappear on their own — only clicking the ✕ on the card (or Clear All) removes them.',
};

export const EXIT_STYLES = [
    { value: 'fade', label: 'Fade & Shrink' },
    { value: 'dissolve', label: 'Dissolve (blur)' },
    { value: 'slide', label: 'Slide to side' },
    { value: 'drop', label: 'Drop & Fade' },
    { value: 'shatter', label: 'Shatter' },
];

export const STAGE_SIDES = [
    { value: 'both', label: 'Both sides' },
    { value: 'left', label: 'Left only' },
    { value: 'right', label: 'Right only' },
];

export const DEFAULT_STATE = Object.freeze({
    isActive: true,
    profiles: { prof_default: { name: 'Default', cast: [] } },
    characterProfileMap: {},
    fallbackProfileId: 'prof_default',
    keepAliveReplies: 0,
    matchCaseSensitive: false,
    dismissMode: 'replies',
    dismissSeconds: 8,
    stageMode: 'bento-fit',
    stageFx: 'none',
    stageSide: 'both',
    maxCastSize: 12,
    exitAnim: 'fade',
    hideDetailsBlocks: true,
    ignoreQuotedNames: true,
    ignoreMarkerStart: '',
    ignoreMarkerEnd: '',
    timelineSync: true,
    timelineLookback: 1,
    accentHueShift: 0,
    reduceMotion: false,
    cardScale: 1,
    showInfoBar: true,
    showVariantTag: false,
    heartLiked: false,
    hasSeenGuide: false,
});

export const PLACEHOLDER_ART = 'data:image/svg+xml;utf8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 260">' +
    '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
    '<stop offset="0%" stop-color="#00f2fe"/><stop offset="100%" stop-color="#4facfe"/>' +
    '</linearGradient></defs>' +
    '<rect width="200" height="260" fill="url(#g)"/>' +
    '<circle cx="100" cy="100" r="42" fill="rgba(255,255,255,0.65)"/>' +
    '<path d="M40 230 Q100 150 160 230 Z" fill="rgba(255,255,255,0.65)"/>' +
    '</svg>'
);

export function getEffectiveCastCap(state) {
    const raw = Math.max(0, Math.min(TRAY_CAP, state.maxCastSize ?? TRAY_CAP));
    if (state.stageSide === 'left' || state.stageSide === 'right') {
        return Math.ceil(raw / 2);
    }
    return raw;
}

function generateMemberId() {
    return 'mem_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export function normalizeMember(member) {
    if (member.__normalized) return member;

    if (member.id === undefined) member.id = generateMemberId();

    if (!Array.isArray(member.variants)) member.variants = [];
    if (member.hitsRequired === undefined) member.hitsRequired = 1;
    if (member.useRegex === undefined) member.useRegex = false;
    if (member.excludeTriggers === undefined) member.excludeTriggers = '';
    if (member.sideBias === undefined) member.sideBias = 'auto';
    if (member.active === undefined) member.active = true;
    if (member.displayName === undefined) member.displayName = '';
    if (member.triggers === undefined) member.triggers = '';
    if (member.portrait === undefined) member.portrait = '';
    if (member.lastArtIdx === undefined) member.lastArtIdx = 0;
    for (const variant of member.variants) {
        if (variant.label === undefined) variant.label = variant.tag || '';
        if (variant.tag === undefined) variant.tag = variant.label || '';
    }

    Object.defineProperty(member, '__normalized', {
        value: true, enumerable: false, configurable: true, writable: true,
    });
    return member;
}

let runtimeActiveProfileIds = [];
let lastSyncedKey = undefined;

function loadRawState() {
    const { extensionSettings } = SillyTavern.getContext();
    if (!extensionSettings[CONFIG_KEY]) {
        extensionSettings[CONFIG_KEY] = structuredClone(DEFAULT_STATE);
    }
    const stored = extensionSettings[CONFIG_KEY];
    for (const key of Object.keys(DEFAULT_STATE)) {
        if (stored[key] === undefined) {
            stored[key] = structuredClone(DEFAULT_STATE[key]);
        }
    }
    return stored;
}

function ensureCastAccessor(raw) {
    const existing = Object.getOwnPropertyDescriptor(raw, 'cast');
    if (existing && existing.get) return;
    Object.defineProperty(raw, 'cast', {
        configurable: true,
        enumerable: false,
        get() {
            const ids = (runtimeActiveProfileIds && runtimeActiveProfileIds.length)
                ? runtimeActiveProfileIds : [raw.fallbackProfileId];
            const merged = [];
            for (const id of ids) {
                const profile = raw.profiles[id];
                if (!profile) continue;
                for (const member of profile.cast) merged.push(member);
            }
            return merged;
        },
        set() {
            console.warn('[SceneCast] Ignored attempt to assign state.cast directly — use getProfileCast(profileId) instead.');
        },
    });
}

export function resolveCharacterKey() {
    const ctx = SillyTavern.getContext();
    if (ctx.groupId) return `group:${ctx.groupId}`;
    const chId = ctx.characterId;
    if (chId !== undefined && chId !== null && ctx.characters && ctx.characters[chId]) {
        return `char:${ctx.characters[chId].avatar}`;
    }
    return null;
}

export function resolveCharacterDisplayName() {
    const ctx = SillyTavern.getContext();
    if (ctx.groupId) {
        const group = (ctx.groups || []).find(g => g.id === ctx.groupId);
        return group?.name || null;
    }
    const chId = ctx.characterId;
    if (chId !== undefined && chId !== null && ctx.characters && ctx.characters[chId]) {
        return ctx.characters[chId].name || null;
    }
    return null;
}

export function resolveDisplayNameForKey(key) {
    if (!key) return null;
    const ctx = SillyTavern.getContext();
    if (key.startsWith('group:')) {
        const groupId = key.slice('group:'.length);
        const group = (ctx.groups || []).find(g => g.id === groupId);
        return group?.name || null;
    }
    if (key.startsWith('char:')) {
        const avatar = key.slice('char:'.length);
        const found = (ctx.characters || []).find(c => c.avatar === avatar);
        return found?.name || null;
    }
    return null;
}

export function refreshActiveProfileForCurrentChat(rawOptional) {
    const raw = rawOptional || loadRawState();
    const key = resolveCharacterKey();
    let ids = (key && raw.characterProfileMap[key]) ? raw.characterProfileMap[key] : [];
    ids = ids.filter(id => raw.profiles[id]);
    if (ids.length === 0) {
        const fallback = (raw.fallbackProfileId && raw.profiles[raw.fallbackProfileId])
            ? raw.fallbackProfileId : Object.keys(raw.profiles)[0];
        ids = fallback ? [fallback] : [];
    }
    runtimeActiveProfileIds = ids;
    return ids.slice();
}

export function getActiveProfileId() {
    if (!runtimeActiveProfileIds || runtimeActiveProfileIds.length === 0) refreshActiveProfileForCurrentChat();
    return runtimeActiveProfileIds[0];
}

export function getActiveProfileIds() {
    if (!runtimeActiveProfileIds || runtimeActiveProfileIds.length === 0) refreshActiveProfileForCurrentChat();
    return runtimeActiveProfileIds.slice();
}

export function loadConfig() {
    const raw = loadRawState();
    const key = resolveCharacterKey();
    if (key !== lastSyncedKey) {
        refreshActiveProfileForCurrentChat(raw);
        lastSyncedKey = key;
    }
    ensureCastAccessor(raw);
    raw.cast.forEach(normalizeMember);
    return raw;
}

export function persistConfig() {
    SillyTavern.getContext().saveSettingsDebounced();
}

export function resolveDisplayName(castIdx, stateOverride) {
    const state = stateOverride || loadConfig();
    const member = state.cast[castIdx];
    if (!member) return '';
    return member.displayName || parseTriggerList(member.triggers)[0] || '';
}

export function getProfileCast(profileId) {
    const raw = loadRawState();
    if (!raw.profiles[profileId]) raw.profiles[profileId] = { name: 'New Profile', cast: [] };
    raw.profiles[profileId].cast.forEach(normalizeMember);
    return raw.profiles[profileId].cast;
}

export function listProfiles() {
    const raw = loadRawState();
    return Object.entries(raw.profiles).map(([id, p]) => ({
        id, name: p.name, count: (p.cast || []).length,
    }));
}

function generateProfileId() {
    return 'prof_' + Math.random().toString(36).slice(2, 10);
}

export function createProfile(name) {
    const raw = loadRawState();
    const id = generateProfileId();
    raw.profiles[id] = { name: (name || 'New Profile').trim() || 'New Profile', cast: [] };
    persistConfig();
    return id;
}

export function duplicateProfile(sourceId, name) {
    const raw = loadRawState();
    const src = raw.profiles[sourceId];
    if (!src) return null;
    const id = generateProfileId();
    raw.profiles[id] = { name: name || `${src.name} (copy)`, cast: structuredClone(src.cast) };
    persistConfig();
    return id;
}

export function renameProfile(id, name) {
    const raw = loadRawState();
    if (raw.profiles[id] && name) {
        raw.profiles[id].name = name;
        persistConfig();
    }
}

export function deleteProfile(id) {
    const raw = loadRawState();
    if (!raw.profiles[id]) return false;
    if (Object.keys(raw.profiles).length <= 1) return false;

    const removedCast = raw.profiles[id].cast || [];
    delete raw.profiles[id];

    for (const key of Object.keys(raw.characterProfileMap)) {
        const filtered = (raw.characterProfileMap[key] || []).filter(pid => pid !== id);
        if (filtered.length > 0) raw.characterProfileMap[key] = filtered;
        else delete raw.characterProfileMap[key];
    }
    if (raw.fallbackProfileId === id) raw.fallbackProfileId = Object.keys(raw.profiles)[0];
    if (runtimeActiveProfileIds && runtimeActiveProfileIds.includes(id)) {
        runtimeActiveProfileIds = runtimeActiveProfileIds.filter(pid => pid !== id);
        if (runtimeActiveProfileIds.length === 0 && raw.fallbackProfileId) {
            runtimeActiveProfileIds = [raw.fallbackProfileId];
        }
    }

    persistConfig();
    return removedCast;
}

export function bindCharacterToProfile(profileId) {
    const raw = loadRawState();
    const key = resolveCharacterKey();
    if (!key || !raw.profiles[profileId]) return false;
    const list = raw.characterProfileMap[key] || [];
    if (!list.includes(profileId)) {
        raw.characterProfileMap[key] = [...list, profileId];
        persistConfig();
    }
    return true;
}

export function unbindCharacterFromProfile(profileId) {
    const raw = loadRawState();
    const key = resolveCharacterKey();
    if (!key || !raw.characterProfileMap[key]) return false;
    const filtered = raw.characterProfileMap[key].filter(id => id !== profileId);
    if (filtered.length > 0) raw.characterProfileMap[key] = filtered;
    else delete raw.characterProfileMap[key];
    persistConfig();
    return true;
}

export function unbindProfileFromCharacterKey(key, profileId) {
    const raw = loadRawState();
    if (!key || !raw.characterProfileMap[key]) return false;
    const filtered = raw.characterProfileMap[key].filter(id => id !== profileId);
    if (filtered.length > 0) raw.characterProfileMap[key] = filtered;
    else delete raw.characterProfileMap[key];
    persistConfig();
    return true;
}

export function getCurrentBinding() {
    const raw = loadRawState();
    const key = resolveCharacterKey();
    const profileIds = key ? (raw.characterProfileMap[key] || []) : [];
    return { key, profileIds, isBound: profileIds.length > 0 };
}

export function getCharacterKeysBoundToProfile(profileId) {
    const raw = loadRawState();
    const keys = [];
    for (const [key, ids] of Object.entries(raw.characterProfileMap)) {
        if (Array.isArray(ids) && ids.includes(profileId)) keys.push(key);
    }
    return keys;
}

export function moveCastMember(fromProfileId, index, toProfileId) {
    if (!fromProfileId || !toProfileId || fromProfileId === toProfileId) return false;
    const raw = loadRawState();
    const fromCast = raw.profiles[fromProfileId]?.cast;
    if (!fromCast || !fromCast[index]) return false;
    if (!raw.profiles[toProfileId]) raw.profiles[toProfileId] = { name: 'New Profile', cast: [] };

    const [member] = fromCast.splice(index, 1);
    raw.profiles[toProfileId].cast.push(member);
    persistConfig();
    return true;
}

function normalizeImagePath(path) {
    if (!path || typeof path !== 'string') return '';
    return path.replace(/\\/g, '/').replace(/^\/+/, '').split('?')[0];
}

function pathsReferSameImage(a, b) {
    if (!a || !b) return false;
    return normalizeImagePath(a) === normalizeImagePath(b);
}

export function clearPortraitReferencesEverywhere(imagePath) {
    if (!imagePath) return 0;
    const raw = loadRawState();
    let cleared = 0;
    for (const profile of Object.values(raw.profiles)) {
        for (const member of (profile.cast || [])) {
            if (pathsReferSameImage(member.portrait, imagePath)) { member.portrait = ''; cleared++; }
            for (const v of (member.variants || [])) {
                if (pathsReferSameImage(v.portrait, imagePath)) { v.portrait = ''; cleared++; }
            }
        }
    }
    if (cleared > 0) persistConfig();
    return cleared;
}

export function findPortraitReferences(imagePath) {
    const raw = loadRawState();
    const refs = [];
    for (const profile of Object.values(raw.profiles)) {
        for (const member of (profile.cast || [])) {
            const name = member.displayName || (member.triggers || '').split(',')[0]?.trim() || 'Unnamed';
            if (pathsReferSameImage(member.portrait, imagePath)) refs.push(`${profile.name}: ${name}`);
            for (const v of (member.variants || [])) {
                if (pathsReferSameImage(v.portrait, imagePath)) refs.push(`${profile.name}: ${name} (${v.label || v.tag || 'variant'})`);
            }
        }
    }
    return refs;
}

export function findMergedCastIndexById(state, id) {
    if (!id) return -1;
    return state.cast.findIndex(m => m.id === id);
}