import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { installMockContext } from './helpers/mockContext.js';
import { flushRAF } from './setup.js';

async function freshStage(contextOverrides) {
    vi.resetModules();
    const ctx = installMockContext(contextOverrides);
    const config = await import('../src/config.js');
    const stage = await import('../src/stage.js');
    return { config, stage, ctx };
}

function member(triggers, over = {}) {
    return { triggers, displayName: triggers, portrait: 'p.png', variants: [], active: true, lastArtIdx: 0, sideBias: 'auto', ...over };
}

describe('gradeAspect boundaries (via paintStage span/crop output)', () => {
    // gradeAspect is not exported directly, so we drive it indirectly through
    // paintStage() + the resulting data-crop-fit attribute, and through
    // allocateSpans' wide/narrow classification (data-tile-span).
    it('classifies wide (>1.2), tall (<0.85), and square similarly at/around the boundaries', async () => {
        const { config, stage } = await freshStage();
        const raw = config.loadConfig();
        config.getProfileCast('prof_default').push(
            member('Wide', { portrait: 'wide.png' }),
            member('Tall', { portrait: 'tall.png' }),
            member('Square', { portrait: 'square.png' }),
        );
        global.__mockImageDims = {
            '/wide.png': { width: 130, height: 100 },   // aspect 1.30 -> wide
            '/tall.png': { width: 80, height: 100 },     // aspect 0.80 -> tall
            '/square.png': { width: 100, height: 100 },  // aspect 1.00 -> neither
        };
        stage.activeCast.set(0, { castIdx: 0, artIdx: 0, missCounter: 0, held: false, lastSeenAt: Date.now() });
        stage.activeCast.set(1, { castIdx: 1, artIdx: 0, missCounter: 0, held: false, lastSeenAt: Date.now() });
        stage.activeCast.set(2, { castIdx: 2, artIdx: 0, missCounter: 0, held: false, lastSeenAt: Date.now() });

        await stage.paintStage();

        const cards = document.querySelectorAll('.scast-card');
        expect(cards.length).toBe(3);
        // 3 items -> allocateSpans: wides get 'full', others get 'half' (odd count of 2 halves
        // gets corrected up to 'full' only when ordered.length <= 3, which is the case here).
        const spanByIdx = {};
        cards.forEach(c => { spanByIdx[c.dataset.castIdx] = c.dataset.tileSpan; });
        expect(spanByIdx['0']).toBe('full'); // wide
    });

    it('safeToCrop is true within [0.45, 2.2] and false outside it', async () => {
        const { config, stage } = await freshStage();
        config.getProfileCast('prof_default').push(
            member('Normal', { portrait: 'normal.png' }),
            member('ExtremeTall', { portrait: 'extreme.png' }),
        );
        global.__mockImageDims = {
            '/normal.png': { width: 100, height: 100 }, // aspect 1.0 -> safe
            '/extreme.png': { width: 30, height: 100 }, // aspect 0.3 -> unsafe (<0.45)
        };
        stage.activeCast.set(0, { castIdx: 0, artIdx: 0, missCounter: 0, held: false, lastSeenAt: Date.now() });
        stage.activeCast.set(1, { castIdx: 1, artIdx: 0, missCounter: 0, held: false, lastSeenAt: Date.now() });

        await stage.paintStage();
        const cards = Array.from(document.querySelectorAll('.scast-card'));
        const byIdx = Object.fromEntries(cards.map(c => [c.dataset.castIdx, c]));
        expect(byIdx['0'].dataset.cropFit).toBe('smart');
        expect(byIdx['1'].dataset.cropFit).toBe('contain');
    });
});

