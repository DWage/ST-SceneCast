import { describe, it, expect, vi, beforeEach } from 'vitest';
import { installMockContext } from './helpers/mockContext.js';
import {
    toSafeMarkup, parseTriggerList, debounce, attachOutsideClickToClose,
    compressImageFile, uploadImageToServer, deleteImageFromServer,
    listServerImages, isServerImagePath, toImgSrc,
} from '../src/utils.js';

describe('toSafeMarkup', () => {
    it('escapes & < > "', () => {
        expect(toSafeMarkup(`<a href="x">&Tom</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&amp;Tom&lt;/a&gt;');
    });
    it('handles empty/null/undefined', () => {
        expect(toSafeMarkup('')).toBe('');
        expect(toSafeMarkup(null)).toBe('');
        expect(toSafeMarkup(undefined)).toBe('');
    });
});

describe('parseTriggerList', () => {
    it('splits on comma, trims, drops empties', () => {
        expect(parseTriggerList(' Alice ,, Bob ,Sarah  ')).toEqual(['Alice', 'Bob', 'Sarah']);
    });
    it('handles null/empty', () => {
        expect(parseTriggerList('')).toEqual([]);
        expect(parseTriggerList(null)).toEqual([]);
    });
});

describe('debounce', () => {
    beforeEach(() => vi.useFakeTimers());
    it('resets the timer on repeated calls and only invokes the last call', () => {
        const fn = vi.fn();
        const debounced = debounce(fn, 100);
        debounced('first');
        vi.advanceTimersByTime(50);
        debounced('second');
        vi.advanceTimersByTime(50);
        expect(fn).not.toHaveBeenCalled(); // still within the reset window
        vi.advanceTimersByTime(50);
        expect(fn).toHaveBeenCalledTimes(1);
        expect(fn).toHaveBeenCalledWith('second');
    });
});

describe('attachOutsideClickToClose', () => {
    it('closes only when both mousedown AND mouseup land on the overlay itself', () => {
        const overlay = document.createElement('div');
        const inner = document.createElement('div');
        overlay.appendChild(inner);
        document.body.appendChild(overlay);

        const closeFn = vi.fn();
        attachOutsideClickToClose(overlay, closeFn);

        // Simulate a genuine background click: both events target overlay.
        const down = new MouseEvent('mousedown', { bubbles: true });
        Object.defineProperty(down, 'target', { value: overlay });
        overlay.dispatchEvent(down);
        const up = new MouseEvent('mouseup', { bubbles: true });
        Object.defineProperty(up, 'target', { value: overlay });
        overlay.dispatchEvent(up);

        expect(closeFn).toHaveBeenCalledTimes(1);
    });

    it('does NOT close on a drag that starts inside and releases on the overlay (or vice versa)', () => {
        const overlay = document.createElement('div');
        const inner = document.createElement('div');
        overlay.appendChild(inner);
        document.body.appendChild(overlay);

        const closeFn = vi.fn();
        attachOutsideClickToClose(overlay, closeFn);

        const down = new MouseEvent('mousedown', { bubbles: true });
        Object.defineProperty(down, 'target', { value: inner }); // mousedown started INSIDE
        overlay.dispatchEvent(down);

        const up = new MouseEvent('mouseup', { bubbles: true });
        Object.defineProperty(up, 'target', { value: overlay });
        overlay.dispatchEvent(up);

        expect(closeFn).not.toHaveBeenCalled();
    });
});

describe('compressImageFile', () => {
    it('passes through non-image files using the filename extension', async () => {
        const file = new File(['abc'], 'notes.txt', { type: 'text/plain' });
        const result = await compressImageFile(file);
        expect(result.blob).toBe(file);
        expect(result.format).toBe('txt');
    });

    it('passes through images already under MAX_LONG_SIDE without compressing', async () => {
        global.__mockImageBitmap = { width: 600, height: 400 };
        const file = new File(['abc'], 'small.png', { type: 'image/png' });
        const result = await compressImageFile(file);
        expect(result.blob).toBe(file);
        expect(result.format).toBe('png');
    });

    it('falls back to passthrough (no throw) when createImageBitmap fails', async () => {
        global.__mockImageBitmapReject = true;
        const file = new File(['abc'], 'broken.png', { type: 'image/png' });
        const result = await compressImageFile(file);
        expect(result.blob).toBe(file);
        expect(result.format).toBe('png');
    });

    it('resizes large images and maps jpeg->jpg / else->png', async () => {
        global.__mockImageBitmap = { width: 4000, height: 2000 };
        const file = new File(['a'.repeat(20)], 'huge.jpg', { type: 'image/jpeg' });
        // canvas.toBlob stub returns a small fixed-size blob, guaranteed smaller
        // than our oversized "huge" original, so compression should be kept.
        const result = await compressImageFile(file);
        expect(result.format).toBe('jpg');
        expect(result.blob).not.toBe(file);
    });

    it('reverts to the original when the "compressed" result is not actually smaller', async () => {
        global.__mockImageBitmap = { width: 4000, height: 2000 };
        // Make the original file body shorter than the fixed 19-byte stub blob
        // produced by our canvas.toBlob mock ("fake-resized-bytes" = 19 bytes),
        // so the size check `blob.size >= file.size` trips and we fall back.
        const file = new File(['x'], 'tiny-original.jpg', { type: 'image/jpeg' });
        const result = await compressImageFile(file);
        expect(result.blob).toBe(file);
        expect(result.format).toBe('jpg');
    });
});

describe('uploadImageToServer / deleteImageFromServer / listServerImages', () => {
    beforeEach(() => {
        installMockContext();
        global.fetch = vi.fn();
    });

    it('uploadImageToServer throws with response detail on non-ok response', async () => {
        global.fetch.mockResolvedValue({ ok: false, status: 500, text: async () => 'server exploded' });
        const file = new File(['x'], 'a.png', { type: 'image/png' });
        await expect(uploadImageToServer(file, 'scenecast')).rejects.toThrow(/HTTP 500/);
    });

    it('uploadImageToServer throws if the response has no path', async () => {
        global.fetch.mockResolvedValue({ ok: true, json: async () => ({}) });
        const file = new File(['x'], 'a.png', { type: 'image/png' });
        await expect(uploadImageToServer(file, 'scenecast')).rejects.toThrow(/no path/i);
    });

    it('uploadImageToServer resolves the server path on success', async () => {
        global.fetch.mockResolvedValue({ ok: true, json: async () => ({ path: 'user/images/scenecast/x.png' }) });
        const file = new File(['x'], 'a.png', { type: 'image/png' });
        await expect(uploadImageToServer(file, 'scenecast')).resolves.toBe('user/images/scenecast/x.png');
    });

    it('deleteImageFromServer returns false for empty or non-scenecast paths without hitting the network', async () => {
        expect(await deleteImageFromServer('')).toBe(false);
        expect(await deleteImageFromServer('user/images/other/x.png')).toBe(false);
        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('deleteImageFromServer returns false (not throw) on network failure', async () => {
        global.fetch.mockRejectedValue(new Error('network down'));
        const result = await deleteImageFromServer('user/images/scenecast/x.png');
        expect(result).toBe(false);
    });

    it('listServerImages maps both string entries and object entries (path vs url)', async () => {
        global.fetch.mockResolvedValue({
            ok: true,
            json: async () => (['plain.png', { path: 'user/images/scenecast/obj-path.png' }, { url: 'user/images/scenecast/obj-url.png' }]),
        });
        const result = await listServerImages('scenecast');
        expect(result).toEqual([
            { filename: 'plain.png', path: 'user/images/scenecast/plain.png' },
            { filename: 'obj-path.png', path: 'user/images/scenecast/obj-path.png' },
            { filename: 'obj-url.png', path: 'user/images/scenecast/obj-url.png' },
        ]);
    });

    it('listServerImages throws on non-ok response', async () => {
        global.fetch.mockResolvedValue({ ok: false, status: 404, text: async () => 'not found' });
        await expect(listServerImages('scenecast')).rejects.toThrow(/HTTP 404/);
    });
});

describe('isServerImagePath / toImgSrc', () => {
    it('isServerImagePath rejects data URIs and empty values', () => {
        expect(isServerImagePath('data:image/png;base64,xxx')).toBe(false);
        expect(isServerImagePath('')).toBe(false);
        expect(isServerImagePath(null)).toBe(false);
        expect(isServerImagePath('user/images/scenecast/a.png')).toBe(true);
    });

    it('toImgSrc leaves data:/http/leading-slash paths untouched, prefixes everything else', () => {
        expect(toImgSrc('')).toBe('');
        expect(toImgSrc('data:image/png;base64,xx')).toBe('data:image/png;base64,xx');
        expect(toImgSrc('http://example.com/a.png')).toBe('http://example.com/a.png');
        expect(toImgSrc('/already/rooted.png')).toBe('/already/rooted.png');
        expect(toImgSrc('user/images/scenecast/a.png')).toBe('/user/images/scenecast/a.png');
    });
});
