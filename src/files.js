import { loadConfig, persistConfig, normalizeMember, getProfileCast, IMAGE_SUBFOLDER } from './config.js';
import {
    parseTriggerList, sanitizeForFilename, announce,
    uploadImageToServer, isServerImagePath, toImgSrc,
} from './utils.js';
import { safeDeleteServerImage } from './image-guard.js';

function isTopLevelFile(file) {
    const rel = file.webkitRelativePath || '';
    if (!rel) return true;
    const depth = rel.split('/').filter(Boolean).length;
    return depth <= 2;
}

export function clusterFilesByCast(fileList) {
    const files = Array.from(fileList)
        .filter(f => /\.(png|jpe?g|webp|gif|bmp)$/i.test(f.name))
        .filter(isTopLevelFile)
        .sort((a, b) => a.name.localeCompare(b.name));

    const groups = new Map();

    for (const file of files) {
        const dot = file.name.lastIndexOf('.');
        const base = dot > 0 ? file.name.slice(0, dot) : file.name;
        const underscoreAt = base.indexOf('_');

        const namesPart = underscoreAt === -1 ? base : base.slice(0, underscoreAt);
        const variantPart = underscoreAt === -1 ? null : base.slice(underscoreAt + 1);

        // '+' separates multiple characters in a group shot (e.g. "Alice+Sarah_default.png").
        const names = namesPart.split('+').map(s => s.trim()).filter(Boolean);
        if (names.length === 0) continue;
        const groupKey = names.map(n => n.toLowerCase()).join(',');

        if (!groups.has(groupKey)) groups.set(groupKey, { names, variants: [], portraitFile: null });
        const group = groups.get(groupKey);

        if (variantPart === null) {
        if (!group.portraitFile) {
            group.portraitFile = file;
        } else {
            const dot = file.name.lastIndexOf('.');
            const ext = dot > 0 ? file.name.slice(dot + 1).toLowerCase() : 'file';
            let label = `alt-${ext}`;
            let n = 2;
            while (group.variants.some(v => v.label === label)) {
                label = `alt-${ext}-${n++}`;
            }
            group.variants.push({ tag: label, label, file });
        }
} else {
    const label = variantPart.replace(/-/g, ' ').trim() || 'variant';
    group.variants.push({ tag: label, label, file });
}
    }
    return groups;
}

async function uploadGroupAssets(group) {
    let portrait = null;
    if (group.portraitFile) portrait = await uploadImageToServer(group.portraitFile, IMAGE_SUBFOLDER);

    const variants = [];
    for (const v of group.variants) {
        const portraitPath = await uploadImageToServer(v.file, IMAGE_SUBFOLDER);
        variants.push({ tag: v.tag, label: v.label, portrait: portraitPath });
    }
    if (!portrait && variants.length > 0) portrait = variants[0].portrait;
    return { portrait, variants };
}

export async function bulkImportArtwork(fileList, profileId) {
    const cast = getProfileCast(profileId);
    const groups = clusterFilesByCast(fileList);

    const knownNames = new Set();
    for (const member of cast) {
        for (const term of parseTriggerList(member.triggers)) knownNames.add(term.toLowerCase());
    }

    let added = 0, skipped = 0;
    const failed = [];

    for (const [, group] of groups) {
        const conflict = group.names.some(n => knownNames.has(n.toLowerCase()));
        if (conflict) { skipped++; continue; }
        if (!group.portraitFile && group.variants.length === 0) continue;

        try {
            const { portrait, variants } = await uploadGroupAssets(group);
            if (!portrait) continue;

            cast.push(normalizeMember({
                triggers: group.names.join(', '), portrait, displayName: group.names[0], variants,
            }));
            for (const n of group.names) knownNames.add(n.toLowerCase());
            added++;
        } catch (err) {
            console.error('[SceneCast] import failed for group', group.names, err);
            failed.push(group.names.join('-'));
        }
    }

    persistConfig();
    const failNote = failed.length ? `, ${failed.length} failed (${failed.slice(0, 3).join(', ')}${failed.length > 3 ? '…' : ''})` : '';
    announce(`Import finished: ${added} added, ${skipped} skipped${failNote}`);
    return { added, skipped, failed };
}

