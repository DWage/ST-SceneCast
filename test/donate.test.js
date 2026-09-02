import { describe, it, expect, vi, beforeEach } from 'vitest';
import { installMockContext } from './helpers/mockContext.js';

async function freshDonate() {
    vi.resetModules();
    const ctx = installMockContext();
    const config = await import('../src/config.js');
    const donate = await import('../src/donate.js');
    return { config, donate, ctx };
}

describe('createHeartButton / openDonateModal', () => {
    it('a button created before ever liking reflects the not-liked state', async () => {
        const { donate } = await freshDonate();
        const btn = donate.createHeartButton();
        expect(btn.classList.contains('liked')).toBe(false);
    });

    it('openDonateModal sets heartLiked exactly once (persistConfig not re-triggered on repeat opens)', async () => {
        const { config, donate, ctx } = await freshDonate();
        donate.openDonateModal();
        expect(config.loadConfig().heartLiked).toBe(true);
        const callsAfterFirst = ctx.saveSettingsDebounced.mock.calls.length;

        document.getElementById('scast-donate-overlay').classList.remove('visible');
        donate.openDonateModal(); // second open — already liked
        expect(ctx.saveSettingsDebounced.mock.calls.length).toBe(callsAfterFirst); // no extra persist call
    });

    it('a button created AFTER liking immediately reflects the liked state (not just on next modal open)', async () => {
        const { config, donate } = await freshDonate();
        config.loadConfig().heartLiked = true; // simulate already-liked from a previous session
        const btn = donate.createHeartButton();
        expect(btn.classList.contains('liked')).toBe(true);
    });

    it('liking updates EVERY registered heart button at once (sidebar + panel in sync)', async () => {
        const { donate } = await freshDonate();
        const sidebarBtn = donate.createHeartButton();
        const panelBtn = donate.createHeartButton();
        document.body.appendChild(sidebarBtn);
        document.body.appendChild(panelBtn);
        expect(sidebarBtn.classList.contains('liked')).toBe(false);
        expect(panelBtn.classList.contains('liked')).toBe(false);

        donate.openDonateModal();

        expect(sidebarBtn.classList.contains('liked')).toBe(true);
        expect(panelBtn.classList.contains('liked')).toBe(true);
    });

    it('clicking a heart button opens the modal and does not bubble/propagate the click', async () => {
        const { donate } = await freshDonate();
        const btn = donate.createHeartButton();
        document.body.appendChild(btn);
        const outerHandler = vi.fn();
        document.body.addEventListener('click', outerHandler);

        btn.click();
        expect(document.getElementById('scast-donate-overlay')?.classList.contains('visible')).toBe(true);
        expect(outerHandler).not.toHaveBeenCalled(); // stopPropagation() in the click handler
    });
});

describe('heartButtons registry no longer leaks: detached buttons are pruned on the next like-driven refresh', () => {
    it('a still-mounted button gets synced; detached buttons are pruned instead of updated, and nothing throws', async () => {
        const { donate } = await freshDonate();

        const detachedButtons = [];
        for (let i = 0; i < 50; i++) {
            const btn = donate.createHeartButton();
            document.body.appendChild(btn);
            document.body.removeChild(btn); // detach — real sidebar remounts do exactly this
            detachedButtons.push(btn);
        }
        const stillMounted = donate.createHeartButton();
        document.body.appendChild(stillMounted);

        expect(() => donate.openDonateModal()).not.toThrow();

        expect(stillMounted.classList.contains('liked')).toBe(true);
        // Pruned rather than synced — they never got their classList touched.
        for (const btn of detachedButtons) {
            expect(btn.classList.contains('liked')).toBe(false);
        }
    });
});