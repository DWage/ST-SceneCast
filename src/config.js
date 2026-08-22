export const CONFIG_KEY = 'scenecast_stage';
export const IMAGE_SUBFOLDER = 'scenecast';
export const TRAY_CAP = 12;

export const STAGE_MODES = [
    { value: 'bento-fit', label: '1. Bento Grid' },
    { value: 'bento', label: '2. Bento Grid (Cropped)' },
    { value: '3d', label: '3. 3D Diorama' },
    { value: 'accordion', label: '4. Vertical Accordion' },
    { value: 'organic', label: '5. Organic Blobs' },
    { value: 'manga', label: '6. Manga Cut-In' },
];

export const STAGE_SIDES = [
    { value: 'both', label: 'Both sides' },
    { value: 'left', label: 'Left only' },
    { value: 'right', label: 'Right only' },
];

export const DISMISS_MODES = [
    { value: 'replies', label: 'By reply count' },
    { value: 'manual', label: 'Manual only' },
];

export const EXIT_STYLES = [
    { value: 'fade', label: 'Fade & Shrink' },
    { value: 'dissolve', label: 'Dissolve' },
    { value: 'slide', label: 'Slide' },
];

export const DEFAULT_STATE = Object.freeze({
    isActive: true,
    profiles: {},
    characterProfileMap: {},
    fallbackProfileId: 'prof_default',
    keepAliveReplies: 0,
    matchCaseSensitive: false,
    dismissMode: 'replies',
    stageMode: 'bento',
    stageSide: 'both',
    maxCastSize: 7,
    exitAnim: 'fade',
    accentHueShift: 0,
    cardScale: 1,
    showInfoBar: true,
    showVariantTag: true,
});

export const PLACEHOLDER_ART = 'data:image/svg+xml;utf8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 260">' +
    '<rect width="200" height="260" fill="#4facfe"/>' +
    '<circle cx="100" cy="100" r="42" fill="rgba(255,255,255,0.65)"/>' +
    '<path d="M40 230 Q100 150 160 230 Z" fill="rgba(255,255,255,0.65)"/>' +
    '</svg>'
);

let runtimeActiveProfileIds = [];
let lastSyncedKey = undefined;

export function normalizeMember(member) {
    if (member.__normalized) return member;
    if (!Array.isArray(member.variants)) member.variants = [];
    if (member.hitsRequired === undefined) member.hitsRequired = 1;
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

function migrateFlatCastIfNeeded(raw) {
    if (raw.cast && Array.isArray(raw.cast)) {
        const legacyCast = raw.cast;
        delete raw.cast;
        raw.profiles = { 'prof_default': { name: 'Default', cast: legacyCast } };
        raw.fallbackProfileId = 'prof_default';
    }
    if (!raw.profiles || Object.keys(raw.profiles).length === 0) {
        raw.profiles = raw.profiles || {};
        raw.profiles['prof_default'] = { name: 'Default', cast: [] };
        raw.fallbackProfileId = 'prof_default';
    }
    if (!raw.fallbackProfileId || !raw.profiles[raw.fallbackProfileId]) {
        raw.fallbackProfileId = Object.keys(raw.profiles)[0];
    }
}

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
    migrateFlatCastIfNeeded(stored);
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
        set() {}
    });
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

export function getEffectiveCastCap(state) {
    const raw = Math.max(0, Math.min(TRAY_CAP, state.maxCastSize ?? TRAY_CAP));
    if (state.stageSide === 'left' || state.stageSide === 'right') {
        return Math.ceil(raw / 2);
    }
    return raw;
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
    if (!raw.profiles[id] || Object.keys(raw.profiles).length <= 1) return false;

    const removedCast = raw.profiles[id].cast || [];
    delete raw.profiles[id];

    for (const key of Object.keys(raw.characterProfileMap)) {
        const filtered = (raw.characterProfileMap[key] || []).filter(pid => pid !== id);
        if (filtered.length > 0) raw.characterProfileMap[key] = filtered;
        else delete raw.characterProfileMap[key];
    }
    if (raw.fallbackProfileId === id) raw.fallbackProfileId = Object.keys(raw.profiles)[0];
    if (runtimeActiveProfileIds.includes(id)) {
        runtimeActiveProfileIds = [raw.fallbackProfileId];
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

export function getCurrentBinding() {
    const raw = loadRawState();
    const key = resolveCharacterKey();
    const profileIds = key ? (raw.characterProfileMap[key] || []) : [];
    return { key, profileIds, isBound: profileIds.length > 0 };
}