import { loadConfig, getEffectiveCastCap } from './config.js';
import { parseTriggerList } from './utils.js';
import { activeCast, queueStagePaint } from './stage.js';

export function countTermHits(text, term, caseSensitive) {
    if (!term) return 0;
    const body = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const flags = 'gu' + (caseSensitive ? '' : 'i');
    try {
        const pattern = new RegExp(`(?<![\\p{L}\\p{N}_])${body}(?![\\p{L}\\p{N}_])`, flags);
        const found = text.match(pattern);
        return found ? found.length : 0;
    } catch (e) {
        return 0;
    }
}

export function evaluateTrigger(text, triggerStr, caseSensitive, needed) {
    const terms = parseTriggerList(triggerStr);
    if (terms.length === 0) return false;
    let total = 0;
    for (const term of terms) {
        total += countTermHits(text, term, caseSensitive);
        if (total >= needed) return true;
    }
    return total >= needed;
}

export function processIncomingMessage(messageText) {
    const state = loadConfig();
    if (!state.isActive || !state.cast.length) return;

    const matchedThisMessage = new Set();
    const cap = getEffectiveCastCap(state);

    for (let castIdx = 0; castIdx < state.cast.length; castIdx++) {
        const member = state.cast[castIdx];
        if (!member.portrait || member.active === false) continue;

        const needed = member.hitsRequired || 1;
        if (!evaluateTrigger(messageText, member.triggers, state.matchCaseSensitive, needed)) continue;

        matchedThisMessage.add(castIdx);

        if (activeCast.has(castIdx)) {
            const seat = activeCast.get(castIdx);
            seat.missCounter = 0;
        } else {
            if (cap <= 0 || activeCast.size >= cap) continue;
            activeCast.set(castIdx, { castIdx, artIdx: member.lastArtIdx || 0, missCounter: 0 });
        }
    }

    if (state.dismissMode === 'replies') {
        const expired = [];
        for (const [castIdx, seat] of activeCast) {
            if (matchedThisMessage.has(castIdx)) { seat.missCounter = 0; continue; }
            seat.missCounter = (seat.missCounter || 0) + 1;
            if (state.keepAliveReplies > 0 && seat.missCounter <= state.keepAliveReplies) continue;
            expired.push(castIdx);
        }
        for (const castIdx of expired) activeCast.delete(castIdx);
    }
    queueStagePaint();
}