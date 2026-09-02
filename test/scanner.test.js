import { describe, it, expect, vi, beforeEach } from 'vitest';
import { installMockContext } from './helpers/mockContext.js';

// scanner.js has no state of its own worth resetting (its regex caches are an
// implementation detail we test indirectly), but it transitively pulls in
// stage.js's `activeCast` Map, which absolutely must be fresh per test.
async function freshScanner(contextOverrides) {
    vi.resetModules();
    const ctx = installMockContext(contextOverrides);
    const stage = await import('../src/stage.js');
    const scanner = await import('../src/scanner.js');
    return { scanner, stage, ctx };
}

describe('countTermHits / evaluateTrigger (unicode word boundaries)', () => {
    it('matches whole words only, case-insensitively by default', async () => {
        const { scanner } = await freshScanner();
        expect(scanner.countTermHits('Alice walked in', 'alice', false)).toBe(1);
        expect(scanner.countTermHits('Alicetown was empty', 'alice', false)).toBe(0);
        expect(scanner.countTermHits('ALICE!', 'alice', false)).toBe(1);
    });

    it('respects case-sensitive mode', async () => {
        const { scanner } = await freshScanner();
        expect(scanner.countTermHits('alice walked in', 'Alice', true)).toBe(0);
        expect(scanner.countTermHits('Alice walked in', 'Alice', true)).toBe(1);
    });

    it('evaluateTrigger needs >= `needed` combined hits across all comma-separated terms', async () => {
        const { scanner } = await freshScanner();
        const text = 'Alice waved. Sally waved back. Alice smiled.';
        expect(scanner.evaluateTrigger(text, 'Alice, Sally', false, 3, false)).toBe(true); // 2+1=3
        expect(scanner.evaluateTrigger(text, 'Alice, Sally', false, 4, false)).toBe(false);
    });

    it('needed=0 is coerced to 1 via `needed || 1`', async () => {
        const { scanner } = await freshScanner();
        expect(scanner.evaluateTrigger('Alice is here', 'Alice', false, 0, false)).toBe(true);
        expect(scanner.evaluateTrigger('no match here', 'Alice', false, 0, false)).toBe(false);
    });
});

describe('regex cache lastIndex reset (both boundary + user-pattern caches)', () => {
    it('buildBoundaryPattern resets lastIndex on a cached hit, so repeated calls with different text are correct', async () => {
        const { scanner } = await freshScanner();
        // First use "primes" the cache and advances lastIndex internally via .match().
        expect(scanner.countTermHits('Alice is here', 'Alice', false)).toBe(1);
        // If lastIndex were not reset on cache retrieval, a global-flag regex could
        // silently fail to match starting from a stale internal cursor on the 2nd text.
        expect(scanner.countTermHits('Alice is here again', 'Alice', false)).toBe(1);
        expect(scanner.countTermHits('Alice, Alice, Alice', 'Alice', false)).toBe(3);
    });

    it('countPatternHits (user regex, sticky `g` cache) also resets lastIndex before each use', async () => {
        const { scanner } = await freshScanner();
        const pattern = 'Al\\w*';
        expect(scanner.countPatternHits('Alice is here', pattern, false)).toBe(1);
        // Same cached RegExp object, different text — must not be affected by the
        // previous call having left `lastIndex` at a nonzero position.
        expect(scanner.countPatternHits('Alistair and Alice', pattern, false)).toBe(2);
        expect(scanner.countPatternHits('nothing matches this one', pattern, false)).toBe(0);
        // ...and back to a matching text again, to be extra sure the cursor didn't stick at 0-from-failure either.
        expect(scanner.countPatternHits('Alice again', pattern, false)).toBe(1);
    });

    it('an invalid user regex fails closed (no throw, zero hits) rather than crashing the scan', async () => {
        const { scanner } = await freshScanner();
        expect(scanner.countPatternHits('anything', '(unclosed', false)).toBe(0);
        expect(scanner.evaluateTrigger('anything', '(unclosed', false, 1, true)).toBe(false);
    });
});

describe('isSuppressed', () => {
    it('returns false with no suppress terms configured', async () => {
        const { scanner } = await freshScanner();
        expect(scanner.isSuppressed('John Wick walked in', '', false)).toBe(false);
    });
    it('blocks when any suppress term is present', async () => {
        const { scanner } = await freshScanner();
        expect(scanner.isSuppressed('John Wick walked in', 'Wick', false)).toBe(true);
    });
});

