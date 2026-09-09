import { loadConfig, getEffectiveCastCap } from './config.js';
import { prepareScanText, evaluateTrigger, isSuppressed } from './scanner.js';
import { paintStage } from './stage.js';

let timelineObserver = null;
let timelineMutationObserver = null;
let timelineActive = false;
let currentSnapshotMesId = null;
let visibilityMemo = new Map();
let observedNodes = new WeakSet();
let pickDebounceHandle = null;

export function isTimelineActive() { return timelineActive; }
export function getCurrentSnapshotId() { return currentSnapshotMesId; }

function observeNode(el) {
    if (observedNodes.has(el)) return;
    timelineObserver.observe(el);
    observedNodes.add(el);
}

function handleChatMutations(mutationsList) {
    for (const mutation of mutationsList) {
        for (const node of mutation.addedNodes) {
            if (node.nodeType !== 1) continue;
            if (node.classList?.contains('mes')) observeNode(node);
            node.querySelectorAll?.('.mes')?.forEach(observeNode);
        }
    }
}

export function attachTimelineWatcher() {
    const state = loadConfig();
    if (!state.isActive || !state.timelineSync) return;
    if (timelineObserver) return;

    const chatEl = document.getElementById('chat');
    if (!chatEl) return;

    visibilityMemo = new Map();
    observedNodes = new WeakSet();

    timelineObserver = new IntersectionObserver((entries) => {
        for (const entry of entries) {
            if (entry.isIntersecting && entry.intersectionRatio > 0) {
                visibilityMemo.set(entry.target, entry.intersectionRatio);
            } else {
                visibilityMemo.delete(entry.target);
            }
        }
        clearTimeout(pickDebounceHandle);
        pickDebounceHandle = setTimeout(pickMostVisibleMessage, 160);
    }, {
        root: chatEl,
        rootMargin: '-15% 0px -15% 0px',
        threshold: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1],
    });

    chatEl.querySelectorAll('.mes').forEach(observeNode);

    timelineMutationObserver = new MutationObserver(handleChatMutations);
    timelineMutationObserver.observe(chatEl, { childList: true, subtree: true });

    timelineActive = true;
}

export function detachTimelineWatcher() {
    if (timelineObserver) { timelineObserver.disconnect(); timelineObserver = null; }
    if (timelineMutationObserver) { timelineMutationObserver.disconnect(); timelineMutationObserver = null; }
    clearTimeout(pickDebounceHandle);
    visibilityMemo = new Map();
    observedNodes = new WeakSet();
    timelineActive = false;
    currentSnapshotMesId = null;
    lastSnapshotCastKey = null;
    paintStage();
}

function pickMostVisibleMessage() {
    const chatEl = document.getElementById('chat');
    if (chatEl) {
        const distanceFromBottom = chatEl.scrollHeight - chatEl.scrollTop - chatEl.clientHeight;
        if (distanceFromBottom < 150) {
            if (currentSnapshotMesId !== null) {
                currentSnapshotMesId = null;
                paintStage();
            }
            return;
        }
    }
    let bestEl = null;
    let bestRatio = 0;
    for (const [el, ratio] of visibilityMemo) {
        if (ratio > bestRatio) { bestRatio = ratio; bestEl = el; }
    }
    if (bestEl) buildTimelineSnapshot(bestEl);
}

let lastSnapshotCastKey = null;

function buildTimelineSnapshot(mesEl) {
    const idAttr = mesEl.getAttribute('mesid');
    if (idAttr === null) return;
    const mesId = parseInt(idAttr, 10);
    if (Number.isNaN(mesId) || mesId === currentSnapshotMesId) return;
    currentSnapshotMesId = mesId;

    const { chat } = SillyTavern.getContext();
    if (!chat) return;

    if (mesId === chat.length - 1) {
        paintStage();
        lastSnapshotCastKey = null;
        return;
    }

    const message = chat[mesId];
    if (!message) return;

    const state = loadConfig();
    const lookback = Math.max(1, state.timelineLookback || 4);
    const cap = getEffectiveCastCap(state);

    const collected = [];
    for (let i = mesId; i >= 0 && collected.length < lookback; i--) {
        const msg = chat[i];
        if (!msg) continue;
        if (msg.is_user) continue;
        collected.unshift(msg.mes || '');
    }

    const combinedText = collected.join('\n\n');
    const text = prepareScanText(combinedText, state);
    const cast = state.cast;
    const matchedIdx = [];

    for (let castIdx = 0; castIdx < cast.length; castIdx++) {
        const member = cast[castIdx];
        if (!member.portrait || member.active === false) continue;

        const needed = member.hitsRequired || 1;
        if (!evaluateTrigger(text, member.triggers, state.matchCaseSensitive, needed, !!member.useRegex)) continue;
        if (isSuppressed(text, member.excludeTriggers, state.matchCaseSensitive)) continue;

        if (cap <= 0 || matchedIdx.length >= cap) continue;
        matchedIdx.push(castIdx);
    }

    const snapshotKey = matchedIdx.join(',');
    if (snapshotKey === lastSnapshotCastKey) return;
    lastSnapshotCastKey = snapshotKey;

    const snapshot = new Map();
    for (const castIdx of matchedIdx) {
        const member = cast[castIdx];
        snapshot.set(castIdx, { castIdx, artIdx: member.lastArtIdx || 0, missCounter: 0, held: false, lastSeenAt: Date.now() });
    }

    paintStage(snapshot);
}
