import { IMAGE_SUBFOLDER, listProfiles, getProfileCast, getActiveProfileId, getActiveProfileIds,
    createProfile, duplicateProfile, renameProfile, deleteProfile, moveCastMember, findMergedCastIndexById,
    bindCharacterToProfile, unbindCharacterFromProfile, unbindProfileFromCharacterKey,
    getCurrentBinding, getCharacterKeysBoundToProfile,
    resolveCharacterDisplayName, resolveDisplayNameForKey, refreshActiveProfileForCurrentChat,
    clearPortraitReferencesEverywhere, findPortraitReferences,
    loadConfig, persistConfig, normalizeMember, PLACEHOLDER_ART, TRAY_CAP,
    STAGE_MODES, STAGE_EFFECTS, STAGE_SIDES, DISMISS_MODES, DISMISS_HINTS, EXIT_STYLES } from './config.js';
import { activeCast, queueStagePaint, applyVisualVars, refreshStageVisuals, refreshPreviewVisuals, resetStage, EXIT_KEYFRAMES, EXIT_DURATIONS } from './stage.js';
import { attachTimelineWatcher, detachTimelineWatcher } from './timeline.js';
import { bulkImportArtwork, upsertDroppedArtwork, exportCastArtwork } from './files.js';
import { evaluateTrigger, isSuppressed } from './scanner.js';
import {
    toSafeMarkup, parseTriggerList, debounce, announce,
    uploadImageToServer, deleteImageFromServer, isServerImagePath, toImgSrc,
    listServerImages, attachOutsideClickToClose,
} from './utils.js';
import { safeDeleteServerImage } from './image-guard.js';
import { themedConfirm, themedAlert, themedPrompt } from './dialog.js';
import { createHeartButton } from './donate.js';
import { openOnboardingGuide } from './onboarding.js';

let panelViewingProfileId = null;
let panelSelectedIdx = null;
let panelSearchQuery = '';

function isViewingActiveProfile() {
    return getActiveProfileIds().includes(panelViewingProfileId);
}

export function mountDirectorPanel() {
    if (document.getElementById('scast-panel-overlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'scast-panel-overlay';

    overlay.innerHTML = `
        <div id="scast-panel">
            <div id="scast-panel-header">
                <b><i class="fa-solid fa-clapperboard scast-panel-header-icon"></i> Cast Manager</b>
                <div style="display: flex; align-items: center; gap: 12px;">
                    <span id="scast-panel-heart-slot"></span>
                    <button id="scast-panel-guide" title="Open the guide"><i class="fa-solid fa-circle-question"></i></button>
                    <button id="scast-panel-close" title="Close"><i class="fa-solid fa-xmark"></i></button>
                </div>
            </div>

            <div id="scast-profile-bar">
                <select id="scast-profile-select" class="text_pole" title="Which world/character card this cast belongs to"></select>
                <button id="scast-profile-bind" class="menu_button" title="Bind/unbind the CURRENTLY VIEWED profile to the current character or group. You can bind more than one profile to the same character — just switch the dropdown and bind again."><i class="fa-solid fa-link scast-mr"></i>Bind</button>
                <span class="scast-toolbar-divider"></span>
                <button id="scast-profile-new" class="menu_button"><i class="fa-solid fa-plus scast-mr"></i>New</button>
                <button id="scast-profile-dup" class="menu_button" title="Duplicate profile"><i class="fa-solid fa-clone scast-mr"></i>Dup</button>
                <button id="scast-profile-rename" class="menu_button" title="Rename profile"><i class="fa-solid fa-pen"></i></button>
                <button id="scast-profile-delete" class="menu_button scast-danger-btn" title="Delete profile"><i class="fa-solid fa-trash"></i></button>
                <span id="scast-profile-binding-note" class="scast-profile-note"></span>
                <button id="scast-profile-bindings-info" class="menu_button scast-toolbar-iconbtn" style="margin-left:auto;" title=""><i class="fa-solid fa-circle-info"></i></button>
            </div>

            <div id="scast-panel-settings-wrap">
                <div id="scast-panel-settings-toggle">
                    <span><i class="fa-solid fa-gear scast-mr"></i>Stage settings</span>
                    <span id="scast-settings-chevron" class="scast-chevron">▲</span>
                </div>
                <div id="scast-panel-settings"></div>
            </div>
            <div id="scast-panel-body">
                <div id="scast-roster-pane">
                    <div id="scast-roster-toolbar">
                        <input type="text" id="scast-roster-search" class="text_pole" placeholder="Search cast..." />
                        <button id="scast-roster-add" class="menu_button" title="Add a new cast member"><i class="fa-solid fa-plus scast-mr"></i>Add</button>
                        <span class="scast-toolbar-divider"></span>
                        <label class="menu_button scast-toolbar-iconbtn" style="cursor:pointer;" title="Import a folder (top-level images only)">
                            <i class="fa-solid fa-folder-open scast-mr"></i><span class="scast-toolbar-label">Import</span>
                            <input type="file" id="scast-roster-import-input" webkitdirectory directory multiple style="display:none;" />
                        </label>
                          <button id="scast-roster-export" class="menu_button scast-toolbar-iconbtn" title="Export all artwork"><i class="fa-solid fa-floppy-disk scast-mr"></i><span class="scast-toolbar-label">Export</span></button>
                        <button id="scast-roster-images" class="menu_button scast-toolbar-iconbtn" title="Browse & delete images stored on the server"><i class="fa-solid fa-images scast-mr"></i><span class="scast-toolbar-label">Images</span></button>
                        <span class="scast-toolbar-spacer"></span>
                        <button id="scast-roster-clear-all" class="menu_button scast-danger-btn" title="Clear ALL cast members in this profile"><i class="fa-solid fa-trash-can"></i></button>
                    </div>
                    <div id="scast-roster-grid"></div>
                    <div id="scast-roster-drop-hint">Drop image files anywhere here to add or update cast members</div>
                </div>
                <div id="scast-editor-pane"></div>
            </div>
        </div>
    `;

     document.body.appendChild(overlay);

    overlay.querySelector('#scast-panel-heart-slot').appendChild(createHeartButton());

    overlay.querySelector('#scast-panel-close').addEventListener('click', closeDirectorPanel);
    overlay.querySelector('#scast-panel-guide').addEventListener('click', () => openOnboardingGuide());
    overlay.querySelector('#scast-roster-images').addEventListener('click', openImageManager);
    attachOutsideClickToClose(overlay, closeDirectorPanel);

    const settingsWrap = overlay.querySelector('#scast-panel-settings-wrap');
    const settingsToggle = overlay.querySelector('#scast-panel-settings-toggle');
    const settingsChevron = overlay.querySelector('#scast-settings-chevron');
    settingsToggle.addEventListener('click', () => {
        const collapsed = settingsWrap.classList.toggle('collapsed');
        settingsChevron.textContent = collapsed ? '▼' : '▲';
    });

    overlay.querySelector('#scast-profile-select').addEventListener('change', (e) => {
        panelViewingProfileId = e.target.value;
        panelSelectedIdx = null;
        renderProfileBar();
        renderRosterGrid();
        renderEditorPane(null);
    });

    overlay.querySelector('#scast-profile-bind').addEventListener('click', () => {
        const binding = getCurrentBinding();
        if (!binding.key) return;
        if (binding.profileIds.includes(panelViewingProfileId)) {
            unbindCharacterFromProfile(panelViewingProfileId);
        } else {
            bindCharacterToProfile(panelViewingProfileId);
        }
        refreshActiveProfileForCurrentChat();
        resetStage();
        renderProfileBar();
        mountSidebarPanel();
    });

    overlay.querySelector('#scast-profile-new').addEventListener('click', async () => {
        const name = await themedPrompt('New profile name:', 'New World');
        if (name === null) return;
        const id = createProfile(name.trim() || 'New World');
        panelViewingProfileId = id;
        panelSelectedIdx = null;
        renderProfileBar();
        renderRosterGrid();
        renderEditorPane(null);
    });

    overlay.querySelector('#scast-profile-dup').addEventListener('click', () => {
        const id = duplicateProfile(panelViewingProfileId);
        if (!id) return;
        panelViewingProfileId = id;
        panelSelectedIdx = null;
        renderProfileBar();
        renderRosterGrid();
        renderEditorPane(null);
    });

    overlay.querySelector('#scast-profile-rename').addEventListener('click', async () => {
        const current = listProfiles().find(p => p.id === panelViewingProfileId);
        const name = await themedPrompt('Rename profile:', current?.name || '');
        if (!name) return;
        renameProfile(panelViewingProfileId, name.trim());
        renderProfileBar();
    });

    overlay.querySelector('#scast-profile-delete').addEventListener('click', async () => {
        const profiles = listProfiles();
        if (profiles.length <= 1) { await themedAlert('You need at least one profile.'); return; }
        const current = profiles.find(p => p.id === panelViewingProfileId);
        const confirmed = await themedConfirm(`Delete profile "${current?.name}" and all ${current?.count} cast member(s) in it? This cannot be undone.`, { danger: true });
        if (!confirmed) return;

        const wasActive = isViewingActiveProfile();
        const removedCast = deleteProfile(panelViewingProfileId);
        if (Array.isArray(removedCast)) {
            for (const member of removedCast) {
                safeDeleteServerImage(member.portrait);
                for (const v of (member.variants || [])) safeDeleteServerImage(v.portrait);
            }
        }
        panelViewingProfileId = getActiveProfileId();
        panelSelectedIdx = null;
        if (wasActive) resetStage();
        renderProfileBar();
        renderRosterGrid();
        renderEditorPane(null);
    });

    overlay.querySelector('#scast-roster-search').addEventListener('input', debounce((e) => {
        panelSearchQuery = e.target.value;
        renderRosterGrid();
    }, 180));
    overlay.querySelector('#scast-roster-add').addEventListener('click', createCastMember);
    overlay.querySelector('#scast-roster-export').addEventListener('click', () => exportCastArtwork(panelViewingProfileId));
    overlay.querySelector('#scast-roster-import-input').addEventListener('change', async (e) => {
        const files = e.target.files;
        if (!files || files.length === 0) return;
        await bulkImportArtwork(files, panelViewingProfileId);
        renderProfileBar();
        renderRosterGrid();
        e.target.value = '';
    });

    overlay.querySelector('#scast-roster-clear-all').addEventListener('click', async () => {
        const cast = getProfileCast(panelViewingProfileId);
        if (cast.length === 0) { await themedAlert('Roster is already empty.'); return; }
        const current = listProfiles().find(p => p.id === panelViewingProfileId);
        const confirmed = await themedConfirm(`WARNING: Are you sure you want to delete ALL ${cast.length} cast members from "${current?.name}"?\n\nThis cannot be undone!`, { danger: true });
        if (confirmed) {
            const portraitsToCheck = [];
            for (const member of cast) {
                if (member.portrait) portraitsToCheck.push(member.portrait);
                for (const v of (member.variants || [])) if (v.portrait) portraitsToCheck.push(v.portrait);
            }
            cast.length = 0;
            persistConfig();
            for (const path of portraitsToCheck) safeDeleteServerImage(path);

            if (isViewingActiveProfile()) resetStage();
            panelSelectedIdx = null;
            renderProfileBar();
            renderRosterGrid();
            renderEditorPane(null);
        }
    });

    const panelBox = overlay.querySelector('#scast-panel');
    let dragDepth = 0;
    panelBox.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); });
    panelBox.addEventListener('dragenter', (e) => {
        e.preventDefault();
        e.stopPropagation();
        dragDepth++;
        panelBox.classList.add('drag-over');
    });
    panelBox.addEventListener('dragleave', (e) => {
        e.stopPropagation();
        dragDepth = Math.max(0, dragDepth - 1);
        if (dragDepth === 0) panelBox.classList.remove('drag-over');
    });
    panelBox.addEventListener('drop', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        dragDepth = 0;
        panelBox.classList.remove('drag-over');
        const files = e.dataTransfer?.files;
        if (!files || files.length === 0) return;
        await upsertDroppedArtwork(files, panelViewingProfileId);
        renderProfileBar();
        renderRosterGrid();
        renderEditorPane(panelSelectedIdx);
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && overlay.classList.contains('visible')) closeDirectorPanel();
    });
}

