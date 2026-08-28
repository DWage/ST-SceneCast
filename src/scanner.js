import { loadConfig, getEffectiveCastCap } from './config.js';
import { parseTriggerList } from './utils.js';
import { activeCast, queueStagePaint } from './stage.js';

const boundaryRegexCache = new Map();
const userPatternCache = new Map();
const REGEX_CACHE_LIMIT = 500;

export function escapeForRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function buildBoundaryPattern(term, caseSensitive) {
    const cacheKey = `${caseSensitive ? 'C' : 'I'}:${term}`;
    const cached = boundaryRegexCache.get(cacheKey);
    if (cached) {
        cached.lastIndex = 0;
        return cached;
    }
    const body = escapeForRegex(term);
    const flags = 'gu' + (caseSensitive ? '' : 'i');
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}_])${body}(?![\\p{L}\\p{N}_])`, flags);
    if (boundaryRegexCache.size >= REGEX_CACHE_LIMIT) boundaryRegexCache.clear();
    boundaryRegexCache.set(cacheKey, pattern);
    return pattern;
}

export function countTermHits(text, term, caseSensitive) {
    if (!term) return 0;
    let pattern;
    try {
        pattern = buildBoundaryPattern(term, caseSensitive);
    } catch (e) {
        return 0;
    }
    const found = text.match(pattern);
    return found ? found.length : 0;
}

export function countListHits(text, terms, caseSensitive, needed) {
    let total = 0;
    for (const term of terms) {
        total += countTermHits(text, term, caseSensitive);
        if (total >= needed) return true;
    }
    return total >= needed;
}

export function countPatternHits(text, pattern, caseSensitive) {
    if (!pattern) return 0;
    const cacheKey = `${caseSensitive ? 'C' : 'I'}:${pattern}`;
    let re = userPatternCache.get(cacheKey);
    if (!re) {
        try {
            re = new RegExp(pattern, caseSensitive ? 'g' : 'gi');
        } catch (e) {
            return 0;
        }
        if (userPatternCache.size >= REGEX_CACHE_LIMIT) userPatternCache.clear();
        userPatternCache.set(cacheKey, re);
    }
    re.lastIndex = 0;
    const found = text.match(re);
    return found ? found.length : 0;
}

export function evaluateTrigger(text, triggerStr, caseSensitive, needed, useRegex) {
    const threshold = needed || 1;
    if (useRegex) return countPatternHits(text, triggerStr, caseSensitive) >= threshold;
    return countListHits(text, parseTriggerList(triggerStr), caseSensitive, threshold);
}

export function isSuppressed(text, excludeStr, caseSensitive) {
    const terms = parseTriggerList(excludeStr);
    if (terms.length === 0) return false;
    return countListHits(text, terms, caseSensitive, 1);
}

export function stripNestedTag(text, tagName) {
    const marker = new RegExp(`<(/?)${tagName}(?:\\s[^>]*)?>`, 'gi');
    let output = '';
    let depth = 0;
    let flushFrom = 0;
    let hit;

    marker.lastIndex = 0;
    while ((hit = marker.exec(text)) !== null) {
        const closing = hit[1] === '/';
        if (depth === 0) {
            if (closing) continue;
            output += text.slice(flushFrom, hit.index);
            depth = 1;
        } else {
            depth += closing ? -1 : 1;
            if (depth === 0) {
                flushFrom = hit.index + hit[0].length;
            }
        }
    }
    output += depth === 0 ? text.slice(flushFrom) : '';
    return output;
}

export function stripMarkerSpan(text, startMark, endMark) {
    if (!startMark || !endMark) return text;
    let output = '';
    let cursor = 0;
    while (true) {
        const start = text.indexOf(startMark, cursor);
        if (start === -1) { output += text.slice(cursor); break; }
        output += text.slice(cursor, start);
        const end = text.indexOf(endMark, start + startMark.length);
        if (end === -1) break;
        cursor = end + endMark.length;
    }
    return output;
}

export function prepareScanText(rawText, state) {
    let text = rawText || '';
    if (state.hideDetailsBlocks) text = stripNestedTag(text, 'details');
    if (state.ignoreQuotedNames) text = stripMarkerSpan(text, '"', '"');
    if (state.ignoreMarkerStart && state.ignoreMarkerEnd) {
        text = stripMarkerSpan(text, state.ignoreMarkerStart, state.ignoreMarkerEnd);
    }
    return text;
}

function applyExpiryByReplies(matchedThisMessage, state) {
    if (state.dismissMode !== 'replies') {
        for (const [castIdx, seat] of activeCast) {
            seat.missCounter = matchedThisMessage.has(castIdx) ? 0 : (seat.missCounter || 0) + 1;
        }
        return;
    }
    const expired = [];
    for (const [castIdx, seat] of activeCast) {
        if (matchedThisMessage.has(castIdx)) { seat.missCounter = 0; continue; }
        if (seat.held) continue;
        seat.missCounter = (seat.missCounter || 0) + 1;
        if (state.keepAliveReplies > 0 && seat.missCounter <= state.keepAliveReplies) continue;
        expired.push(castIdx);
    }
    for (const castIdx of expired) activeCast.delete(castIdx);
}

export function processIncomingMessage(messageText) {
    const state = loadConfig();
    if (!state.isActive || !state.cast.length) return;

    const text = prepareScanText(messageText, state);
    const matchedThisMessage = new Set();
    const cap = getEffectiveCastCap(state);

    for (let castIdx = 0; castIdx < state.cast.length; castIdx++) {
        const member = state.cast[castIdx];
        if (!member.portrait || member.active === false) continue;

        const needed = member.hitsRequired || 1;
        if (!evaluateTrigger(text, member.triggers, state.matchCaseSensitive, needed, !!member.useRegex)) continue;
        if (isSuppressed(text, member.excludeTriggers, state.matchCaseSensitive)) continue;

        matchedThisMessage.add(castIdx);

        if (activeCast.has(castIdx)) {
            const seat = activeCast.get(castIdx);
            seat.missCounter = 0;
            seat.lastSeenAt = Date.now();
        } else {
            if (cap <= 0 || activeCast.size >= cap) continue;
            activeCast.set(castIdx, { castIdx, artIdx: member.lastArtIdx || 0, missCounter: 0, held: false, lastSeenAt: Date.now() });
        }
    }

    applyExpiryByReplies(matchedThisMessage, state);
    queueStagePaint();
}
