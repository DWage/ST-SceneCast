import { findPortraitReferences } from './config.js';
import { isServerImagePath, deleteImageFromServer } from './utils.js';

export function safeDeleteServerImage(path) {
    if (!isServerImagePath(path)) return;
    if (findPortraitReferences(path).length === 0) {
        deleteImageFromServer(path);
    }
}