export function openDirectorPanel() {
    mountDirectorPanel();
    document.getElementById('scast-panel-overlay').classList.add('visible');
    panelViewingProfileId = getActiveProfileId();
    panelSelectedIdx = null;
    renderPanelSettings();
    renderProfileBar();
    renderRosterGrid();
    renderEditorPane(null);

    if (!loadConfig().hasSeenGuide) {
        openOnboardingGuide();
    }
}

function closeDirectorPanel() {
    document.getElementById('scast-panel-overlay')?.classList.remove('visible');
}

function renderProfileBar() {
    const overlay = document.getElementById('scast-panel-overlay');
    if (!overlay) return;
    const select = overlay.querySelector('#scast-profile-select');
    const bindBtn = overlay.querySelector('#scast-profile-bind');
    const note = overlay.querySelector('#scast-profile-binding-note');
    const infoBtn = overlay.querySelector('#scast-profile-bindings-info');

    const profiles = listProfiles();
    const profileNameById = new Map(profiles.map(p => [p.id, p.name]));
    select.innerHTML = profiles.map(p =>
        `<option value="${p.id}" ${p.id === panelViewingProfileId ? 'selected' : ''}>${toSafeMarkup(p.name)} (${p.count})</option>`
    ).join('');

    const binding = getCurrentBinding();
    const charName = resolveCharacterDisplayName();
    const charLabel = charName ? `"${toSafeMarkup(charName)}"` : 'this character';

    if (!binding.key) {
        note.textContent = '⚠ No character/group detected';
        bindBtn.disabled = true;
        bindBtn.innerHTML = '<i class="fa-solid fa-link scast-mr"></i>Bind';
    } else {
        const isBoundHere = binding.profileIds.includes(panelViewingProfileId);
        bindBtn.disabled = false;
        bindBtn.innerHTML = isBoundHere
            ? '<i class="fa-solid fa-link-slash scast-mr"></i>Unbind'
            : `<i class="fa-solid fa-link scast-mr"></i>Bind to ${charLabel}`;

        note.textContent = isBoundHere
            ? (binding.profileIds.length > 1
                ? `✅ Bound (+${binding.profileIds.length - 1} more)`
                : `✅ Bound to ${charName || 'this character'}`)
            : (binding.isBound ? '' : 'Not bound yet');
    }

    const activeNames = binding.key
        ? (binding.profileIds.length
            ? binding.profileIds.map(pid => profileNameById.get(pid) || '(deleted)').join(', ')
            : 'Using fallback profile')
        : '—';
    const usedByKeys = getCharacterKeysBoundToProfile(panelViewingProfileId).filter(k => k !== binding.key);
    const usedByNames = usedByKeys.length
        ? usedByKeys.map(k => resolveDisplayNameForKey(k) || k).join(', ')
        : 'Not bound elsewhere';

    infoBtn.title = `Active on this card:\n${activeNames}\n\nThis profile also used by:\n${usedByNames}`;
}
function resolvePreviewSource() {
    const cast = getProfileCast(panelViewingProfileId);
    const selected = (panelSelectedIdx !== null) ? cast[panelSelectedIdx] : null;

    if (selected) {
        if (selected.portrait) {
            return { src: toImgSrc(selected.portrait), name: selected.displayName || parseTriggerList(selected.triggers)[0] || 'Cast member' };
        }
        return { src: PLACEHOLDER_ART, name: selected.displayName || 'New cast member' };
    }

    const anyWithArt = cast.find(m => m.portrait);
    if (anyWithArt) {
        return { src: toImgSrc(anyWithArt.portrait), name: anyWithArt.displayName || parseTriggerList(anyWithArt.triggers)[0] || 'Cast member' };
    }
    return { src: PLACEHOLDER_ART, name: 'No cast members yet' };
}

