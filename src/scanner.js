import { loadConfig, getEffectiveCastCap } from './config.js';
import { parseTriggerList } from './utils.js';
import { activeCast, queueStagePaint } from './stage.js';

export function evaluateTrigger(text, triggerStr, caseSensitive) {
    const terms = parseTriggerList(triggerStr);
    if (terms.length === 0) return false;
    const flags = caseSensitive ? 'g' : 'gi';
    
    for (const term of terms) {
        const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const pattern = new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, flags + 'u');
        if (pattern.test(text)) return true;
    }
    return false;
}

export function processIncomingMessage(messageText) {
    const state = loadConfig();
    if (!state.isActive || !state.cast.length) return;

    const matchedThisMessage = new Set();
    const cap = getEffectiveCastCap(state);

    for (let castIdx = 0; castIdx < state.cast.length; castIdx++) {
        const member = state.cast[castIdx];
        if (!member.portrait || member.active === false) continue;

        if (!evaluateTrigger(messageText, member.triggers, state.matchCaseSensitive)) continue;

        matchedThisMessage.add(castIdx);

        if (activeCast.has(castIdx)) {
            activeCast.get(castIdx).missCounter = 0;
        } else {
            if (cap <= 0 || activeCast.size >= cap) continue;
            activeCast.set(castIdx, { castIdx, missCounter: 0 });
        }
    }

    if (state.dismissMode === 'replies') {
        const expired = [];
        for (const [castIdx, seat] of activeCast) {
            if (matchedThisMessage.has(castIdx)) continue;
            seat.missCounter = (seat.missCounter || 0) + 1;
            if (state.keepAliveReplies > 0 && seat.missCounter <= state.keepAliveReplies) continue;
            expired.push(castIdx);
        }
        for (const castIdx of expired) activeCast.delete(castIdx);
    }
    queueStagePaint();
}