describe('stripNestedTag (<details> stripping)', () => {
    it('strips nested/balanced tags of the same name, case-insensitively', async () => {
        const { scanner } = await freshScanner();
        const text = 'before <details>outer <details>inner</details> tail</details> after';
        expect(scanner.stripNestedTag(text, 'details')).toBe('before  after');
    });

    it('an unclosed tag discards the entire rest of the text', async () => {
        const { scanner } = await freshScanner();
        const text = 'Alice says hi. <details>OOC notes that never close, and then Bob appears here too.';
        const stripped = scanner.stripNestedTag(text, 'details');
        expect(stripped).toBe('Alice says hi. ');
        expect(stripped).not.toContain('Bob'); // documents the data-loss trade-off
    });

    it('leaves text with no tags untouched', async () => {
        const { scanner } = await freshScanner();
        expect(scanner.stripNestedTag('plain text, no tags', 'details')).toBe('plain text, no tags');
    });
});

describe('stripMarkerSpan (custom ignore-markers, and quote-stripping)', () => {
    it('strips everything between paired markers, across multiple occurrences', async () => {
        const { scanner } = await freshScanner();
        const text = 'A [hide]secret1[/hide] B [hide]secret2[/hide] C';
        expect(scanner.stripMarkerSpan(text, '[hide]', '[/hide]')).toBe('A  B  C');
    });

    it('an unclosed marker discards the rest of the text from the start marker onward', async () => {
        const { scanner } = await freshScanner();
        const text = 'A [hide]secret and Bob is mentioned here but never closed';
        const stripped = scanner.stripMarkerSpan(text, '[hide]', '[/hide]');
        expect(stripped).toBe('A ');
        expect(stripped).not.toContain('Bob');
    });

    it('returns the text unchanged if either marker is empty', async () => {
        const { scanner } = await freshScanner();
        expect(scanner.stripMarkerSpan('A [hide]x[/hide] B', '', '[/hide]')).toBe('A [hide]x[/hide] B');
    });
});

describe('prepareScanText (filter ordering)', () => {
    it('quotes nested inside <details> are already gone by the time quote-stripping runs', async () => {
        const { scanner } = await freshScanner();
        const state = { hideDetailsBlocks: true, ignoreQuotedNames: true, ignoreMarkerStart: '', ignoreMarkerEnd: '' };
        const text = '<details>"Alice" said something</details> "Bob" said hi';
        const result = scanner.prepareScanText(text, state);
        // <details> block (including the quoted "Alice") is gone entirely after
        // the first filter, so the quote filter only ever sees — and only ever
        // strips — the remaining "Bob" quote, never touching "Alice" at all.
        expect(result).not.toContain('Alice');
        expect(result).not.toContain('Bob');
        expect(result).toBe('  said hi');
    });
});

describe('applyExpiryByReplies (via processIncomingMessage) — per dismissMode', () => {
    function makeMember(triggers, over = {}) {
        return { triggers, portrait: 'p.png', active: true, hitsRequired: 1, useRegex: false, excludeTriggers: '', variants: [], lastArtIdx: 0, ...over };
    }

    it('mode "replies": expires a member after keepAliveReplies consecutive misses', async () => {
        const { scanner, stage, ctx } = await freshScanner();
        const config = await import('../src/config.js');
        const raw = config.loadConfig();
        raw.dismissMode = 'replies';
        raw.keepAliveReplies = 1;
        config.getProfileCast('prof_default').push(makeMember('Alice'));

        scanner.processIncomingMessage('Alice appears.');
        expect(stage.activeCast.has(0)).toBe(true);

        scanner.processIncomingMessage('Nothing relevant happens.'); // miss #1, within keepAlive
        expect(stage.activeCast.has(0)).toBe(true);

        scanner.processIncomingMessage('Still nothing.'); // miss #2, exceeds keepAlive(1)
        expect(stage.activeCast.has(0)).toBe(false);
    });

    it('mode "time"/"manual": missCounter increments but the member is never evicted here', async () => {
        const { scanner, stage } = await freshScanner();
        const config = await import('../src/config.js');
        const raw = config.loadConfig();
        raw.dismissMode = 'time';
        config.getProfileCast('prof_default').push(makeMember('Alice'));

        scanner.processIncomingMessage('Alice appears.');
        scanner.processIncomingMessage('Nothing relevant.');
        scanner.processIncomingMessage('Still nothing.');
        scanner.processIncomingMessage('Still nothing, again.');

        expect(stage.activeCast.has(0)).toBe(true); // never auto-removed by this function
        expect(stage.activeCast.get(0).missCounter).toBe(3);
    });

    it('a held member is never expired even past keepAliveReplies, in "replies" mode', async () => {
        const { scanner, stage } = await freshScanner();
        const config = await import('../src/config.js');
        const raw = config.loadConfig();
        raw.dismissMode = 'replies';
        raw.keepAliveReplies = 0;
        config.getProfileCast('prof_default').push(makeMember('Alice'));

        scanner.processIncomingMessage('Alice appears.');
        stage.activeCast.get(0).held = true;

        scanner.processIncomingMessage('Nothing.');
        scanner.processIncomingMessage('Nothing again.');
        expect(stage.activeCast.has(0)).toBe(true);
    });

    it('a re-matched member resets missCounter to 0 even while held', async () => {
        const { scanner, stage } = await freshScanner();
        const config = await import('../src/config.js');
        config.loadConfig().dismissMode = 'replies';
        config.getProfileCast('prof_default').push(makeMember('Alice'));

        scanner.processIncomingMessage('Alice appears.');
        stage.activeCast.get(0).missCounter = 5;
        scanner.processIncomingMessage('Alice again.');
        expect(stage.activeCast.get(0).missCounter).toBe(0);
    });
});