function paintPreviewCard() {
    const stage = document.getElementById('scast-preview-stage');
    if (!stage) return;
    applyVisualVars(stage, loadConfig());

    const { src, name } = resolvePreviewSource();
    const editable = panelSelectedIdx !== null;
    stage.innerHTML = `
        <div class="scast-card" data-tile-span="full" data-crop-fit="smart" data-is-fresh="true" data-held="false">
             <img class="scast-card-bg" src="${src}" onerror="this.onerror=null;this.src='${PLACEHOLDER_ART}'" />
            <img class="scast-card-fg" src="${src}" onerror="this.onerror=null;this.src='${PLACEHOLDER_ART}'" />
            <div class="scast-fx-overlay"></div>
            <div class="scast-card-info"><span class="scast-name">${toSafeMarkup(name)}</span></div>
        </div>
        ${editable ? `<div class="scast-preview-edit-hint"><i class="fa-solid fa-camera"></i>Click or drop<br/>to change portrait</div>` : ''}
    `;
}

function replayPreviewExit() {
    const stage = document.getElementById('scast-preview-stage');
    const card = stage?.querySelector('.scast-card');
    if (!card) return;
    const state = loadConfig();
    if (state.reduceMotion || (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)) {
        announce('Reduce motion is on — animation preview skipped');
        return;
    }
    const kind = EXIT_KEYFRAMES[state.exitAnim] ? state.exitAnim : 'fade';
    const duration = EXIT_DURATIONS[kind] || 220;

    card.getAnimations().forEach(a => a.cancel());

    try {
        const exit = card.animate(EXIT_KEYFRAMES[kind]('right'), { duration, easing: 'ease', fill: 'forwards' });
        exit.onfinish = () => {
            const enter = card.animate(
                [{ opacity: 0, transform: 'scale(0.85)' }, { opacity: 1, transform: 'scale(1)' }],
                { duration: 240, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)', fill: 'forwards' },
            );
            enter.onfinish = () => card.getAnimations().forEach(a => a.cancel());
        };
    } catch (e) {}
}

