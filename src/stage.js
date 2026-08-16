import { loadConfig, PLACEHOLDER_ART } from './config.js';
import { toSafeMarkup, toImgSrc } from './utils.js';

export const activeCast = new Map();
let paintFrameHandle = null;

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

    const stageZone = document.createElement('div');
    stageZone.id = 'scast-stage-zone';
    stageZone.className = 'scast-stage';

    root.appendChild(stageZone);
    document.body.appendChild(root);
}

export function paintStage() {
    mountStageRoot();
    const state = loadConfig();
    const zone = document.getElementById('scast-stage-zone');
    if (!zone) return;

    zone.innerHTML = '';

    for (const [castIdx, seat] of activeCast) {
        const member = state.cast[castIdx];
        if (!member) continue;

        const card = document.createElement('div');
        card.className = 'scast-card';
        
        const src = toImgSrc(member.portrait);

        card.innerHTML = `
            <img class="scast-card-bg" src="${src}" onerror="this.onerror=null;this.src='${PLACEHOLDER_ART}'" />
            <img class="scast-card-fg" src="${src}" onerror="this.onerror=null;this.src='${PLACEHOLDER_ART}'" />
            <div class="scast-card-info"><span class="scast-name">${toSafeMarkup(member.displayName || '')}</span></div>
            <button class="scast-card-close"><i class="fa-solid fa-xmark"></i></button>
        `;

        card.querySelector('.scast-card-close').onclick = (e) => {
            e.stopPropagation();
            dismissCastMember(castIdx);
        };

        zone.appendChild(card);
    }
}

export function queueStagePaint() {
    if (paintFrameHandle !== null) return;
    paintFrameHandle = requestAnimationFrame(() => {
        paintFrameHandle = null;
        paintStage();
    });
}