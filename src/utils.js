export function toSafeMarkup(str) {
    if (!str) return '';
    const escapes = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
    return str.replace(/[&<>"]/g, ch => escapes[ch]);
}

export function parseTriggerList(str) {
    return (str || '').split(',').map(s => s.trim()).filter(Boolean);
}

export function debounce(fn, wait) {
    let handle = null;
    return (...args) => {
        clearTimeout(handle);
        handle = setTimeout(() => fn(...args), wait);
    };
}

const MAX_LONG_SIDE = 1280;
const JPEG_QUALITY = 0.88;

function extensionFromFilename(name) {
    const m = /\.([a-zA-Z0-9]+)$/.exec(name || '');
    return m ? m[1].toLowerCase() : null;
}

function mimeToFormat(mimeType) {
    if (!mimeType) return 'png';
    if (mimeType.includes('jpeg') || mimeType.includes('jpg')) return 'jpg';
    if (mimeType.includes('png')) return 'png';
    if (mimeType.includes('webp')) return 'webp';
    return 'png';
}

export async function compressImageFile(file) {
    const passthroughFormat = extensionFromFilename(file?.name) || mimeToFormat(file?.type);
    if (!file || !file.type || !file.type.startsWith('image/')) {
        return { blob: file, format: passthroughFormat };
    }

    let bitmap;
    try {
        bitmap = await createImageBitmap(file);
    } catch (e) {
        return { blob: file, format: passthroughFormat };
    }

    const { width, height } = bitmap;
    const longSide = Math.max(width, height);

    if (longSide <= MAX_LONG_SIDE) {
        bitmap.close?.();
        return { blob: file, format: passthroughFormat };
    }

    const scale = MAX_LONG_SIDE / longSide;
    const targetW = Math.max(1, Math.round(width * scale));
    const targetH = Math.max(1, Math.round(height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, targetW, targetH);
    bitmap.close?.();

    const outputIsJpeg = file.type === 'image/jpeg';
    const outputType = outputIsJpeg ? 'image/jpeg' : 'image/png';
    const quality = outputIsJpeg ? JPEG_QUALITY : undefined;

    const blob = await new Promise(resolve => canvas.toBlob(resolve, outputType, quality));
    if (!blob || blob.size >= file.size) {
        return { blob: file, format: passthroughFormat };
    }
    return { blob, format: outputIsJpeg ? 'jpg' : 'png' };
}

export function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
    });
}

export async function uploadImageToServer(fileOrBlob, subfolder) {
    const { blob, format } = await compressImageFile(fileOrBlob);
    const fullDataUri = await blobToBase64(blob);
    const rawBase64 = fullDataUri.split(',')[1] || fullDataUri;

    const ctx = SillyTavern.getContext();
    const filename = `scast_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const response = await fetch('/api/images/upload', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...ctx.getRequestHeaders(),
        },
        body: JSON.stringify({
            image: rawBase64,
            format,
            ch_name: subfolder,
            filename,
        }),
    });

    if (!response.ok) throw new Error('Upload failed');
    const data = await response.json();
    if (!data?.path) throw new Error('No path returned');
    return data.path;
}

export async function deleteImageFromServer(path) {
    if (!path || !path.includes('scenecast')) return false;
    try {
        const ctx = SillyTavern.getContext();
        const response = await fetch('/api/images/delete', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...ctx.getRequestHeaders(),
            },
            body: JSON.stringify({ path }),
        });
        return response.ok;
    } catch (e) {
        return false;
    }
}

export function isServerImagePath(value) {
    return typeof value === 'string' && value.length > 0 && !value.startsWith('data:');
}

export function toImgSrc(path) {
    if (!path) return '';
    if (path.startsWith('data:') || path.startsWith('http') || path.startsWith('/')) return path;
    return `/${path}`;
}