function renderPanelSettings() {
    const state = loadConfig();
    const container = document.getElementById('scast-panel-settings');
    if (!container) return;

    const modeOptions = STAGE_MODES.map(m => `<option value="${m.value}">${toSafeMarkup(m.label)}</option>`).join('');
    const fxOptions = STAGE_EFFECTS.map(f => `<option value="${f.value}">${toSafeMarkup(f.label)}</option>`).join('');
    const sideOptions = STAGE_SIDES.map(s => `<option value="${s.value}">${toSafeMarkup(s.label)}</option>`).join('');
    const dismissOptions = DISMISS_MODES.map(c => `<option value="${c.value}">${toSafeMarkup(c.label)}</option>`).join('');
    const exitOptions = EXIT_STYLES.map(a => `<option value="${a.value}">${toSafeMarkup(a.label)}</option>`).join('');

    container.innerHTML = `
        <div class="scast-tabs-nav">
            <button class="scast-tab-btn active" data-tab="visuals"><i class="fa-solid fa-palette scast-mr"></i>Appearance & Effects</button>
            <button class="scast-tab-btn" data-tab="logic"><i class="fa-solid fa-sliders scast-mr"></i>Rules & Triggers</button>
        </div>

        <div class="scast-tab-pane active" id="scast-tab-visuals">
            <div class="scast-setting-group">
                <label class="scast-mini-field" title="Which layout the on-screen cards use — grid, 3D, scrapbook, etc.">
                    <span class="scast-mini-label">Display style</span>
                    <select id="scast-cfg-mode" class="text_pole">${modeOptions}</select>
                </label>
                <label class="scast-mini-field" title="An extra visual overlay drawn on top of every card (sparkle, film grain, vignette, scanlines).">
                    <span class="scast-mini-label">Visual effect</span>
                    <select id="scast-cfg-fx" class="text_pole">${fxOptions}</select>
                </label>
                <label class="scast-mini-field" title="The animation played when a card leaves the stage (dismissed, expired, or profile/chat switched).">
                    <span class="scast-mini-label">Exit animation</span>
                    <select id="scast-cfg-exitanim" class="text_pole">${exitOptions}</select>
                </label>
                <label class="scast-mini-field" title="Which side(s) of the screen show cast cards. Picking a single side ignores each character's own 'Preferred side' and puts everyone in that one column — and halves (rounded up) how many can be on stage at once, since 'Max on stage' below is shared across both columns.">
                    <span class="scast-mini-label">Stage side</span>
                    <select id="scast-cfg-stageside" class="text_pole">${sideOptions}</select>
                </label>
            </div>

            <div class="scast-setting-group">
                <label class="scast-mini-field" title="Rotates the whole card's colors.">
                    <span class="scast-mini-label">Hue shift (<span id="scast-cfg-hue-val">0</span>°)</span>
                    <input type="range" id="scast-cfg-hue" min="0" max="360" step="1" />
                </label>
                <label class="scast-mini-field" title="Global card size.">
                    <span class="scast-mini-label">Card size (<span id="scast-cfg-scale-val">100</span>%)</span>
                    <input type="range" id="scast-cfg-scale" min="80" max="160" step="1" />
                </label>
                <div class="scast-mini-checkboxes">
                    <label class="scast-mini-check" title="Turns off ambient looping animations"><input type="checkbox" id="scast-cfg-reducemotion" /> Reduce motion</label>
                    <label class="scast-mini-check" title="Shows the name/tag strip under each card."><input type="checkbox" id="scast-cfg-showinfo" /> Info bar</label>
                    <label class="scast-mini-check" title="Shows the variant label under the name (if different)."><input type="checkbox" id="scast-cfg-showvarianttag" /> Variant label</label>
                </div>
            </div>
        </div>

        <div class="scast-tab-pane" id="scast-tab-logic">
            <div class="scast-setting-group">
                <label class="scast-mini-field" title="How a character card is decided to have left the scene.">
                    <span class="scast-mini-label">Dismiss mode</span>
                    <select id="scast-cfg-dismissmode" class="text_pole"></select>
                </label>
                <label class="scast-mini-field" id="scast-cfg-keepalive-wrap" title="How many AI replies a character can go unmentioned before their card is removed. Only used in 'By reply count' mode.">
                    <span class="scast-mini-label">Keep-alive replies</span>
                    <input type="number" id="scast-cfg-keepalive" class="text_pole" min="0" max="20" step="1" />
                </label>
                <label class="scast-mini-field" id="scast-cfg-seconds-wrap" title="How many seconds after the last mention a character's card disappears. Only used in 'By time' mode.">
                    <span class="scast-mini-label">Seconds to dismiss</span>
                    <input type="number" id="scast-cfg-seconds" class="text_pole" min="1" max="600" step="1" />
                </label>
                <label class="scast-mini-field" title="Maximum cast members allowed on stage at once (0-12). If 'Stage side' above is set to one side only, this many is halved (rounded up) since there's just one column to fill.">
                    <span class="scast-mini-label">Max on stage</span>
                    <input type="number" id="scast-cfg-maxcast" class="text_pole" min="0" max="${TRAY_CAP}" step="1" />
                </label>
            </div>

            <div class="scast-setting-group">
                <div class="scast-mini-checkboxes">
                    <label class="scast-mini-check" title="Trigger words must match the exact capitalization you typed — e.g. 'Jane' won't match 'jane' anymore."><input type="checkbox" id="scast-cfg-case" /> Case-sensitive</label>
                    <label class="scast-mini-check" title="Ignores text inside <details>...</details> blocks when scanning for trigger words — useful for hidden/collapsed OOC notes some presets use."><input type="checkbox" id="scast-cfg-strip-details" /> Strip &lt;details&gt;</label>
                    <label class="scast-mini-check" title="Text inside &quot;quotes&quot; is usually a spoken line, not narration describing who's present — names mentioned only inside quotes won't bring a card on stage."><input type="checkbox" id="scast-cfg-ignore-quotes" /> Ignore quoted names</label>
                </div>
                <label class="scast-mini-field scast-mini-field--wide" title="Text between these two markers is skipped entirely when scanning for trigger words — handy for hiding a whole custom block (e.g. a stat sheet) from detection.">
                    <span class="scast-mini-label">Ignore markers</span>
                    <div class="scast-mini-pair">
                        <input type="text" id="scast-cfg-ignore-start" class="text_pole" placeholder="start" />
                        <input type="text" id="scast-cfg-ignore-end" class="text_pole" placeholder="end" />
                    </div>
                </label>
            </div>

            <div class="scast-setting-group">
                <div class="scast-mini-checkboxes">
                    <label class="scast-mini-check" title="When scrolling the chat, shows a historical snapshot of who was on stage at that point instead of always showing the latest message's cast."><input type="checkbox" id="scast-cfg-timelinesync" /> Scroll sync</label>
                </div>
                <label class="scast-mini-field" id="scast-cfg-lookback-wrap" title="How many recent AI messages (scanning backward from the scrolled-to message) are used to build a historical snapshot.">
                    <span class="scast-mini-label">Lookback (msgs)</span>
                    <input type="number" id="scast-cfg-lookback" class="text_pole" min="1" max="20" step="1" />
                </label>
            </div>
        </div>
    `;

    const tabBtns = container.querySelectorAll('.scast-tab-btn');
    const tabPanes = container.querySelectorAll('.scast-tab-pane');
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            tabBtns.forEach(b => b.classList.remove('active'));
            tabPanes.forEach(p => p.classList.remove('active'));
            btn.classList.add('active');
            container.querySelector(`#scast-tab-${btn.dataset.tab}`).classList.add('active');
        });
    });

    const bind = (id, event, stateKey, cb) => {
        const el = container.querySelector(id);
        if (el.type === 'checkbox') el.checked = state[stateKey];
        else el.value = state[stateKey];
        el.addEventListener(event, e => {
            state[stateKey] = el.type === 'checkbox' ? e.target.checked : (el.type === 'number' || el.type === 'range' ? parseFloat(e.target.value) || 0 : e.target.value);
            persistConfig();
            if (cb) cb(e);
        });
        return el;
    };

    bind('#scast-cfg-mode', 'change', 'stageMode', () => { refreshStageVisuals(); refreshPreviewVisuals(); });
    bind('#scast-cfg-fx', 'change', 'stageFx', () => { refreshStageVisuals(); refreshPreviewVisuals(); });
    bind('#scast-cfg-exitanim', 'change', 'exitAnim');
    bind('#scast-cfg-stageside', 'change', 'stageSide', () => { refreshStageVisuals(); queueStagePaint(); });

    const hueVal = container.querySelector('#scast-cfg-hue-val');
    hueVal.textContent = state.accentHueShift;
    bind('#scast-cfg-hue', 'input', 'accentHueShift', () => {
        hueVal.textContent = state.accentHueShift;
        refreshStageVisuals(); refreshPreviewVisuals();
    });

    const scaleVal = container.querySelector('#scast-cfg-scale-val');
    const scalePercent = Math.round((state.cardScale || 1) * 100);
    const scaleInput = container.querySelector('#scast-cfg-scale');
    scaleInput.value = scalePercent;
    scaleVal.textContent = scalePercent;
    scaleInput.addEventListener('input', e => {
        const percent = parseInt(e.target.value) || 100;
        state.cardScale = percent / 100;
        scaleVal.textContent = percent;
        persistConfig(); refreshStageVisuals(); refreshPreviewVisuals();
    });

    bind('#scast-cfg-reducemotion', 'change', 'reduceMotion', () => { refreshStageVisuals(); refreshPreviewVisuals(); });
    bind('#scast-cfg-showinfo', 'change', 'showInfoBar', () => { refreshStageVisuals(); refreshPreviewVisuals(); });
    bind('#scast-cfg-showvarianttag', 'change', 'showVariantTag');
    const dismissSel = container.querySelector('#scast-cfg-dismissmode');
    dismissSel.innerHTML = dismissOptions;
    const keepAliveWrap = container.querySelector('#scast-cfg-keepalive-wrap');
    const secondsWrap = container.querySelector('#scast-cfg-seconds-wrap');
    const syncDismissUI = () => {
        keepAliveWrap.style.display = state.dismissMode === 'replies' ? 'flex' : 'none';
        secondsWrap.style.display = state.dismissMode === 'time' ? 'flex' : 'none';
        dismissSel.title = DISMISS_HINTS[state.dismissMode] || '';
    };
    bind('#scast-cfg-dismissmode', 'change', 'dismissMode', syncDismissUI);
    syncDismissUI();

    bind('#scast-cfg-keepalive', 'change', 'keepAliveReplies');
    bind('#scast-cfg-seconds', 'change', 'dismissSeconds', () => state.dismissSeconds = Math.max(1, state.dismissSeconds));

    const maxCastInput = container.querySelector('#scast-cfg-maxcast');
    maxCastInput.value = state.maxCastSize;
    maxCastInput.addEventListener('change', e => {
        const clamped = Math.max(0, Math.min(TRAY_CAP, parseInt(e.target.value, 10) || 0));
        state.maxCastSize = clamped;
        maxCastInput.value = clamped;
        persistConfig();
    });

    bind('#scast-cfg-case', 'change', 'matchCaseSensitive');
    bind('#scast-cfg-strip-details', 'change', 'hideDetailsBlocks');
    bind('#scast-cfg-ignore-quotes', 'change', 'ignoreQuotedNames');
    bind('#scast-cfg-ignore-start', 'change', 'ignoreMarkerStart');
    bind('#scast-cfg-ignore-end', 'change', 'ignoreMarkerEnd');

    const lookbackWrap = container.querySelector('#scast-cfg-lookback-wrap');
    lookbackWrap.style.display = state.timelineSync ? 'flex' : 'none';
    bind('#scast-cfg-timelinesync', 'change', 'timelineSync', () => {
        lookbackWrap.style.display = state.timelineSync ? 'flex' : 'none';
        if (state.timelineSync) attachTimelineWatcher(); else detachTimelineWatcher();
    });
    bind('#scast-cfg-lookback', 'change', 'timelineLookback', () => state.timelineLookback = Math.max(1, state.timelineLookback));
}

