import { toSafeMarkup, toImgSrc } from './utils.js';
import { loadConfig, persistConfig, resolveDisplayName, EXIT_STYLES, PLACEHOLDER_ART } from './config.js';
import { isTimelineActive, getCurrentSnapshotId } from './timeline.js';

export const activeCast = new Map();
const aspectMemo = new Map();

let seatOrderCounter = 0;
const stickySideMemory = new Map();  // castIdx -> 'left' | 'right'
const stickyOrderMemory = new Map(); // castIdx -> order number

export const EXIT_KEYFRAMES = {
    fade: () => [
        { opacity: 1, transform: 'scale(1)' },
        { opacity: 0, transform: 'scale(0.85)' },
    ],
    dissolve: () => [
        { opacity: 1, filter: 'blur(0px)', transform: 'scale(1)' },
        { opacity: 0, filter: 'blur(16px)', transform: 'scale(1.06)' },
    ],
    slide: (side) => [
        { opacity: 1, transform: 'translateX(0) scale(1)' },
        { opacity: 0, transform: `translateX(${side === 'left' ? '-70px' : '70px'}) scale(0.92)` },
    ],
    drop: () => [
        { opacity: 1, transform: 'translateY(0) scale(1)' },
        { opacity: 0, transform: 'translateY(50px) scale(0.9)' },
    ],
    shatter: () => [
        { opacity: 1, transform: 'scale(1) rotate(0deg)', filter: 'blur(0px)' },
        { opacity: 0, transform: 'scale(0.35) rotate(20deg)', filter: 'blur(5px)' },
    ],
};

export const EXIT_DURATIONS = { fade: 200, dissolve: 320, slide: 260, drop: 260, shatter: 300 };

function probeImageAspect(src) {
    if (!src) return Promise.resolve(1);
    if (aspectMemo.has(src)) return Promise.resolve(aspectMemo.get(src));
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            const ratio = (img.naturalWidth || 1) / (img.naturalHeight || 1);
            aspectMemo.set(src, ratio);
            resolve(ratio);
        };
        img.onerror = () => resolve(1);
        img.src = src;
    });
}

function collectArtworkList(castIdx, state) {
    const member = state.cast[castIdx];
    if (!member) return [];
    const list = [];
    if (member.portrait) list.push({ src: toImgSrc(member.portrait), tag: member.displayName || '' });
    for (const variant of (member.variants || [])) {
        if (variant.portrait) list.push({ src: toImgSrc(variant.portrait), tag: variant.label || variant.tag || '' });
    }
    return list;
}

export function cycleArtwork(castIdx, direction, targetMap = activeCast) {
    const seat = targetMap.get(castIdx);
    if (!seat) return;
    const state = loadConfig();
    const artwork = collectArtworkList(castIdx, state);
    if (artwork.length <= 1) return;

    seat.artIdx = (seat.artIdx + direction + artwork.length) % artwork.length;

    const member = state.cast[castIdx];
    if (member) {
        member.lastArtIdx = seat.artIdx; 
        persistConfig();
    }

    if (targetMap === activeCast) {
        queueStagePaint();
    } else {
        paintStage(targetMap);
    }
}

export function dismissCastMember(castIdx) {
    activeCast.delete(castIdx);
    queueStagePaint();
}

export function resetStage() {
    activeCast.clear();
    stickySideMemory.clear();
    stickyOrderMemory.clear();
    seatOrderCounter = 0;
    paintStage();
}

function toggleHold(castIdx) {
    const seat = activeCast.get(castIdx);
    if (!seat) return;
    seat.held = !seat.held;
    queueStagePaint();
}

let dismissClockHandle = null;
export function startDismissalClock() {
    if (dismissClockHandle) return;
    dismissClockHandle = setInterval(() => {
        const state = loadConfig();
        if (state.dismissMode !== 'time' || activeCast.size === 0) return;
        const now = Date.now();
        const thresholdMs = Math.max(1, state.dismissSeconds || 8) * 1000;
        const expired = [];
        for (const [castIdx, seat] of activeCast) {
            if (seat.held) continue;
            const last = seat.lastSeenAt || now;
            if (now - last >= thresholdMs) expired.push(castIdx);
        }
        if (expired.length > 0) {
            for (const castIdx of expired) activeCast.delete(castIdx);
            queueStagePaint();
        }
    }, 1000);
}