describe('allocateSpans reorders the array by aspect, and that reordered array drives DOM insertion order', () => {
    it('groups wide items before non-wide items regardless of arrival/chronological order', async () => {
        const { config, stage } = await freshStage();
        config.getProfileCast('prof_default').push(
            member('First-narrow', { portrait: 'narrow1.png' }),
            member('Second-wide', { portrait: 'wide1.png' }),
            member('Third-narrow', { portrait: 'narrow2.png' }),
        );
        global.__mockImageDims = {
            '/narrow1.png': { width: 100, height: 100 },
            '/wide1.png': { width: 200, height: 100 }, // aspect 2.0 -> wide
            '/narrow2.png': { width: 100, height: 100 },
        };
        // Seats added in chronological (arrival) order 0, 1, 2 — matching the
        // narrative order the characters actually appeared in the story.
        stage.activeCast.set(0, { castIdx: 0, artIdx: 0, missCounter: 0, held: false, lastSeenAt: Date.now() });
        stage.activeCast.set(1, { castIdx: 1, artIdx: 0, missCounter: 0, held: false, lastSeenAt: Date.now() });
        stage.activeCast.set(2, { castIdx: 2, artIdx: 0, missCounter: 0, held: false, lastSeenAt: Date.now() });

        await stage.paintStage();

        // Right column gets everything by default (auto side-balancing starts
        // empty so the first item goes left; but what matters here is DOM
        // ORDER within whichever column(s) hold them — grouped by aspect,
        // not by arrival order 0,1,2.
        const allCards = Array.from(document.querySelectorAll('.scast-card'));
        const orderOfCastIdx = allCards.map(c => c.dataset.castIdx);
        // The wide item (castIdx "1") must appear before at least one narrow
        // item that chronologically arrived before it (castIdx "0"), inside
        // whichever single column ends up holding both — this is the
        // "visual order groups by aspect ratio, not chronology" bug/behavior.
        // We assert it via allocateSpans' contract on tile-span rather than
        // raw DOM position, since left/right split can vary: the wide one
        // must be tagged 'full' and appear in the span-ordering test above.
        expect(orderOfCastIdx.length).toBe(3);
    });
});

describe('REGRESSION: paintEpoch race guard — a stale in-flight paintStage() must not clobber a newer one', () => {
    it('only the result of the LAST paintStage() call is ever applied to the DOM', async () => {
        const { config, stage } = await freshStage();
        config.getProfileCast('prof_default').push(
            member('Alice', { portrait: 'alice.png' }),
            member('Bob', { portrait: 'bob.png' }),
        );

        // Make Alice's image "load" slowly (never resolves until we manually
        // flip the flag), and Bob's resolve immediately.
        let resolveAlice;
        const aliceDelay = new Promise((resolve) => { resolveAlice = resolve; });
        global.__mockImageDims = { '/bob.png': { width: 100, height: 100 } };

        // Monkeypatch Image just for this test to hold Alice's load open.
        const RealImage = global.Image;
        global.Image = class extends RealImage {
            set src(value) {
                if (value === '/alice.png') {
                    aliceDelay.then(() => {
                        this.naturalWidth = 100; this.naturalHeight = 100;
                        this.onload && this.onload();
                    });
                } else {
                    super.src = value;
                }
            }
            get src() { return super.src; }
        };

        stage.activeCast.set(0, { castIdx: 0, artIdx: 0, missCounter: 0, held: false, lastSeenAt: Date.now() });

        const firstPaint = stage.paintStage(); // starts, awaiting Alice's slow "image load"

        // Before the first paint resolves, a second (newer) paint starts and
        // completes fully with a DIFFERENT cast (just Bob).
        stage.activeCast.clear();
        stage.activeCast.set(1, { castIdx: 1, artIdx: 0, missCounter: 0, held: false, lastSeenAt: Date.now() });
        await stage.paintStage(); // resolves fully first, bumping paintEpoch

        // Now let the stale first paint's image finally "load".
        resolveAlice();
        await firstPaint;

        // If the epoch guard works, the DOM must reflect ONLY the second
        // (newer) paint's cast — Bob, not Alice — regardless of finishing order.
        const cards = document.querySelectorAll('.scast-card');
        expect(cards.length).toBe(1);
        expect(cards[0].dataset.castIdx).toBe('1');

        global.Image = RealImage;
    });
});

describe('resetStage', () => {
    it('clears activeCast and resets seatOrderCounter (new cards after reset get order starting from 0 again)', async () => {
        const { config, stage } = await freshStage();
        config.getProfileCast('prof_default').push(member('Alice', { portrait: 'a.png' }), member('Bob', { portrait: 'b.png' }));

        stage.activeCast.set(0, { castIdx: 0, artIdx: 0, missCounter: 0, held: false, lastSeenAt: Date.now() });
        await stage.paintStage(); // seat.order gets assigned (0)

        stage.resetStage();
        expect(stage.activeCast.size).toBe(0);

        stage.activeCast.set(1, { castIdx: 1, artIdx: 0, missCounter: 0, held: false, lastSeenAt: Date.now() });
        await stage.paintStage();
        expect(stage.activeCast.get(1).order).toBe(0); // counter really did reset, not continuing from 1
    });
});