function renderRosterGrid() {
    const cast = getProfileCast(panelViewingProfileId);
    const container = document.getElementById('scast-roster-grid');
    if (!container) return;
    container.innerHTML = '';

    const query = panelSearchQuery.trim().toLowerCase();
    let visibleCount = 0;

    cast.forEach((member, idx) => {
        if (query) {
            const name = (member.displayName || '').toLowerCase();
            const termMatch = parseTriggerList(member.triggers).some(t => t.toLowerCase().includes(query));
            if (!name.includes(query) && !termMatch) return;
        }
        visibleCount++;

        const tile = document.createElement('div');
        tile.className = 'scast-roster-tile';
        tile.dataset.index = String(idx);
        tile.dataset.active = member.active ? 'true' : 'false';
        tile.dataset.selected = (panelSelectedIdx === idx) ? 'true' : 'false';

        const displayName = member.displayName || parseTriggerList(member.triggers)[0] || 'Unnamed';

        tile.innerHTML = `
            <div class="scast-roster-tile-thumb">
                ${member.portrait ? `<img src="${toImgSrc(member.portrait)}" alt="${toSafeMarkup(displayName)}" loading="lazy" onerror="this.onerror=null;this.src='${PLACEHOLDER_ART}'" />` : `<div class="scast-thumb-empty">?</div>`}
            </div>
            <div class="scast-roster-tile-name" title="${toSafeMarkup(displayName)}">${toSafeMarkup(displayName)}</div>
            <button class="scast-roster-tile-toggle" title="${member.active ? 'Active — click to disable' : 'Disabled — click to enable'}"></button>
            <button class="scast-roster-tile-delete" title="Delete cast member"><i class="fa-solid fa-xmark"></i></button>
        `;

        tile.addEventListener('click', () => selectCastMember(idx));
        tile.querySelector('.scast-roster-tile-toggle').addEventListener('click', (e) => {
            e.stopPropagation();
            member.active = !member.active;
            persistConfig();
            if (isViewingActiveProfile() && !member.active) {
                const mergedIdx = findMergedCastIndexById(loadConfig(), member.id);
                if (mergedIdx !== -1 && activeCast.has(mergedIdx)) {
                    activeCast.delete(mergedIdx);
                    queueStagePaint();
                }
            }
            renderRosterGrid();
        });
        tile.querySelector('.scast-roster-tile-delete').addEventListener('click', (e) => {
            e.stopPropagation();
            removeCastMember(idx);
        });

        container.appendChild(tile);
    });

    if (visibleCount === 0) {
        const empty = document.createElement('div');
        empty.className = 'scast-empty-note';
        empty.textContent = query ? 'No cast members match your search.' : 'No cast members yet — add one, or drop images here.';
        container.appendChild(empty);
    }
}

function selectCastMember(idx) {
    panelSelectedIdx = idx;
    renderRosterGrid();
    renderEditorPane(idx);
}

function createCastMember() {
    const cast = getProfileCast(panelViewingProfileId);
    cast.push(normalizeMember({ triggers: '', portrait: '', displayName: '', variants: [] }));
    persistConfig();
    const idx = cast.length - 1;
    panelSelectedIdx = idx;
    renderProfileBar();
    renderRosterGrid();
    renderEditorPane(idx);
}

async function removeCastMember(idx) {
    const cast = getProfileCast(panelViewingProfileId);
    const member = cast[idx];
    if (!member) return;
    const name = member.displayName || parseTriggerList(member.triggers)[0] || 'this cast member';
    const confirmed = await themedConfirm(`Delete "${name}"? This cannot be undone.`, { danger: true });
    if (!confirmed) return;

    const portraits = [member.portrait, ...(member.variants || []).map(v => v.portrait)].filter(Boolean);
    cast.splice(idx, 1);
    persistConfig();
    for (const p of portraits) safeDeleteServerImage(p);

    if (isViewingActiveProfile()) resetStage();
    panelSelectedIdx = null;
    renderProfileBar();
    renderRosterGrid();
    renderEditorPane(null);
}