function mountStageRoot() {
    if (document.getElementById('scast-stage-root')) return;

    const root = document.createElement('div');
    root.id = 'scast-stage-root';

    const leftZone = document.createElement('div');
    leftZone.id = 'scast-stage-left';
    leftZone.className = 'scast-stage';

    const rightZone = document.createElement('div');
    rightZone.id = 'scast-stage-right';
    rightZone.className = 'scast-stage';

    root.appendChild(leftZone);
    root.appendChild(rightZone);

    document.body.appendChild(root);
}

export function applyVisualVars(el, state) {
    el.dataset.stageMode = state.stageMode || 'bento';
    el.dataset.stageFx = state.stageFx || 'none';
    el.style.setProperty('--scast-hue-deg', `${state.accentHueShift || 0}deg`);
    el.style.setProperty('--scast-card-scale', String(state.cardScale || 1));
    el.dataset.reduceMotion = state.reduceMotion ? 'true' : 'false';
    el.dataset.hideInfo = state.showInfoBar ? 'false' : 'true';
}

export function refreshStageVisuals() {
    mountStageRoot();
    applyVisualVars(document.getElementById('scast-stage-root'), loadConfig());
}

export function refreshPreviewVisuals() {
    const stage = document.getElementById('scast-preview-stage');
    if (!stage) return;
    applyVisualVars(stage, loadConfig());
}

function motionAllowed() {
    const state = loadConfig();
    if (state.reduceMotion) return false;
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
    return true;
}

function playEntranceAnim(el) {
    if (!motionAllowed()) return;
    el.classList.add('scast-entering');
    try {
        const anim = el.animate(
            [{ opacity: 0, transform: 'scale(0.85)' }, { opacity: 1, transform: 'scale(1)' }],
            { duration: 240, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)', fill: 'forwards' },
        );
        anim.onfinish = () => {
            try { anim.commitStyles(); } catch (e) {}
            anim.cancel();
            el.style.removeProperty('transform');
            el.style.removeProperty('opacity');
            requestAnimationFrame(() => el.classList.remove('scast-entering'));
        };
    } catch (e) {
        el.classList.remove('scast-entering');
    }
}

function playExitAnimThenRemove(el, side) {
    let removed = false;
    const finish = () => { if (!removed) { removed = true; el.remove(); } };

    if (!motionAllowed()) { finish(); return; }

    const state = loadConfig();
    const kind = EXIT_KEYFRAMES[state.exitAnim] ? state.exitAnim : 'fade';
    const duration = EXIT_DURATIONS[kind] || 220;
    try {
        const anim = el.animate(EXIT_KEYFRAMES[kind](side), { duration, easing: 'ease', fill: 'forwards' });
        anim.onfinish = finish;
        anim.oncancel = finish;
    } catch (e) { finish(); }
    setTimeout(finish, duration + 200);
}

function detachAndFadeOut(el, container, side) {
    const containerRect = container.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();

    el.style.gridColumn = 'auto';
    el.style.gridRow = 'auto';

    el.style.position = 'absolute';
    el.style.left = `${elRect.left - containerRect.left}px`;
    el.style.top = `${elRect.top - containerRect.top}px`;
    el.style.width = `${elRect.width}px`;
    el.style.height = `${elRect.height}px`;
    el.style.margin = '0';
    el.dataset.lifecycle = 'leaving';
    playExitAnimThenRemove(el, side);
}

function buildArtworkNav(seat, artwork, castSource) {
    const nav = document.createElement('div');
    nav.className = 'scast-card-nav';

    const prev = document.createElement('button');
    prev.type = 'button';
    prev.innerHTML = '<i class="fa-solid fa-chevron-left"></i>';
    prev.onclick = (e) => { e.stopPropagation(); cycleArtwork(seat.castIdx, -1, castSource); };

    const label = document.createElement('span');
    label.textContent = `${seat.artIdx + 1}/${artwork.length}`;

    const next = document.createElement('button');
    next.type = 'button';
    next.innerHTML = '<i class="fa-solid fa-chevron-right"></i>';
    next.onclick = (e) => { e.stopPropagation(); cycleArtwork(seat.castIdx, 1, castSource); };

    nav.append(prev, label, next);
    return nav;
}

function buildHoldButton(seat) {
    const btn = document.createElement('button');
    btn.className = 'scast-card-hold';
    btn.innerHTML = '<i class="fa-solid fa-thumbtack"></i>';
    btn.title = seat.held ? 'Release (allow auto-dismissal again)' : 'Hold (keep on stage until manually removed)';
    btn.onclick = (e) => { e.stopPropagation(); toggleHold(seat.castIdx); };
    return btn;
}

