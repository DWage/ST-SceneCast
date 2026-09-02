import { vi } from 'vitest';

/**
 * Installs a fresh global.SillyTavern.getContext() mock and returns the
 * mutable context object (so tests can flip characterId/groupId/chat/etc.
 * mid-test — real SillyTavern context is a live object too).
 *
 * IMPORTANT: call this AFTER vi.resetModules() and BEFORE importing any
 * src/*.js module in a test, since config.js reads SillyTavern.getContext()
 * lazily (fine) but some modules capture eventSource at import time
 * (index.js) — for those, set up the context first.
 */
export function installMockContext(overrides = {}) {
    const listeners = new Map();

    const eventSource = {
        on(event, cb) {
            if (!listeners.has(event)) listeners.set(event, []);
            listeners.get(event).push(cb);
        },
        emit(event, ...args) {
            for (const cb of (listeners.get(event) || [])) cb(...args);
        },
        listenerCount(event) {
            return (listeners.get(event) || []).length;
        },
    };

    const event_types = {
        APP_READY: 'APP_READY',
        CHARACTER_MESSAGE_RENDERED: 'CHARACTER_MESSAGE_RENDERED',
        CHAT_CHANGED: 'CHAT_CHANGED',
    };

    const ctx = {
        extensionSettings: {},
        chat: [],
        characters: [],
        characterId: undefined,
        groupId: undefined,
        groups: [],
        eventSource,
        event_types,
        saveSettingsDebounced: vi.fn(),
        getRequestHeaders: () => ({}),
        ...overrides,
    };

    global.SillyTavern = { getContext: () => ctx };
    return ctx;
}

/** Convenience: a character-mode context bound to a single character. */
export function installCharacterContext(avatar = 'alice.png', name = 'Alice', overrides = {}) {
    return installMockContext({
        characterId: 0,
        characters: [{ avatar, name }],
        ...overrides,
    });
}

/** Convenience: a group-mode context. */
export function installGroupContext(groupId = 'grp1', name = 'The Group', overrides = {}) {
    return installMockContext({
        groupId,
        groups: [{ id: groupId, name }],
        ...overrides,
    });
}