function renderEditorPane(idx) {
    const pane = document.getElementById('scast-editor-pane');
    if (!pane) return;

    const cast = getProfileCast(panelViewingProfileId);
    const member = (idx === null || idx === undefined) ? null : cast[idx];

    let formHtml;
    if (!member) {
        formHtml = `<div class="scast-empty-note">Select a cast member on the left, or add a new one, to edit their triggers and artwork.</div>`;
    } else {
        normalizeMember(member);
        formHtml = `
            <div class="scast-editor-header">
                <input type="text" id="scast-ed-name" class="text_pole" placeholder="Display name" value="${toSafeMarkup(member.displayName)}" />
                <div class="scast-row-inline">
                    <label class="scast-inline-check">
                        <input type="checkbox" id="scast-ed-active" ${member.active ? 'checked' : ''} /> Active
                    </label>
                    <button id="scast-ed-clear-portrait" class="menu_button scast-toolbar-iconbtn" title="Delete this portrait image from the server (only if unused elsewhere)" ${member.portrait ? '' : 'disabled'}><i class="fa-solid fa-trash scast-mr"></i>Clear portrait</button>
                </div>
            </div>

            <div class="scast-row">
                <label class="scast-field-label">Trigger terms (comma-separated)</label>
                <input type="text" id="scast-ed-triggers" class="text_pole" placeholder="e.g. Sarah, Sally" value="${toSafeMarkup(member.triggers)}" />
                <label class="scast-regex-toggle">
                    <input type="checkbox" id="scast-ed-regex" ${member.useRegex ? 'checked' : ''} /> Regex
                </label>
            </div>

            <div class="scast-row">
                <label class="scast-field-label">Suppress terms — block the trigger if present (always plain comma-list, not regex)</label>
                <input type="text" id="scast-ed-exclude" class="text_pole" placeholder="e.g. John Wick" value="${toSafeMarkup(member.excludeTriggers || '')}" />
            </div>

            <div class="scast-row">
                <div class="scast-tester-toggle" id="scast-ed-tester-toggle"><i class="fa-solid fa-flask scast-mr"></i>Test triggers on sample text ▾</div>
                <div class="scast-tester-box" id="scast-ed-tester-box" style="display:none;">
                    <div class="scast-tester-row">
                        <input type="text" id="scast-ed-tester-input" class="text_pole" placeholder="e.g. John walked into the room..." />
                        <button id="scast-ed-tester-run" class="menu_button">Test</button>
                    </div>
                    <div class="scast-tester-result" id="scast-ed-tester-result"></div>
                </div>
            </div>

            <div class="scast-row scast-row-inline">
                <div class="scast-inline-field" title="How many trigger matches must occur in a single message before this character appears.">
                    <label>Mentions needed:</label>
                    <input type="number" id="scast-ed-hits" class="text_pole" min="1" max="10" step="1" value="${member.hitsRequired || 1}" style="width:60px;" />
                </div>
                <div class="scast-inline-field" title="Which side of the screen this character prefers. Ignored when the global 'Stage side' setting forces a single side. 'Auto' balances left/right based on who's already showing.">
                    <label>Preferred side:</label>
                    <select id="scast-ed-side" class="text_pole">
                        <option value="auto" ${member.sideBias === 'auto' ? 'selected' : ''}>Auto</option>
                        <option value="left" ${member.sideBias === 'left' ? 'selected' : ''}>Left</option>
                        <option value="right" ${member.sideBias === 'right' ? 'selected' : ''}>Right</option>
                    </select>
                </div>
            </div>

            <hr style="margin:12px 0;opacity:0.2;" />
            <div class="scast-variants-header">
                <b>Variants</b> <span class="scast-count-pill">(${member.variants.length})</span>
                <button id="scast-ed-add-variant" class="menu_button"><i class="fa-solid fa-plus scast-mr"></i>Add Variant</button>
            </div>
            <div id="scast-ed-variants" class="scast-variant-gallery"></div>

            <hr style="margin:16px 0;opacity:0.2;" />
            <div class="scast-row scast-move-row" id="scast-ed-move-row">
                <label class="scast-field-label">Move to another profile</label>
                <div class="scast-move-controls">
                    <select id="scast-ed-move-target" class="text_pole" title="Choose which profile to move this cast member into."></select>
                    <button id="scast-ed-move-btn" class="menu_button" title="Move this cast member into the selected profile. Portrait/variant images stay on the server untouched — only the character entry moves."><i class="fa-solid fa-arrow-right scast-mr"></i>Move</button>
                </div>
            </div>

            <div class="scast-row" style="margin-top:8px;">
                <button id="scast-ed-delete" class="menu_button scast-danger-btn" style="opacity:0.8;"><i class="fa-solid fa-trash scast-mr"></i>Delete Cast Member</button>
            </div>
        `;
    }

    pane.innerHTML = `
        <div class="scast-editor-layout">
            <div class="scast-preview-dock">
                <div class="scast-preview-heading">Live Preview</div>
                <div id="scast-preview-stage" class="scast-preview-stage"></div>
                <button id="scast-preview-replay" class="menu_button" style="width: 100%;"><i class="fa-solid fa-play scast-mr"></i>Replay exit</button>
            </div>
            <div class="scast-editor-scroll">${formHtml}</div>
        </div>
    `;

    pane.querySelector('#scast-preview-replay').addEventListener('click', replayPreviewExit);
    paintPreviewCard();

    if (!member) return;

    async function replacePortrait(file) {
        const previewStage = pane.querySelector('#scast-preview-stage');
        const oldPath = member.portrait;
        if (previewStage) previewStage.style.opacity = '0.5';
        try {
            const newPath = await uploadImageToServer(file, IMAGE_SUBFOLDER);
            member.portrait = newPath;
            persistConfig();
            if (isServerImagePath(oldPath) && oldPath !== newPath) safeDeleteServerImage(oldPath);
        } catch (err) {
            announce('Upload failed — check your connection and try again');
            console.error('[SceneCast] portrait upload failed', err);
        }
        renderRosterGrid();
        renderEditorPane(idx);
    }

    const previewStage = pane.querySelector('#scast-preview-stage');
    const portraitInput = document.createElement('input');
    portraitInput.type = 'file';
    portraitInput.accept = 'image/*';
    portraitInput.style.display = 'none';
    pane.appendChild(portraitInput);
    previewStage.addEventListener('click', () => portraitInput.click());
    portraitInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        await replacePortrait(file);
    });
    previewStage.addEventListener('dragover', e => { e.preventDefault(); e.stopPropagation(); previewStage.classList.add('drag-over'); });
    previewStage.addEventListener('dragleave', e => { e.stopPropagation(); previewStage.classList.remove('drag-over'); });
    previewStage.addEventListener('drop', async e => {
        e.preventDefault(); e.stopPropagation();
        previewStage.classList.remove('drag-over');
        const file = e.dataTransfer.files[0];
        if (!file) return;
        await replacePortrait(file);
    });

    let nameLinked = !member.displayName || !member.displayName.trim();
    let triggersLinked = !member.triggers || !member.triggers.trim();

    const nameInput = pane.querySelector('#scast-ed-name');
    const triggersInput = pane.querySelector('#scast-ed-triggers');

    nameInput.addEventListener('input', e => {
        member.displayName = e.target.value;
        nameLinked = false;
        if (triggersLinked) {
            member.triggers = e.target.value;
            triggersInput.value = e.target.value;
        }
        persistConfig();
        renderRosterGrid();
        paintPreviewCard();
    });
    pane.querySelector('#scast-ed-active').addEventListener('change', e => {
        member.active = e.target.checked;
        persistConfig();
        if (isViewingActiveProfile() && !member.active) {
            const mergedIdx = findMergedCastIndexById(loadConfig(), member.id);
            if (mergedIdx !== -1 && activeCast.has(mergedIdx)) {
                activeCast.delete(mergedIdx);
                queueStagePaint();
            }
        }
        renderRosterGrid();
    });
    pane.querySelector('#scast-ed-clear-portrait')?.addEventListener('click', async () => {
        if (!member.portrait) return;
        const confirmed = await themedConfirm("Remove this portrait? If this image isn't used elsewhere, it will also be deleted from the server.", { danger: true });
        if (!confirmed) return;
        const oldPath = member.portrait;
        member.portrait = '';
        persistConfig();
        safeDeleteServerImage(oldPath);
        renderRosterGrid();
        renderEditorPane(idx);
    });
    triggersInput.addEventListener('input', e => {
        member.triggers = e.target.value;
        triggersLinked = false;
        if (nameLinked) {
            member.displayName = e.target.value;
            nameInput.value = e.target.value;
        }
        persistConfig();
        renderRosterGrid();
        paintPreviewCard();
    });
    pane.querySelector('#scast-ed-regex').addEventListener('change', e => { member.useRegex = e.target.checked; persistConfig(); });
    pane.querySelector('#scast-ed-exclude').addEventListener('input', e => { member.excludeTriggers = e.target.value; persistConfig(); });
    pane.querySelector('#scast-ed-hits').addEventListener('change', e => { member.hitsRequired = Math.max(1, parseInt(e.target.value) || 1); persistConfig(); });
    pane.querySelector('#scast-ed-side').addEventListener('change', e => { member.sideBias = e.target.value; persistConfig(); });
    pane.querySelector('#scast-ed-add-variant').addEventListener('click', () => {
        member.variants.push({ tag: '', label: '', portrait: '' });
        persistConfig();
        renderEditorPane(idx);
    });
    pane.querySelector('#scast-ed-delete').addEventListener('click', () => removeCastMember(idx));

    const moveRow = pane.querySelector('#scast-ed-move-row');
    const moveSelect = pane.querySelector('#scast-ed-move-target');
    const moveBtn = pane.querySelector('#scast-ed-move-btn');
    const otherProfiles = listProfiles().filter(p => p.id !== panelViewingProfileId);
    if (otherProfiles.length === 0) {
        moveRow.style.display = 'none';
    } else {
        moveSelect.innerHTML = otherProfiles.map(p => `<option value="${p.id}">${toSafeMarkup(p.name)} (${p.count})</option>`).join('');
        moveBtn.addEventListener('click', async () => {
            const targetId = moveSelect.value;
            const targetProfile = otherProfiles.find(p => p.id === targetId);
            const name = member.displayName || parseTriggerList(member.triggers)[0] || 'this cast member';
            const confirmed = await themedConfirm(`Move "${name}" to profile "${targetProfile?.name}"?\n\nTheir portrait/variant images stay on the server as-is — only the character entry moves.`);
            if (!confirmed) return;

            const sourceWasActive = isViewingActiveProfile();
            const moved = moveCastMember(panelViewingProfileId, idx, targetId);
            if (!moved) { announce('Move failed'); return; }
            if (sourceWasActive) resetStage();

            panelSelectedIdx = null;
            renderProfileBar();
            renderRosterGrid();
            renderEditorPane(null);
            announce(`Moved "${name}" to "${targetProfile?.name}"`);
        });
    }

    const testerToggle = pane.querySelector('#scast-ed-tester-toggle');
    const testerBox = pane.querySelector('#scast-ed-tester-box');
    testerToggle.addEventListener('click', () => {
        const isOpen = testerBox.style.display !== 'none';
        testerBox.style.display = isOpen ? 'none' : 'flex';
        testerToggle.innerHTML = isOpen
            ? '<i class="fa-solid fa-flask scast-mr"></i>Test triggers on sample text ▾'
            : '<i class="fa-solid fa-flask scast-mr"></i>Test triggers on sample text ▴';
    });

    function runTriggerTest() {
        const testInput = pane.querySelector('#scast-ed-tester-input');
        const resultEl = pane.querySelector('#scast-ed-tester-result');
        const text = testInput.value || '';
        const state = loadConfig();
        const needed = member.hitsRequired || 1;

        let triggered = false;
        try {
            triggered = evaluateTrigger(text, member.triggers, state.matchCaseSensitive, needed, !!member.useRegex);
        } catch (err) {
            resultEl.classList.add('visible');
            resultEl.dataset.outcome = 'error';
            resultEl.textContent = `⚠ Regex error: ${err.message}`;
            return;
        }

        resultEl.classList.add('visible');
        if (!triggered) {
            resultEl.dataset.outcome = 'nomatch';
            resultEl.textContent = `✗ No match (needs ${needed} hit${needed > 1 ? 's' : ''}${member.useRegex ? ', regex mode' : ''})`;
            return;
        }

        const suppressed = isSuppressed(text, member.excludeTriggers, state.matchCaseSensitive);
        if (suppressed) {
            resultEl.dataset.outcome = 'suppressed';
            resultEl.textContent = '⚠ Triggers matched, but blocked by a suppress term — would NOT appear';
            return;
        }

        resultEl.dataset.outcome = 'match';
        resultEl.textContent = '✓ Match — would appear on stage';
    }

    pane.querySelector('#scast-ed-tester-run').addEventListener('click', runTriggerTest);
    pane.querySelector('#scast-ed-tester-input').addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); runTriggerTest(); }
    });

    renderArtworkGallery(member, idx);
}