function buildDismissButton(seat) {
    const btn = document.createElement('button');
    btn.className = 'scast-card-close';
    btn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
    btn.title = 'Remove';
    btn.onclick = (e) => { e.stopPropagation(); dismissCastMember(seat.castIdx); };
    return btn;
}

function buildArchiveBadge() {
    const badge = document.createElement('div');
    badge.className = 'scast-card-archive-badge';
    badge.innerHTML = '🕰';
    badge.title = 'Historical snapshot — scroll to the latest message to interact';
    return badge;
}

function composeInfoMarkup(name, tag, showVariantTag) {
    const showTag = showVariantTag && tag && tag.toLowerCase() !== name.toLowerCase() && tag.toLowerCase() !== 'default';
    const tagHtml = showTag ? `<span class="scast-tag">${toSafeMarkup(tag)}</span>` : '';
    return `<span class="scast-name">${toSafeMarkup(name)}</span>${tagHtml}`;
}

function composeCardElement(item) {
    const { seat, artwork, art, src, span, safeToCrop, isFresh, interactive, name, showVariantTag, castSource } = item;

    const card = document.createElement('div');
    card.className = 'scast-card';
    card.dataset.lifecycle = 'live';
    card.dataset.castIdx = String(seat.castIdx);
    card.dataset.tileSpan = span;
    card.dataset.cropFit = safeToCrop ? 'smart' : 'contain';
    card.dataset.isFresh = isFresh ? 'true' : 'false';
    card.dataset.held = seat.held ? 'true' : 'false';
    card.dataset.archived = interactive ? 'false' : 'true';

    const bg = document.createElement('img');
    bg.className = 'scast-card-bg';
    bg.loading = 'lazy';
    bg.decoding = 'async';
    bg.src = src;
    bg.onerror = () => { if (bg.src !== PLACEHOLDER_ART) bg.src = PLACEHOLDER_ART; };

    const fg = document.createElement('img');
    fg.className = 'scast-card-fg';
    fg.loading = 'lazy';
    fg.decoding = 'async';
    fg.src = src;
    fg.onerror = () => { if (fg.src !== PLACEHOLDER_ART) fg.src = PLACEHOLDER_ART; };

    const info = document.createElement('div');
    info.className = 'scast-card-info';
    info.innerHTML = composeInfoMarkup(name, art?.tag || '', showVariantTag);

    const fx = document.createElement('div');
    fx.className = 'scast-fx-overlay';

    card.append(bg, fg, fx, info);

    if (artwork.length > 1) card.appendChild(buildArtworkNav(seat, artwork, castSource));

    if (interactive) {
        card.appendChild(buildHoldButton(seat));
        card.appendChild(buildDismissButton(seat));
    } else {
        card.appendChild(buildArchiveBadge());
    }

    return card;
}

function syncCardElement(item, card) {
    const { seat, artwork, art, src, span, safeToCrop, isFresh, interactive, name, showVariantTag, castSource } = item;
    card.dataset.tileSpan = span;
    card.dataset.cropFit = safeToCrop ? 'smart' : 'contain';
    card.dataset.isFresh = isFresh ? 'true' : 'false';
    card.dataset.held = seat.held ? 'true' : 'false';

    const bg = card.querySelector('.scast-card-bg');
    const fg = card.querySelector('.scast-card-fg');
    if (bg && bg.src !== src) { bg.src = src; bg.onerror = () => { if (bg.src !== PLACEHOLDER_ART) bg.src = PLACEHOLDER_ART; }; }
    if (fg && fg.src !== src) { fg.src = src; fg.onerror = () => { if (fg.src !== PLACEHOLDER_ART) fg.src = PLACEHOLDER_ART; }; }

    const info = card.querySelector('.scast-card-info');
    if (info) info.innerHTML = composeInfoMarkup(name, art?.tag || '', showVariantTag);

    const wasInteractive = card.dataset.archived !== 'true';
    card.dataset.archived = interactive ? 'false' : 'true';

    if (interactive !== wasInteractive) {
        card.querySelector('.scast-card-nav')?.remove();
        card.querySelector('.scast-card-hold')?.remove();
        card.querySelector('.scast-card-close')?.remove();
        card.querySelector('.scast-card-archive-badge')?.remove();
        if (artwork.length > 1) card.appendChild(buildArtworkNav(seat, artwork, castSource));
        if (interactive) {
            card.appendChild(buildHoldButton(seat));
            card.appendChild(buildDismissButton(seat));
        } else {
            card.appendChild(buildArchiveBadge());
        }
        return;
    }

    card.querySelector('.scast-card-nav')?.remove();
    if (artwork.length > 1) {
        const nav = buildArtworkNav(seat, artwork, castSource);
        const holdBtn = card.querySelector('.scast-card-hold');
        holdBtn ? card.insertBefore(nav, holdBtn) : card.appendChild(nav);
    }

    if (!interactive) return;

    const holdBtn = card.querySelector('.scast-card-hold');
    if (holdBtn) holdBtn.title = seat.held ? 'Release (allow auto-dismissal again)' : 'Hold (keep on stage until manually removed)';
}

