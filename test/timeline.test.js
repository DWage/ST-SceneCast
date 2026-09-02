import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { installMockContext } from './helpers/mockContext.js';
import { mockIOInstances } from './setup.js';

async function freshTimeline(contextOverrides) {
    vi.resetModules();
    const ctx = installMockContext({ chat: [], ...contextOverrides });
    const config = await import('../src/config.js');
    const stage = await import('../src/stage.js');
    const timeline = await import('../src/timeline.js');
    return { config, stage, timeline, ctx };
}

function member(triggers, over = {}) {
    return { triggers, displayName: triggers, portrait: 'p.png', variants: [], active: true, lastArtIdx: 0, sideBias: 'auto', hitsRequired: 1, useRegex: false, excludeTriggers: '', ...over };
}

function mountChatEl({ scrollHeight = 2000, scrollTop = 0, clientHeight = 500 } = {}) {
    const chatEl = document.createElement('div');
    chatEl.id = 'chat';
    Object.defineProperty(chatEl, 'scrollHeight', { value: scrollHeight, configurable: true });
    Object.defineProperty(chatEl, 'scrollTop', { value: scrollTop, configurable: true });
    Object.defineProperty(chatEl, 'clientHeight', { value: clientHeight, configurable: true });
    document.body.appendChild(chatEl);
    return chatEl;
}

function mountMessage(chatEl, mesId) {
    const el = document.createElement('div');
    el.className = 'mes';
    el.setAttribute('mesid', String(mesId));
    chatEl.appendChild(el);
    return el;
}

describe('attachTimelineWatcher / detachTimelineWatcher', () => {
    it('no-ops when isActive is false or timelineSync is false', async () => {
        const { config, timeline } = await freshTimeline();
        mountChatEl();
        config.loadConfig().timelineSync = false;
        timeline.attachTimelineWatcher();
        expect(timeline.isTimelineActive()).toBe(false);

        config.loadConfig().timelineSync = true;
        config.loadConfig().isActive = false;
        timeline.attachTimelineWatcher();
        expect(timeline.isTimelineActive()).toBe(false);
    });

    it('is idempotent — attaching twice does not create two IntersectionObservers', async () => {
        const { config, timeline } = await freshTimeline();
        mountChatEl();
        config.loadConfig().timelineSync = true;
        timeline.attachTimelineWatcher();
        timeline.attachTimelineWatcher();
        expect(mockIOInstances.length).toBe(1);
    });

    it('does not throw and does not activate when #chat is missing', async () => {
        const { config, timeline } = await freshTimeline();
        config.loadConfig().timelineSync = true;
        expect(() => timeline.attachTimelineWatcher()).not.toThrow();
        expect(timeline.isTimelineActive()).toBe(false);
    });

    it('detachTimelineWatcher resets currentSnapshotMesId and repaints the live stage', async () => {
        const { config, timeline, stage } = await freshTimeline();
        const chatEl = mountChatEl();
        config.loadConfig().timelineSync = true;
        timeline.attachTimelineWatcher();
        timeline.detachTimelineWatcher();
        expect(timeline.isTimelineActive()).toBe(false);
        expect(timeline.getCurrentSnapshotId()).toBeNull();
    });
});

describe('"near bottom" heuristic overrides visibility-based selection', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('stays in live mode (null snapshot) whenever the chat is scrolled near the bottom, even with a highly-visible earlier message', async () => {
        const { config, timeline, ctx } = await freshTimeline({
            chat: [{ mes: 'msg0' }, { mes: 'msg1' }],
        });
        const chatEl = mountChatEl({ scrollHeight: 2000, scrollTop: 1900, clientHeight: 500 }); // distance = 2000-1900-500 = -400 (<150)
        const msg0El = mountMessage(chatEl, 0);
        config.loadConfig().timelineSync = true;
        timeline.attachTimelineWatcher();

        const io = mockIOInstances[mockIOInstances.length - 1];
        io.trigger([{ target: msg0El, isIntersecting: true, intersectionRatio: 1.0 }]);

        vi.advanceTimersByTime(200); // past the 160ms debounce, timer was scheduled under fake timers

        expect(timeline.getCurrentSnapshotId()).toBeNull(); // still live, despite msg0 being 100% visible
    });
});