describe('processIncomingMessage — gating and cap enforcement', () => {
    function makeMember(triggers, over = {}) {
        return { triggers, portrait: 'p.png', active: true, hitsRequired: 1, useRegex: false, excludeTriggers: '', variants: [], lastArtIdx: 0, ...over };
    }

    it('no-op when isActive is false or cast is empty', async () => {
        const { scanner, stage } = await freshScanner();
        const config = await import('../src/config.js');
        config.loadConfig().isActive = false;
        config.getProfileCast('prof_default').push(makeMember('Alice'));
        scanner.processIncomingMessage('Alice appears.');
        expect(stage.activeCast.size).toBe(0);
    });

    it('skips members with no portrait, or with active=false, even on a trigger match', async () => {
        const { scanner, stage } = await freshScanner();
        const config = await import('../src/config.js');
        config.getProfileCast('prof_default').push(
            makeMember('Alice', { portrait: '' }),
            makeMember('Bob', { active: false }),
        );
        scanner.processIncomingMessage('Alice and Bob both appear.');
        expect(stage.activeCast.size).toBe(0);
    });

    it('suppress terms block an otherwise-matching trigger', async () => {
        const { scanner, stage } = await freshScanner();
        const config = await import('../src/config.js');
        config.getProfileCast('prof_default').push(makeMember('Wick', { excludeTriggers: 'John Wick' }));
        scanner.processIncomingMessage('John Wick walked into the room.');
        expect(stage.activeCast.size).toBe(0);
    });

    it('once the cap is full, new matches are silently ignored (no eviction of existing members)', async () => {
        const { scanner, stage } = await freshScanner();
        const config = await import('../src/config.js');
        const raw = config.loadConfig();
        raw.maxCastSize = 1;
        raw.stageSide = 'both';
        config.getProfileCast('prof_default').push(makeMember('Alice'), makeMember('Bob'));

        scanner.processIncomingMessage('Alice appears.');
        expect(stage.activeCast.has(0)).toBe(true);

        // Mention Alice again (so her seat stays "fresh" and isn't expired by
        // the default replies/keepAlive=0 dismiss rules) alongside Bob, who
        // should be turned away because the cap is already full.
        scanner.processIncomingMessage('Alice and Bob both appear now.');
        expect(stage.activeCast.has(1)).toBe(false); // cap(1) reached, Bob never gets a seat
        expect(stage.activeCast.size).toBe(1);
    });

    it('an already-active member on a repeat match is mutated in place, not replaced', async () => {
        const { scanner, stage } = await freshScanner();
        const config = await import('../src/config.js');
        config.getProfileCast('prof_default').push(makeMember('Alice'));

        scanner.processIncomingMessage('Alice appears.');
        const seatRef = stage.activeCast.get(0);
        seatRef.artIdx = 3; // simulate the user having cycled artwork

        scanner.processIncomingMessage('Alice appears again.');
        expect(stage.activeCast.get(0)).toBe(seatRef); // same object identity
        expect(stage.activeCast.get(0).artIdx).toBe(3); // not reset by the re-match
        expect(stage.activeCast.get(0).missCounter).toBe(0);
    });
});