function reconcileColumn(container, items, side) {
    const liveEls = new Map();
    container.querySelectorAll(':scope > .scast-card[data-lifecycle="live"]').forEach(el => {
        liveEls.set(el.dataset.castIdx, el);
    });

    const nextKeys = new Set(items.map(i => String(i.seat.castIdx)));
    const firstRects = new Map();

    for (const [key, el] of liveEls) {
        if (nextKeys.has(key)) {
            firstRects.set(key, el.getBoundingClientRect());
        } else {
            detachAndFadeOut(el, container, side);
            liveEls.delete(key);
        }
    }

    container.dataset.tileCount = String(items.length);

    for (const item of items) {
        const key = String(item.seat.castIdx);
        let card = liveEls.get(key);
        if (card) {
            syncCardElement(item, card);
            container.appendChild(card);
        } else {
            card = composeCardElement(item);
            container.appendChild(card);
            playEntranceAnim(card);
        }
    }

    for (const [key, firstRect] of firstRects) {
        const el = container.querySelector(`:scope > .scast-card[data-cast-idx="${key}"]`);
        if (!el) continue;
        const lastRect = el.getBoundingClientRect();
        if (lastRect.width === 0 || lastRect.height === 0) continue;
        if (!motionAllowed()) continue;

        const dx = firstRect.left - lastRect.left;
        const dy = firstRect.top - lastRect.top;
        const scaleX = firstRect.width / lastRect.width;
        const scaleY = firstRect.height / lastRect.height;

        const sizeChanged = Math.abs(scaleX - 1) > 0.01 || Math.abs(scaleY - 1) > 0.01;
        const moved = Math.abs(dx) >= 1 || Math.abs(dy) >= 1;
        if (!sizeChanged && !moved) continue;

        const prevOrigin = el.style.transformOrigin;
        el.style.transformOrigin = 'top left';

        try {
            const anim = el.animate(
                [
                    { transform: `translate(${dx}px, ${dy}px) scale(${scaleX}, ${scaleY})` },
                    { transform: 'translate(0, 0) scale(1, 1)' },
                ],
                { duration: 60, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
            );
            anim.onfinish = () => { el.style.transformOrigin = prevOrigin; };
            anim.oncancel = () => { el.style.transformOrigin = prevOrigin; };
        } catch (e) {
            el.style.transformOrigin = prevOrigin;
        }
    }
}

function gradeAspect(aspect) {
    const isWide = aspect > 1.2;
    const isTall = aspect < 0.85;
    const weight = isWide ? 1.0 : (isTall ? 1.5 : 1.1);
    const safeToCrop = aspect >= 0.45 && aspect <= 2.2;
    return { isWide, isTall, weight, safeToCrop };
}

function allocateSpans(items) {
    const wides = items.filter(i => i.isWide);
    const others = items.filter(i => !i.isWide);
    const ordered = [...wides, ...others];

    if (ordered.length <= 2) {
        for (const item of ordered) item.span = 'full';
        return ordered;
    }

    let halfCount = 0;
    for (const item of ordered) {
        if (item.isWide) {
            item.span = 'full';
        } else {
            halfCount++;
            item.span = 'half';
        }
    }
    if (halfCount % 2 !== 0) {
        const lastHalf = [...ordered].reverse().find(i => i.span === 'half');
        if (lastHalf && ordered.length <= 3) lastHalf.span = 'full';
    }
    return ordered;
}

let paintEpoch = 0;

export async function paintStage(overrideCast) {
    const myEpoch = ++paintEpoch;
    mountStageRoot();
    const state = loadConfig();
    const root = document.getElementById('scast-stage-root');
    applyVisualVars(root, state);

    const leftZone = document.getElementById('scast-stage-left');
    const rightZone = document.getElementById('scast-stage-right');
    if (!leftZone || !rightZone) return;

    const castSource = overrideCast || activeCast;
    const interactive = !overrideCast;

    const seats = Array.from(castSource.values());
    if (seats.length === 0) {
        leftZone.innerHTML = '';
        rightZone.innerHTML = '';
        leftZone.dataset.tileCount = '0';
        rightZone.dataset.tileCount = '0';
        stickySideMemory.clear();
        stickyOrderMemory.clear();
        return;
    }

    const currentIds = new Set(seats.map(s => s.castIdx));
    for (const key of stickySideMemory.keys()) {
        if (!currentIds.has(key)) stickySideMemory.delete(key);
    }
    for (const key of stickyOrderMemory.keys()) {
        if (!currentIds.has(key)) stickyOrderMemory.delete(key);
    }

    const items = await Promise.all(seats.map(async (seat) => {
        if (seat.order === undefined) {
            seat.order = stickyOrderMemory.has(seat.castIdx)
                ? stickyOrderMemory.get(seat.castIdx)
                : seatOrderCounter++;
            stickyOrderMemory.set(seat.castIdx, seat.order);
        }

        const artwork = collectArtworkList(seat.castIdx, state);
        const art = artwork[seat.artIdx] || artwork[0];
        const src = art?.src || '';
        const aspect = await probeImageAspect(src);
        const { isWide, isTall, weight, safeToCrop } = gradeAspect(aspect);
        const member = state.cast[seat.castIdx];
        return {
            seat, artwork, art, src, aspect, isWide, isTall, weight, safeToCrop,
            order: seat.order,
            isFresh: seat.missCounter === 0,
            name: resolveDisplayName(seat.castIdx, state),
            showVariantTag: state.showVariantTag,
            sideBias: member?.sideBias || 'auto',
            interactive,
            castSource,
        };
    }));

    if (myEpoch !== paintEpoch) return;

    items.sort((a, b) => a.order - b.order);

    let leftItems, rightItems;

    if (state.stageSide === 'left' || state.stageSide === 'right') {
        leftItems = state.stageSide === 'left' ? items : [];
        rightItems = state.stageSide === 'right' ? items : [];
    } else {
        const forcedLeft = items.filter(i => i.sideBias === 'left');
        const forcedRight = items.filter(i => i.sideBias === 'right');
        const autoItems = items.filter(i => i.sideBias !== 'left' && i.sideBias !== 'right');

        leftItems = [...forcedLeft];
        rightItems = [...forcedRight];
        let leftWeight = forcedLeft.reduce((sum, i) => sum + i.weight, 0);
        let rightWeight = forcedRight.reduce((sum, i) => sum + i.weight, 0);

        const pendingAuto = [];
        for (const item of autoItems) {
            const stickySide = stickySideMemory.get(item.seat.castIdx) ?? item.seat.autoSide;
            if (stickySide === 'left') {
                leftItems.push(item); leftWeight += item.weight;
                stickySideMemory.set(item.seat.castIdx, 'left');
            } else if (stickySide === 'right') {
                rightItems.push(item); rightWeight += item.weight;
                stickySideMemory.set(item.seat.castIdx, 'right');
            } else {
                pendingAuto.push(item);
            }
        }
        for (const item of pendingAuto) {
            if (leftWeight <= rightWeight) {
                leftItems.push(item); leftWeight += item.weight;
                stickySideMemory.set(item.seat.castIdx, 'left');
            } else {
                rightItems.push(item); rightWeight += item.weight;
                stickySideMemory.set(item.seat.castIdx, 'right');
            }
        }
    }

    leftItems.sort((a, b) => a.order - b.order);
    rightItems.sort((a, b) => a.order - b.order);

    const packedLeft = allocateSpans(leftItems);
    const packedRight = allocateSpans(rightItems);

    // leftZone.dataset.tileCount = String(packedLeft.length);
    // rightZone.dataset.tileCount = String(packedRight.length);

    reconcileColumn(rightZone, packedRight, 'right');
    reconcileColumn(leftZone, packedLeft, 'left');
}

let paintFrameHandle = null;
export function queueStagePaint() {
    if (isTimelineActive() && getCurrentSnapshotId() !== null) {
        const { chat } = SillyTavern.getContext();
        if (getCurrentSnapshotId() !== chat.length - 1) return;
    }
    if (paintFrameHandle !== null) return;
    paintFrameHandle = requestAnimationFrame(() => {
        paintFrameHandle = null;
        paintStage();
    });
}