describe('buildTimelineSnapshot (mesId caching, last-message delegation, lookback)', () => {
    it('re-selecting the same mesId is a no-op (early return, no repaint work)', async () => {
        const { config, timeline, stage, ctx } = await freshTimeline({
            chat: [{ mes: 'Alice appears' }, { mes: 'Bob appears' }, { mes: 'Carol appears' }],
        });
        const chatEl = mountChatEl({ scrollHeight: 3000, scrollTop: 0, clientHeight: 500 }); // far from bottom
        const msg1El = mountMessage(chatEl, 1);
        config.getProfileCast('prof_default').push(member('Bob', { portrait: 'bob.png' }));
        config.loadConfig().timelineSync = true;
        timeline.attachTimelineWatcher();

        const io = mockIOInstances[mockIOInstances.length - 1];
        const paintSpy = vi.spyOn(stage, 'paintStage');

        io.trigger([{ target: msg1El, isIntersecting: true, intersectionRatio: 1.0 }]);
        await vi.waitFor(() => expect(timeline.getCurrentSnapshotId()).toBe(1), { timeout: 500 });
        const callsAfterFirst = paintSpy.mock.calls.length;

        // Fire the exact same "most visible" entry again.
        io.trigger([{ target: msg1El, isIntersecting: true, intersectionRatio: 1.0 }]);
        await new Promise((r) => setTimeout(r, 200));
        expect(paintSpy.mock.calls.length).toBe(callsAfterFirst); // no extra paint triggered
    });

    it('selecting the LAST message in chat delegates to live paintStage() rather than building a frozen snapshot', async () => {
        const { config, timeline, stage, ctx } = await freshTimeline({
            chat: [{ mes: 'Alice appears' }, { mes: 'Bob appears' }],
        });
        const chatEl = mountChatEl({ scrollHeight: 3000, scrollTop: 0, clientHeight: 500 });
        const lastMsgEl = mountMessage(chatEl, 1); // index 1 = chat.length - 1
        config.getProfileCast('prof_default').push(member('Bob', { portrait: 'bob.png' }));
        config.loadConfig().timelineSync = true;
        timeline.attachTimelineWatcher();

        const paintSpy = vi.spyOn(stage, 'paintStage');
        const io = mockIOInstances[mockIOInstances.length - 1];
        io.trigger([{ target: lastMsgEl, isIntersecting: true, intersectionRatio: 1.0 }]);

        await vi.waitFor(() => expect(paintSpy).toHaveBeenCalled(), { timeout: 500 });
        // Called with NO arguments (live mode), not a Map snapshot.
        expect(paintSpy.mock.calls[0].length).toBe(0);
    });

    it('lookback only counts AI messages, skipping is_user without spending the quota', async () => {
        const { config, timeline, stage, ctx } = await freshTimeline({
            chat: [
                { mes: 'Alice appears', is_user: false },   // 0
                { mes: 'a user message about Alice', is_user: true }, // 1 (user, skipped)
                { mes: 'nothing relevant', is_user: false }, // 2
                { mes: 'still nothing', is_user: false },    // 3 (scroll target, mesId=3)
                { mes: 'trailing message after the target', is_user: false }, // 4 — keeps mesId 3 from being chat.length-1
            ],
        });
        const chatEl = mountChatEl({ scrollHeight: 3000, scrollTop: 0, clientHeight: 500 });
        const targetEl = mountMessage(chatEl, 3);
        config.getProfileCast('prof_default').push(member('Alice', { portrait: 'alice.png' }));
        const raw = config.loadConfig();
        raw.timelineSync = true;
        raw.timelineLookback = 3; // only enough AI-message budget to reach mesId 0 if user msgs are skipped correctly

        const paintSpy = vi.spyOn(stage, 'paintStage');
        timeline.attachTimelineWatcher();

        const io = mockIOInstances[mockIOInstances.length - 1];
        io.trigger([{ target: targetEl, isIntersecting: true, intersectionRatio: 1.0 }]);

        await vi.waitFor(() => expect(timeline.getCurrentSnapshotId()).toBe(3), { timeout: 500 });

        const snapshotArg = paintSpy.mock.calls[paintSpy.mock.calls.length - 1][0];
        expect(snapshotArg).toBeInstanceOf(Map);
        // "Alice appears" (mesId 0) is 3 AI-messages back from mesId 3 ONLY if
        // the user message at mesId 1 was correctly skipped without consuming
        // one of the 3 lookback slots. If it had been counted, Alice would
        // fall outside the window and this would be empty.
        expect(snapshotArg.has(0)).toBe(true);
    });
});
describe('cap enforcement stops adding once the cap is reached (now via `continue`, matching the live scanner\'s style)', () => {
    it('the frozen snapshot never exceeds maxCastSize; matches found after the cap is full are simply not added', async () => {
        const { config, timeline, stage, ctx } = await freshTimeline({
            chat: [
                { mes: 'Alice and Bob and Carol all appear together in one message' }, // 0 (scroll target)
                { mes: 'trailing message after the target' }, // 1 — keeps mesId 0 from being chat.length-1
            ],
        });
        const chatEl = mountChatEl({ scrollHeight: 3000, scrollTop: 0, clientHeight: 500 });
        const targetEl = mountMessage(chatEl, 0);
        config.getProfileCast('prof_default').push(
            member('Alice', { portrait: 'alice.png' }),
            member('Bob', { portrait: 'bob.png' }),
            member('Carol', { portrait: 'carol.png' }),
        );
        const raw = config.loadConfig();
        raw.timelineSync = true;
        raw.maxCastSize = 2;
        timeline.attachTimelineWatcher();

        const paintSpy = vi.spyOn(stage, 'paintStage');
        const io = mockIOInstances[mockIOInstances.length - 1];
        io.trigger([{ target: targetEl, isIntersecting: true, intersectionRatio: 1.0 }]);

        await vi.waitFor(() => expect(paintSpy).toHaveBeenCalled(), { timeout: 500 });
        const snapshotArg = paintSpy.mock.calls[0][0];
        expect(snapshotArg).toBeInstanceOf(Map);
        expect(snapshotArg.size).toBe(2);
        expect(snapshotArg.has(0)).toBe(true); // Alice
        expect(snapshotArg.has(1)).toBe(true); // Bob
        expect(snapshotArg.has(2)).toBe(false); // Carol never makes it in once the cap is full
    });
});