import { vi, beforeEach, afterEach } from 'vitest';

window.matchMedia = vi.fn((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
}));

export const mockIOInstances = [];

class MockIntersectionObserver {
    constructor(callback, options) {
        this.callback = callback;
        this.options = options;
        this.observedElements = new Set();
        mockIOInstances.push(this);
    }
    observe(el) { this.observedElements.add(el); }
    unobserve(el) { this.observedElements.delete(el); }
    disconnect() { this.observedElements.clear(); }
    trigger(entries) { this.callback(entries, this); }
}
global.IntersectionObserver = MockIntersectionObserver;
window.IntersectionObserver = MockIntersectionObserver;

Element.prototype.animate = function animate() {
    const anim = {
        onfinish: null,
        oncancel: null,
        finish() { if (typeof this.onfinish === 'function') this.onfinish(); },
        cancel() { if (typeof this.oncancel === 'function') this.oncancel(); },
    };
    return anim;
};

HTMLCanvasElement.prototype.getContext = function getContext() {
    return {
        imageSmoothingEnabled: true,
        imageSmoothingQuality: 'high',
        drawImage: vi.fn(),
    };
};
HTMLCanvasElement.prototype.toBlob = function toBlob(callback, type) {
    callback(new Blob(['fake-resized-bytes'], { type: type || 'image/png' }));
};

class MockFileReader {
    constructor() {
        this.onload = null;
        this.onerror = null;
        this.result = null;
        this.error = null;
    }
    readAsDataURL(blob) {
        queueMicrotask(() => {
            const type = (blob && blob.type) || 'application/octet-stream';
            this.result = `data:${type};base64,bW9jaw==`; // "mock", content is irrelevant
            this.onload && this.onload();
        });
    }
}
global.FileReader = MockFileReader;
window.FileReader = MockFileReader;

global.createImageBitmap = vi.fn(async () => {
    if (global.__mockImageBitmapReject) throw new Error('mock bitmap decode failure');
    const dims = global.__mockImageBitmap || { width: 800, height: 600 };
    return { width: dims.width, height: dims.height, close: vi.fn() };
});

Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn(async () => undefined) },
    configurable: true,
});

if (!URL.createObjectURL) URL.createObjectURL = vi.fn(() => 'blob:mock-url');
else URL.createObjectURL = vi.fn(() => 'blob:mock-url');
if (!URL.revokeObjectURL) URL.revokeObjectURL = vi.fn();
else URL.revokeObjectURL = vi.fn();

global.__mockImageDims = {};

class MockImage {
    constructor() {
        this._src = '';
        this.onload = null;
        this.onerror = null;
    }
    set src(value) {
        this._src = value;
        const dims = global.__mockImageDims[value] || { width: 200, height: 260 };
        Promise.resolve().then(() => {
            if (dims.error) { this.onerror && this.onerror(); return; }
            this.naturalWidth = dims.width;
            this.naturalHeight = dims.height;
            this.onload && this.onload();
        });
    }
    get src() { return this._src; }
}
global.Image = MockImage;
window.Image = MockImage;

let rafQueue = [];
global.requestAnimationFrame = (cb) => { rafQueue.push(cb); return rafQueue.length; };
global.cancelAnimationFrame = () => {};
window.requestAnimationFrame = global.requestAnimationFrame;

export function flushRAF() {
    const queue = rafQueue;
    rafQueue = [];
    for (const cb of queue) cb(performance.now());
}

if (typeof structuredClone === 'undefined') {
    global.structuredClone = (obj) => JSON.parse(JSON.stringify(obj));
}

beforeEach(() => {
    document.body.innerHTML = '';
    global.__mockImageDims = {};
    global.__mockImageBitmap = null;
    global.__mockImageBitmapReject = false;
    mockIOInstances.length = 0;
    rafQueue = [];
});

afterEach(() => {
    vi.restoreAllMocks();
});
