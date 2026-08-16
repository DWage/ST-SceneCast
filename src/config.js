export const CONFIG_KEY = 'scenecast_stage';
export const IMAGE_SUBFOLDER = 'scenecast';
export const TRAY_CAP = 12;

export const DEFAULT_STATE = Object.freeze({
    isActive: true,
    cast: [],
    keepAliveReplies: 0,
    matchCaseSensitive: false,
    dismissMode: 'replies',
    maxCastSize: 7
});

export const PLACEHOLDER_ART = 'data:image/svg+xml;utf8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 260">' +
    '<rect width="200" height="260" fill="#4facfe"/>' +
    '<circle cx="100" cy="100" r="42" fill="rgba(255,255,255,0.65)"/>' +
    '<path d="M40 230 Q100 150 160 230 Z" fill="rgba(255,255,255,0.65)"/>' +
    '</svg>'
);

export function loadConfig() {
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

export function persistConfig() {
    SillyTavern.getContext().saveSettingsDebounced();
}

export function getEffectiveCastCap(state) {
    return Math.max(0, Math.min(TRAY_CAP, state.maxCastSize ?? TRAY_CAP));
}