import { describe, it, expect, vi, beforeEach } from 'vitest';
import { installMockContext } from './helpers/mockContext.js';

// index.js only needs mountSidebarPanel from ui.js — the real ui.js is a large,
// UI-integration-heavy module out of scope for this suite (see README), so we
// mock it here rather than pulling in the whole thing.
vi.mock('../src/ui.js', () => ({
    mountSidebarPanel: vi.fn(),
    openDirectorPanel: vi.fn(),
    mountDirectorPanel: vi.fn(),
}));

async function freshIndex(contextOverrides) {
    vi.resetModules();
    const ctx = installMockContext(contextOverrides);
    // index.js reads eventSource/event_types at IMPORT time, so the context
    // must be installed first, and index.js must be imported fresh every time.
    await import('../src/index.js');
    const stage = await import('../src/stage.js');
    const ui = await import('../src/ui.js');
    return { ctx, stage, ui };
}

describe('index.js event wiring', () => {
    it('APP_READY calls refresh, mountSidebarPanel, startDismissalClock, and attachTimelineWatcher, in that order', async () => {
        vi.resetModules();
        const ctx = installMockContext();
        const calls = [];

        const configMod = await import('../src/config.js');
        vi.spyOn(configMod, 'refreshActiveProfileForCurrentChat').mockImplementation(() => calls.push('refresh'));
        const stageMod = await import('../src/stage.js');
        vi.spyOn(stageMod, 'startDismissalClock').mockImplementation(() => calls.push('dismissalClock'));
        const timelineMod = await import('../src/timeline.js');
        vi.spyOn(timelineMod, 'attachTimelineWatcher').mockImplementation(() => calls.push('timeline'));
        const uiMod = await import('../src/ui.js');
        vi.spyOn(uiMod, 'mountSidebarPanel').mockImplementation(() => calls.push('sidebar'));

        await import('../src/index.js');
        ctx.eventSource.emit(ctx.event_types.APP_READY);

        expect(calls).toEqual(['refresh', 'sidebar', 'dismissalClock', 'timeline']);
    });

    it('CHARACTER_MESSAGE_RENDERED is a no-op when isActive is false', async () => {
        const { ctx } = await freshIndex();
        const config = await import('../src/config.js');
        config.loadConfig().isActive = false;
        ctx.chat = [{ mes: 'hello', is_user: false }];

        expect(() => ctx.eventSource.emit(ctx.event_types.CHARACTER_MESSAGE_RENDERED, 0)).not.toThrow();
    });

    it('CHARACTER_MESSAGE_RENDERED ignores user messages and missing messages without throwing', async () => {
        const { ctx } = await freshIndex();
        const config = await import('../src/config.js');
        config.loadConfig().isActive = true;
        ctx.chat = [{ mes: 'a user message', is_user: true }];

        expect(() => ctx.eventSource.emit(ctx.event_types.CHARACTER_MESSAGE_RENDERED, 0)).not.toThrow();
        expect(() => ctx.eventSource.emit(ctx.event_types.CHARACTER_MESSAGE_RENDERED, 99)).not.toThrow(); // out of range
    });

    it('a message with no `mes` field is treated as an empty string, not a crash (?? fallback)', async () => {
        const { ctx } = await freshIndex();
        const config = await import('../src/config.js');
        config.loadConfig().isActive = true;
        ctx.chat = [{ is_user: false }]; // no `mes` at all

        expect(() => ctx.eventSource.emit(ctx.event_types.CHARACTER_MESSAGE_RENDERED, 0)).not.toThrow();
    });

    it('CHAT_CHANGED detaches timeline, refreshes profile, resets the stage, and reattaches timeline + remounts sidebar', async () => {
        vi.resetModules();
        const ctx = installMockContext();
        const calls = [];

        const timelineMod = await import('../src/timeline.js');
        vi.spyOn(timelineMod, 'detachTimelineWatcher').mockImplementation(() => calls.push('detach'));
        vi.spyOn(timelineMod, 'attachTimelineWatcher').mockImplementation(() => calls.push('attach'));
        const configMod = await import('../src/config.js');
        vi.spyOn(configMod, 'refreshActiveProfileForCurrentChat').mockImplementation(() => calls.push('refresh'));
        const stageMod = await import('../src/stage.js');
        vi.spyOn(stageMod, 'resetStage').mockImplementation(() => calls.push('reset'));
        const uiMod = await import('../src/ui.js');
        vi.spyOn(uiMod, 'mountSidebarPanel').mockImplementation(() => calls.push('sidebar'));

        await import('../src/index.js');
        ctx.eventSource.emit(ctx.event_types.CHAT_CHANGED);

        expect(calls).toEqual(['detach', 'refresh', 'reset', 'attach', 'sidebar']);
    });
});