export async function upsertDroppedArtwork(fileList, profileId) {
    const cast = getProfileCast(profileId);
    const groups = clusterFilesByCast(fileList);

    let created = 0, portraitsUpdated = 0, variantsAdded = 0, variantsUpdated = 0;
    const failed = [];

    for (const [, group] of groups) {
        try {
            const namesLower = group.names.map(n => n.toLowerCase());
            const target = cast.find(m => parseTriggerList(m.triggers).some(t => namesLower.includes(t.toLowerCase())));

            if (!target) {
                if (!group.portraitFile && group.variants.length === 0) continue;
                const { portrait, variants } = await uploadGroupAssets(group);
                if (!portrait) continue;
                cast.push(normalizeMember({
                    triggers: group.names.join(', '), portrait, displayName: group.names[0], variants,
                }));
                created++;
                continue;
            }

            normalizeMember(target);
            if (group.portraitFile) {
                const oldPath = target.portrait;
                target.portrait = await uploadImageToServer(group.portraitFile, IMAGE_SUBFOLDER);
                if (isServerImagePath(oldPath) && oldPath !== target.portrait) safeDeleteServerImage(oldPath);
                portraitsUpdated++;
            }
            for (const v of group.variants) {
                const existing = target.variants.find(x => (x.label || x.tag || '').toLowerCase() === v.label.toLowerCase());
                const newPath = await uploadImageToServer(v.file, IMAGE_SUBFOLDER);
                if (existing) {
                    const oldPath = existing.portrait;
                    existing.portrait = newPath;
                    if (isServerImagePath(oldPath) && oldPath !== newPath) safeDeleteServerImage(oldPath);
                    variantsUpdated++;
                } else {
                    target.variants.push({ tag: v.tag, label: v.label, portrait: newPath });
                    variantsAdded++;
                }
            }
            if (!target.portrait && target.variants.length > 0) {
                target.portrait = target.variants[0].portrait;
            }
        } catch (err) {
            console.error('[SceneCast] drop-import failed for group', group.names, err);
            failed.push(group.names.join('-'));
        }
    }

    persistConfig();
    const failNote = failed.length ? `, ${failed.length} failed (${failed.slice(0, 3).join(', ')}${failed.length > 3 ? '…' : ''})` : '';
    announce(`Drop processed: ${created} created, ${portraitsUpdated} portrait(s) updated, ${variantsAdded} added, ${variantsUpdated} updated${failNote}`);
    return { created, portraitsUpdated, variantsAdded, variantsUpdated, failed };
}

async function downloadServerImage(path, baseFilename) {
    const src = toImgSrc(path);
    const extMatch = /\.(\w+)(?:\?.*)?$/.exec(path);
    const ext = extMatch ? extMatch[1] : 'png';
    try {
        const response = await fetch(src);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const blob = await response.blob();
        const objectUrl = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = objectUrl;
        link.download = `${baseFilename}.${ext}`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(objectUrl), 200);
        return true;
    } catch (e) {
        console.warn('[SceneCast] export failed for', path, e);
        return false;
    }
}

export async function exportCastArtwork(profileId) {
    const cast = getProfileCast(profileId);
    let count = 0;
    let failed = 0;

    for (const member of cast) {
        const names = parseTriggerList(member.triggers);
        if (names.length === 0) continue;
        const baseName = sanitizeForFilename(names.join('-'));

        if (member.portrait) {
            if (await downloadServerImage(member.portrait, baseName)) count++;
            else failed++;
        }
        for (const variant of (member.variants || [])) {
            if (!variant.portrait) continue;
            const slug = sanitizeForFilename((variant.tag || variant.label || 'variant').replace(/\s+/g, '-'));
            if (await downloadServerImage(variant.portrait, `${baseName}_${slug}`)) count++;
            else failed++;
        }
    }

    const failNote = failed > 0 ? `, ${failed} failed` : '';
    announce(
        count > 0
            ? `Exported ${count} image(s)${failNote} — check your downloads folder`
            : (failed > 0 ? `Export failed for all ${failed} image(s)` : 'Nothing to export yet')
    );
    return count;
}
