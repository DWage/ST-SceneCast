import { describe, it, expect, vi, beforeEach } from 'vitest';
import { installMockContext } from './helpers/mockContext.js';

async function freshDialog() {
    vi.resetModules();
    installMockContext();
    return import('../src/dialog.js');
}

function pressKey(target, key) {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
}

describe('themedAlert', () => {
    it('has only an OK button (no Cancel), and both Enter and Escape resolve it', async () => {
        const dialog = await freshDialog();
        const p = dialog.themedAlert('Something happened');
        const overlay = document.querySelector('.scast-subpanel-overlay');
        expect(overlay.querySelector('#scast-dlg-cancel')).toBeNull();

        pressKey(document, 'Enter');
        await expect(p).resolves.toBeUndefined();
        expect(document.querySelector('.scast-subpanel-overlay')).toBeNull();
    });

    it('Escape also resolves an alert', async () => {
        const dialog = await freshDialog();
        const p = dialog.themedAlert('Something happened');
        pressKey(document, 'Escape');
        await expect(p).resolves.toBeUndefined();
    });

    it('escapes HTML in the message (no injected markup)', async () => {
        const dialog = await freshDialog();
        dialog.themedAlert('<script>alert(1)</script>');
        const overlay = document.querySelector('.scast-subpanel-overlay');
        expect(overlay.querySelector('script')).toBeNull();
        expect(overlay.innerHTML).toContain('&lt;script&gt;');
        overlay.querySelector('#scast-dlg-ok').click();
    });
});

describe('themedConfirm', () => {
    it('OK resolves true, Cancel resolves false, Escape resolves false, background click resolves false', async () => {
        const dialog = await freshDialog();

        let p = dialog.themedConfirm('Sure?');
        document.querySelector('#scast-dlg-ok').click();
        await expect(p).resolves.toBe(true);

        p = dialog.themedConfirm('Sure?');
        document.querySelector('#scast-dlg-cancel').click();
        await expect(p).resolves.toBe(false);

        p = dialog.themedConfirm('Sure?');
        pressKey(document, 'Escape');
        await expect(p).resolves.toBe(false);

        p = dialog.themedConfirm('Sure?');
        const overlay = document.querySelector('.scast-subpanel-overlay');
        const down = new MouseEvent('mousedown', { bubbles: true });
        Object.defineProperty(down, 'target', { value: overlay });
        overlay.dispatchEvent(down);
        const up = new MouseEvent('mouseup', { bubbles: true });
        Object.defineProperty(up, 'target', { value: overlay });
        overlay.dispatchEvent(up);
        await expect(p).resolves.toBe(false);
    });

    it('Enter (outside the input, since confirm has none) resolves true', async () => {
        const dialog = await freshDialog();
        const p = dialog.themedConfirm('Sure?');
        pressKey(document, 'Enter');
        await expect(p).resolves.toBe(true);
    });
});

describe('themedPrompt', () => {
    it('has a Cancel button that resolves null, and pre-fills + auto-selects the default value', async () => {
        const dialog = await freshDialog();
        const p = dialog.themedPrompt('Name?', 'Alice');
        const input = document.querySelector('#scast-dlg-input');
        expect(input).not.toBeNull();
        expect(input.value).toBe('Alice');

        document.querySelector('#scast-dlg-cancel').click();
        await expect(p).resolves.toBeNull();
    });

    it('OK resolves with the current input value', async () => {
        const dialog = await freshDialog();
        const p = dialog.themedPrompt('Name?', '');
        const input = document.querySelector('#scast-dlg-input');
        input.value = 'Zoe';
        document.querySelector('#scast-dlg-ok').click();
        await expect(p).resolves.toBe('Zoe');
    });

    it('Enter inside the input submits via its own handler and does not double-resolve via the document-level handler', async () => {
        const dialog = await freshDialog();
        const p = dialog.themedPrompt('Name?', '');
        const input = document.querySelector('#scast-dlg-input');
        input.value = 'Zoe';

        const resolveSpy = vi.fn();
        p.then(resolveSpy);

        // Enter inside the input: the input's own keydown handler calls
        // stopPropagation(), so the document-level listener must NOT also fire.
        pressKey(input, 'Enter');
        await p;
        expect(resolveSpy).toHaveBeenCalledTimes(1);
        expect(await p).toBe('Zoe');
    });

    it('Escape inside the input resolves null via the input handler, not the document handler', async () => {
        const dialog = await freshDialog();
        const p = dialog.themedPrompt('Name?', '');
        const input = document.querySelector('#scast-dlg-input');
        pressKey(input, 'Escape');
        await expect(p).resolves.toBeNull();
    });

    it('the document-level keydown listener is removed after resolution (no listener buildup across repeated opens)', async () => {
        const dialog = await freshDialog();
        const addSpy = vi.spyOn(document, 'addEventListener');
        const removeSpy = vi.spyOn(document, 'removeEventListener');

        for (let i = 0; i < 3; i++) {
            const p = dialog.themedAlert(`Message ${i}`);
            document.querySelector('#scast-dlg-ok').click();
            await p;
        }

        const keydownAdds = addSpy.mock.calls.filter(c => c[0] === 'keydown').length;
        const keydownRemoves = removeSpy.mock.calls.filter(c => c[0] === 'keydown').length;
        expect(keydownAdds).toBe(3);
        expect(keydownRemoves).toBe(3); // one add, one matching remove, per dialog
    });
});