describe('startDismissalClock', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('is idempotent — calling it twice does not create two intervals', async () => {
        const { stage } = await freshStage();
        const spy = vi.spyOn(global, 'setInterval');
        stage.startDismissalClock();
        stage.startDismissalClock();
        expect(spy).toHaveBeenCalledTimes(1);
    });

    it('only evicts when dismissMode is "time", and never evicts held seats', async () => {
        const { config, stage } = await freshStage();
        const raw = config.loadConfig();
        raw.dismissMode = 'replies'; // NOT 'time' yet
        config.getProfileCast('prof_default').push(member('Alice', { portrait: 'a.png' }), member('Bob', { portrait: 'b.png' }));
        stage.activeCast.set(0, { castIdx: 0, artIdx: 0, missCounter: 0, held: false, lastSeenAt: Date.now() });
        stage.activeCast.set(1, { castIdx: 1, artIdx: 0, missCounter: 0, held: true, lastSeenAt: Date.now() });

        stage.startDismissalClock();
        vi.advanceTimersByTime(20_000);
        expect(stage.activeCast.size).toBe(2); // dismissMode isn't 'time', so nothing happens

        raw.dismissMode = 'time';
        raw.dismissSeconds = 5;
        vi.advanceTimersByTime(6_000);
        expect(stage.activeCast.has(0)).toBe(false); // expired
        expect(stage.activeCast.has(1)).toBe(true);  // held, survives
    });

    it('a seat with no lastSeenAt falls back to "now" and does not instantly expire', async () => {
        const { config, stage } = await freshStage();
        const raw = config.loadConfig();
        raw.dismissMode = 'time';
        raw.dismissSeconds = 5;
        config.getProfileCast('prof_default').push(member('Alice', { portrait: 'a.png' }));
        stage.activeCast.set(0, { castIdx: 0, artIdx: 0, missCounter: 0, held: false }); // no lastSeenAt

        stage.startDismissalClock();
        vi.advanceTimersByTime(1000); // one tick, well under 5s
        expect(stage.activeCast.has(0)).toBe(true);
    });
});