function renderArtworkGallery(member, castIdx) {
    const gallery = document.getElementById('scast-ed-variants');
    if (!gallery) return;
    gallery.innerHTML = '';

    if (member.variants.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'scast-empty-note';
        empty.style.padding = '10px 0';
        empty.textContent = 'No variants yet. Add one, or drop a file named "Name_variant.png" onto the panel.';
        gallery.appendChild(empty);
        return;
    }

    member.variants.forEach((variant, variantIdx) => {
        const card = document.createElement('div');
        card.className = 'scast-variant-card';
        card.innerHTML = `
            <div class="scast-variant-thumb">
                       ${variant.portrait ? `<img src="${toImgSrc(variant.portrait)}" alt="variant" loading="lazy" onerror="this.onerror=null;this.src='${PLACEHOLDER_ART}'" />` : `<div class="scast-thumb-empty">?</div>`}
            </div>
            <input type="text" class="scast-variant-label text_pole" placeholder="Label" value="${toSafeMarkup(variant.label || variant.tag || '')}" />
            <div class="scast-variant-actions">
                <label class="scast-upload-btn menu_button" style="cursor:pointer;"><i class="fa-solid fa-upload"></i><input type="file" accept="image/*" style="display:none;" /></label>
                <button class="scast-variant-clear menu_button" title="Delete this variant's image from the server (only if unused elsewhere)" ${variant.portrait ? '' : 'disabled'}><i class="fa-solid fa-broom"></i></button>
                <button class="scast-variant-delete menu_button" title="Remove variant entirely"><i class="fa-solid fa-xmark"></i></button>
            </div>
        `;

        card.querySelector('.scast-variant-label').addEventListener('input', e => {
            variant.label = e.target.value;
            variant.tag = e.target.value;
            persistConfig();
        });
        card.querySelector('input[type="file"]').addEventListener('change', async e => {
            const file = e.target.files[0];
            if (!file) return;
            const oldPath = variant.portrait;
            try {
                variant.portrait = await uploadImageToServer(file, IMAGE_SUBFOLDER);
                persistConfig();
                if (isServerImagePath(oldPath) && oldPath !== variant.portrait) safeDeleteServerImage(oldPath);
            } catch (err) {
                announce('Upload failed — check your connection and try again');
                console.error('[SceneCast] variant upload failed', err);
            }
            renderArtworkGallery(member, castIdx);
        });
        card.querySelector('.scast-variant-clear').addEventListener('click', async () => {
            if (!variant.portrait) return;
            const confirmed = await themedConfirm("Delete this variant's image? If it isn't used elsewhere, it will also be removed from the server.", { danger: true });
            if (!confirmed) return;
            const oldPath = variant.portrait;
            variant.portrait = '';
            persistConfig();
            safeDeleteServerImage(oldPath);
            renderArtworkGallery(member, castIdx);
        });
        card.querySelector('.scast-variant-delete').addEventListener('click', () => {
            const oldPath = variant.portrait;
            member.variants.splice(variantIdx, 1);
            persistConfig();
            safeDeleteServerImage(oldPath);
            renderEditorPane(castIdx);
        });

        gallery.appendChild(card);
    });
}

