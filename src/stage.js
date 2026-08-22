import { loadConfig, persistConfig, PLACEHOLDER_ART } from './config.js';
import { toSafeMarkup, toImgSrc } from './utils.js';

export const activeCast = new Map();
let paintFrameHandle = null;

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

export function cycleArtwork(castIdx, direction) {
    const seat = activeCast.get(castIdx);
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
    queueStagePaint();
}

export function dismissCastMember(castIdx) {
    activeCast.delete(castIdx);
    queueStagePaint();
}

export function resetStage() {
    activeCast.clear();
    paintStage();
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
    el.style.setProperty('--scast-hue-deg', `${state.accentHueShift || 0}deg`);
    el.style.setProperty('--scast-card-scale', String(state.cardScale || 1));
    el.dataset.hideInfo = state.showInfoBar ? 'false' : 'true';
}

function composeCardElement(item) {
    const { seat, artwork, art, src, name, showVariantTag } = item;

    const card = document.createElement('div');
    card.className = 'scast-card';
    card.dataset.castIdx = String(seat.castIdx);
    card.dataset.cropFit = 'smart';

    const showTag = showVariantTag && art?.tag && art.tag.toLowerCase() !== name.toLowerCase();
    const tagHtml = showTag ? `<span class="scast-tag">${toSafeMarkup(art.tag)}</span>` : '';

    card.innerHTML = `
        <img class="scast-card-bg" src="${src}" onerror="this.onerror=null;this.src='${PLACEHOLDER_ART}'" />
        <img class="scast-card-fg" src="${src}" onerror="this.onerror=null;this.src='${PLACEHOLDER_ART}'" />
        <div class="scast-card-info"><span class="scast-name">${toSafeMarkup(name)}</span>${tagHtml}</div>
        <button class="scast-card-close"><i class="fa-solid fa-xmark"></i></button>
    `;

    card.querySelector('.scast-card-close').onclick = (e) => {
        e.stopPropagation();
        dismissCastMember(seat.castIdx);
    };

    if (artwork.length > 1) {
        const nav = document.createElement('div');
        nav.className = 'scast-card-nav';
        nav.innerHTML = `
            <button type="button" class="scast-nav-prev"><i class="fa-solid fa-chevron-left"></i></button>
            <span>${seat.artIdx + 1}/${artwork.length}</span>
            <button type="button" class="scast-nav-next"><i class="fa-solid fa-chevron-right"></i></button>
        `;
        nav.querySelector('.scast-nav-prev').onclick = (e) => { e.stopPropagation(); cycleArtwork(seat.castIdx, -1); };
        nav.querySelector('.scast-nav-next').onclick = (e) => { e.stopPropagation(); cycleArtwork(seat.castIdx, 1); };
        card.appendChild(nav);
    }

    return card;
}

export function paintStage() {
    mountStageRoot();
    const state = loadConfig();
    const root = document.getElementById('scast-stage-root');
    applyVisualVars(root, state);

    const leftZone = document.getElementById('scast-stage-left');
    const rightZone = document.getElementById('scast-stage-right');
    if (!leftZone || !rightZone) return;

    leftZone.innerHTML = '';
    rightZone.innerHTML = '';

    const seats = Array.from(activeCast.values());
    if (seats.length === 0) return;

    const items = seats.map((seat) => {
        const artwork = collectArtworkList(seat.castIdx, state);
        const art = artwork[seat.artIdx] || artwork[0];
        const src = art?.src || '';
        const member = state.cast[seat.castIdx];
        return {
            seat, artwork, art, src,
            name: member?.displayName || (member?.triggers || '').split(',')[0]?.trim() || 'Cast member',
            showVariantTag: state.showVariantTag,
            sideBias: member?.sideBias || 'auto',
        };
    });

    let leftItems, rightItems;
    if (state.stageSide === 'left') {
        leftItems = items; rightItems = [];
    } else if (state.stageSide === 'right') {
        leftItems = []; rightItems = items;
    } else {
        leftItems = []; rightItems = [];
        items.forEach((item, index) => {
            if (item.sideBias === 'left') leftItems.push(item);
            else if (item.sideBias === 'right') rightItems.push(item);
            else {
                if (index % 2 === 0) leftItems.push(item);
                else rightItems.push(item);
            }
        });
    }

    leftItems.forEach(i => leftZone.appendChild(composeCardElement(i)));
    rightItems.forEach(i => rightZone.appendChild(composeCardElement(i)));
}

export function queueStagePaint() {
    if (paintFrameHandle !== null) return;
    paintFrameHandle = requestAnimationFrame(() => {
        paintFrameHandle = null;
        paintStage();
    });
}