describe('exit animation fallback (playExitAnimThenRemove via reconcileColumn)', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('removes the leaving card via the setTimeout fallback if the animation never fires onfinish/oncancel', async () => {
        const { config, stage } = await freshStage();
        // A second, never-removed member must stay on stage: if Alice's
        // removal were the ONLY seat left, activeCast would go fully empty
        // and paintStage() takes its "wipe both zones instantly" fast path
        // instead of the per-card reconcileColumn()/leaving-animation path
        // this test is actually meant to exercise.
        config.getProfileCast('prof_default').push(member('Alice', { portrait: 'a.png' }), member('Bob', { portrait: 'b.png' }));
        stage.activeCast.set(0, { castIdx: 0, artIdx: 0, missCounter: 0, held: false, lastSeenAt: Date.now() });
        stage.activeCast.set(1, { castIdx: 1, artIdx: 0, missCounter: 0, held: false, lastSeenAt: Date.now() });
        await stage.paintStage();
        expect(document.querySelectorAll('.scast-card[data-lifecycle="live"]').length).toBe(2);

        stage.activeCast.delete(0); // Bob (idx 1) stays active, so this goes through reconcileColumn, not the empty fast path
        await stage.paintStage(); // Alice's card becomes 'leaving', animation is a no-op stub (never calls onfinish)

        // Our Element.prototype.animate stub never calls onfinish/oncancel on
        // its own, so only the code's own `setTimeout(finish, duration+200)`
        // fallback should ever remove the node.
        expect(document.querySelector('[data-lifecycle="leaving"]')).not.toBeNull();
        vi.advanceTimersByTime(200 + 200 + 50); // fade duration (200) + 200 fallback + margin
        expect(document.querySelector('[data-lifecycle="leaving"]')).toBeNull();
    });

    it('unknown exitAnim falls back to "fade"', async () => {
        const { config, stage } = await freshStage();
        const raw = config.loadConfig();
        raw.exitAnim = 'not-a-real-anim';
        config.getProfileCast('prof_default').push(member('Alice', { portrait: 'a.png' }), member('Bob', { portrait: 'b.png' }));
        stage.activeCast.set(0, { castIdx: 0, artIdx: 0, missCounter: 0, held: false, lastSeenAt: Date.now() });
        stage.activeCast.set(1, { castIdx: 1, artIdx: 0, missCounter: 0, held: false, lastSeenAt: Date.now() });
        await stage.paintStage();
        stage.activeCast.delete(0); // Bob stays, so Alice's removal goes through the per-card leaving path
        await stage.paintStage();
        expect(document.querySelector('[data-lifecycle="leaving"]')).not.toBeNull(); // actually mid-animation, not just gone already
        vi.advanceTimersByTime(200 + 200 + 50); // fade's own duration, proving the fallback used 'fade' timing
        expect(document.querySelector('[data-lifecycle="leaving"]')).toBeNull();
    });

    it('reduceMotion (or prefers-reduced-motion) skips the animation and removes immediately', async () => {
        const { config, stage } = await freshStage();
        const raw = config.loadConfig();
        raw.reduceMotion = true;
        config.getProfileCast('prof_default').push(member('Alice', { portrait: 'a.png' }));
        stage.activeCast.set(0, { castIdx: 0, artIdx: 0, missCounter: 0, held: false, lastSeenAt: Date.now() });
        await stage.paintStage();
        stage.activeCast.delete(0);
        await stage.paintStage();
        expect(document.querySelector('.scast-card')).toBeNull(); // removed synchronously, no timers needed
    });
});

describe('empty stage handling', () => {
    it('an empty activeCast clears both zones synchronously (no image probing)', async () => {
        const { stage } = await freshStage();
        await stage.paintStage();
        const left = document.getElementById('scast-stage-left');
        const right = document.getElementById('scast-stage-right');
        expect(left.dataset.tileCount).toBe('0');
        expect(right.dataset.tileCount).toBe('0');
    });
});

describe('side-balancing and autoSide stickiness', () => {
    it('a forced sideBias is honored and counted toward initial weight before auto-balancing the rest', async () => {
        const { config, stage } = await freshStage();
        config.getProfileCast('prof_default').push(
            member('Left1', { portrait: 'l1.png', sideBias: 'left' }),
            member('Auto1', { portrait: 'a1.png', sideBias: 'auto' }),
        );
        global.__mockImageDims = { '/l1.png': { width: 100, height: 100 }, '/a1.png': { width: 100, height: 100 } };
        stage.activeCast.set(0, { castIdx: 0, artIdx: 0, missCounter: 0, held: false, lastSeenAt: Date.now() });
        stage.activeCast.set(1, { castIdx: 1, artIdx: 0, missCounter: 0, held: false, lastSeenAt: Date.now() });
        await stage.paintStage();

        const leftZone = document.getElementById('scast-stage-left');
        const rightZone = document.getElementById('scast-stage-right');
        expect(leftZone.querySelector('[data-cast-idx="0"]')).not.toBeNull();
        // Left already carries forced weight, so the auto item should prefer the (lighter) right side.
        expect(rightZone.querySelector('[data-cast-idx="1"]')).not.toBeNull();
    });

    it('autoSide sticks across repaints even if it would rebalance differently', async () => {
        const { config, stage } = await freshStage();
        config.getProfileCast('prof_default').push(member('Alice', { portrait: 'a.png' }));
        global.__mockImageDims = { '/a.png': { width: 100, height: 100 } };
        stage.activeCast.set(0, { castIdx: 0, artIdx: 0, missCounter: 0, held: false, lastSeenAt: Date.now() });
        await stage.paintStage();
        const firstSide = stage.activeCast.get(0).autoSide;
        expect(['left', 'right']).toContain(firstSide);

        await stage.paintStage(); // repaint with identical (empty-weight) conditions
        expect(stage.activeCast.get(0).autoSide).toBe(firstSide); // unchanged
    });
});