function mountImageManager() {
    if (document.getElementById('scast-images-overlay')) return;
    const overlay = document.createElement('div');
    overlay.id = 'scast-images-overlay';
    overlay.className = 'scast-subpanel-overlay';
    overlay.innerHTML = `
        <div class="scast-subpanel">
            <div class="scast-subpanel-header">
                <b><i class="fa-solid fa-images scast-panel-header-icon"></i><span>Server Images (${toSafeMarkup(IMAGE_SUBFOLDER)}/)</span></b>
                <button id="scast-images-refresh" class="menu_button" title="Refresh"><i class="fa-solid fa-arrows-rotate"></i></button>
                <button id="scast-images-close" title="Close"><i class="fa-solid fa-xmark"></i></button>
            </div>
            <div id="scast-images-note" class="scast-empty-note" style="display:none;"></div>
            <div id="scast-images-grid" class="scast-images-grid"></div>
        </div>
    `;
    document.body.appendChild(overlay);
    attachOutsideClickToClose(overlay, closeImageManager);
    overlay.querySelector('#scast-images-close').addEventListener('click', closeImageManager);
    overlay.querySelector('#scast-images-refresh').addEventListener('click', renderImageManagerGrid);
}

function openImageManager() {
    mountImageManager();
    document.getElementById('scast-images-overlay').classList.add('visible');
    renderImageManagerGrid();
}

function closeImageManager() {
    document.getElementById('scast-images-overlay')?.classList.remove('visible');
}

async function createCastMemberFromImage(imagePath) {
    const name = await themedPrompt('Name for the new cast member (also used as the trigger term):', '');
    if (name === null) return;
    const trimmed = name.trim();
    if (!trimmed) { announce('Name cannot be empty'); return; }

    const cast = getProfileCast(panelViewingProfileId);
    cast.push(normalizeMember({ triggers: trimmed, portrait: imagePath, displayName: trimmed, variants: [] }));
    persistConfig();

    panelSelectedIdx = cast.length - 1;
    renderProfileBar();
    renderRosterGrid();
    renderEditorPane(panelSelectedIdx);
    renderImageManagerGrid();
    announce(`Created "${trimmed}" from this image`);
}

async function renderImageManagerGrid() {
    const grid = document.getElementById('scast-images-grid');
    const note = document.getElementById('scast-images-note');
    if (!grid) return;
    grid.innerHTML = '<div class="scast-empty-note">Loading…</div>';
    note.style.display = 'none';

    let images;
    try {
        images = await listServerImages(IMAGE_SUBFOLDER);
    } catch (err) {
        grid.innerHTML = '';
        note.style.display = 'block';
        note.textContent = `Could not load image list: ${err.message}`;
        console.error('[SceneCast] listServerImages failed', err);
        return;
    }

    grid.innerHTML = '';
    if (images.length === 0) {
        note.style.display = 'block';
        note.textContent = 'No images found in the scenecast folder.';
        return;
    }

    for (const img of images) {
        const refs = findPortraitReferences(img.path);
        const tile = document.createElement('div');
        tile.className = 'scast-image-tile';
        tile.innerHTML = `
            <div class="scast-image-thumb"><img src="${toImgSrc(img.path)}" loading="lazy" onerror="this.onerror=null;this.src='${PLACEHOLDER_ART}'" /></div>
            <div class="scast-image-name" title="${toSafeMarkup(img.filename)}">${toSafeMarkup(img.filename)}</div>
            <div class="scast-image-usage">${refs.length ? `Used by: ${toSafeMarkup(refs.join(', '))}` : 'Unused'}</div>
            <div class="scast-image-actions">
                <button class="scast-image-usecard menu_button" title="Create a new cast member in the currently viewed profile using this image"><i class="fa-solid fa-plus scast-mr"></i>Character</button>
                <button class="scast-image-delete menu_button scast-danger-btn" title="Delete this image from the server"><i class="fa-solid fa-trash"></i></button>
            </div>
        `;
        tile.querySelector('.scast-image-usecard').addEventListener('click', () => createCastMemberFromImage(img.path));
        tile.querySelector('.scast-image-delete').addEventListener('click', async () => {
            const confirmMsg = refs.length
                ? `This image is used by: ${refs.join(', ')}.\n\nDeleting it will also clear it from those cast member(s). Continue?`
                : 'Delete this image from the server? This cannot be undone.';
            const confirmed = await themedConfirm(confirmMsg, { danger: true });
            if (!confirmed) return;

            const ok = await deleteImageFromServer(img.path);
            if (ok) {
                clearPortraitReferencesEverywhere(img.path);
                renderRosterGrid();
                if (panelSelectedIdx !== null) renderEditorPane(panelSelectedIdx);
            } else {
                announce('Failed to delete image — check console for details');
            }
            renderImageManagerGrid();
        });
        grid.appendChild(tile);
    }
}

function composeSidebarMarkup(profileNamesText) {
    return `
<div id="scast-sidebar-panel" class="inline-drawer" style="margin-bottom:10px;">
    <div class="inline-drawer-toggle inline-drawer-header">
        <b>SceneCast Portrait Stage</b>
        <div style="display: flex; align-items: center; gap: 8px;">
            <div id="scast-sidebar-heart-slot"></div>
            <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
        </div>
    </div>
    <div class="inline-drawer-content" style="display:none;">
        <div class="scast-body">
            <div class="scast-row" style="margin-top: 4px;">
                <label class="scast-inline-check"><input type="checkbox" id="scast_active_toggle" /> Enabled</label>
            </div>
            <div class="scast-row scast-sidebar-profile-note" style="display: flex; align-items: center;">
                <i class="fa-solid fa-masks-theater" style="margin-right: 6px;"></i>
                <span style="margin-right: 6px;">Cast profile:</span>
<span class="scast-sidebar-profile-names" title="${toSafeMarkup(profileNamesText)}">${toSafeMarkup(profileNamesText)}</span>
            </div>
            <div class="scast-row" style="margin-bottom: 4px;">
                <button id="scast_open_panel" class="menu_button"><i class="fa-solid fa-clapperboard" style="margin-right: 6px;"></i>Open Cast Manager</button>
            </div>
        </div>
    </div>
</div>`;
}

export function mountSidebarPanel() {
    const state = loadConfig();
    const activeIds = getActiveProfileIds();
    const allProfiles = listProfiles();
    const activeNames = activeIds
        .map(id => allProfiles.find(p => p.id === id)?.name)
        .filter(Boolean);
    const namesText = activeNames.length ? activeNames.join(', ') : 'Default';

    document.getElementById('scast-sidebar-panel')?.remove();

    const wrap = document.createElement('div');
    wrap.innerHTML = composeSidebarMarkup(namesText);
    const target = document.getElementById('extensions_settings2') ?? document.getElementById('extensions_settings');
    if (!target) return;
    
    target.appendChild(wrap.firstElementChild);

    document.getElementById('scast-sidebar-heart-slot').appendChild(createHeartButton());

    const activeToggle = document.getElementById('scast_active_toggle');
    activeToggle.checked = state.isActive;
    activeToggle.addEventListener('change', e => {
        state.isActive = e.target.checked;
        persistConfig();
        if (!state.isActive) {
            resetStage();
            detachTimelineWatcher();
        } else if (state.timelineSync) {
            attachTimelineWatcher();
        }
    });

    document.getElementById('scast_open_panel').addEventListener('click', openDirectorPanel);
}
