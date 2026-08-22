import { 
    loadConfig, persistConfig, IMAGE_SUBFOLDER, PLACEHOLDER_ART, TRAY_CAP,
    STAGE_MODES, STAGE_SIDES, DISMISS_MODES, EXIT_STYLES,
    listProfiles, getProfileCast, getActiveProfileId, getActiveProfileIds,
    createProfile, duplicateProfile, renameProfile, deleteProfile,
    bindCharacterToProfile, unbindCharacterFromProfile, getCurrentBinding,
    resolveCharacterDisplayName, refreshActiveProfileForCurrentChat
} from './config.js';
import { activeCast, queueStagePaint, resetStage, applyVisualVars, paintStage } from './stage.js';
import { toSafeMarkup, parseTriggerList, debounce, uploadImageToServer, deleteImageFromServer, isServerImagePath, toImgSrc } from './utils.js';

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
                <b>Cast Manager</b>
                <button id="scast-panel-close"><i class="fa-solid fa-xmark"></i></button>
            </div>
            
            <div id="scast-profile-bar">
                <select id="scast-profile-select" class="text_pole"></select>
                <button id="scast-profile-bind" class="menu_button">Bind</button>
                <span class="scast-toolbar-divider"></span>
                <button id="scast-profile-new" class="menu_button">New</button>
                <button id="scast-profile-dup" class="menu_button">Dup</button>
                <button id="scast-profile-rename" class="menu_button">Rename</button>
                <button id="scast-profile-delete" class="menu_button scast-danger-btn">Delete</button>
                <span id="scast-profile-binding-note" class="scast-profile-note"></span>
            </div>

            <div id="scast-panel-settings-wrap">
                <div id="scast-panel-settings-toggle">
                    <span>Stage settings</span>
                    <span id="scast-settings-chevron">▲</span>
                </div>
                <div id="scast-panel-settings"></div>
            </div>

            <div id="scast-panel-body">
                <div id="scast-roster-pane">
                    <div id="scast-roster-toolbar">
                        <input type="text" id="scast-roster-search" class="text_pole" placeholder="Search cast..." />
                        <button id="scast-roster-add" class="menu_button">Add</button>
                    </div>
                    <div id="scast-roster-grid"></div>
                </div>
                <div id="scast-editor-pane"></div>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    overlay.querySelector('#scast-panel-close').addEventListener('click', closeDirectorPanel);
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) closeDirectorPanel(); });

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
        renderEditorPane();
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
    });

    overlay.querySelector('#scast-profile-new').addEventListener('click', () => {
        const name = prompt('New profile name:', 'New World');
        if (name === null) return;
        const id = createProfile(name.trim() || 'New World');
        panelViewingProfileId = id;
        panelSelectedIdx = null;
        renderProfileBar();
        renderRosterGrid();
        renderEditorPane();
    });

    overlay.querySelector('#scast-profile-dup').addEventListener('click', () => {
        const id = duplicateProfile(panelViewingProfileId);
        if (!id) return;
        panelViewingProfileId = id;
        panelSelectedIdx = null;
        renderProfileBar();
        renderRosterGrid();
        renderEditorPane();
    });

    overlay.querySelector('#scast-profile-rename').addEventListener('click', () => {
        const current = listProfiles().find(p => p.id === panelViewingProfileId);
        const name = prompt('Rename profile:', current?.name || '');
        if (!name) return;
        renameProfile(panelViewingProfileId, name.trim());
        renderProfileBar();
    });

    overlay.querySelector('#scast-profile-delete').addEventListener('click', () => {
        const profiles = listProfiles();
        if (profiles.length <= 1) { alert('You need at least one profile.'); return; }
        const current = profiles.find(p => p.id === panelViewingProfileId);
        if (!confirm(`Delete profile "${current?.name}"?`)) return;

        const wasActive = isViewingActiveProfile();
        const removedCast = deleteProfile(panelViewingProfileId);
        if (Array.isArray(removedCast)) {
            for (const member of removedCast) {
                if (isServerImagePath(member.portrait)) deleteImageFromServer(member.portrait);
            }
        }
        panelViewingProfileId = getActiveProfileId();
        panelSelectedIdx = null;
        if (wasActive) resetStage();
        renderProfileBar();
        renderRosterGrid();
        renderEditorPane();
    });

    overlay.querySelector('#scast-roster-search').addEventListener('input', debounce((e) => {
        panelSearchQuery = e.target.value;
        renderRosterGrid();
    }, 180));

    overlay.querySelector('#scast-roster-add').addEventListener('click', () => {
        const cast = getProfileCast(panelViewingProfileId);
        cast.push({ triggers: '', portrait: '', displayName: '', active: true, variants: [] });
        persistConfig();
        panelSelectedIdx = cast.length - 1;
        renderProfileBar();
        renderRosterGrid();
        renderEditorPane();
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
    renderEditorPane();
}

function closeDirectorPanel() {
    document.getElementById('scast-panel-overlay')?.classList.remove('visible');
}

function renderPanelSettings() {
    const state = loadConfig();
    const container = document.getElementById('scast-panel-settings');
    if (!container) return;

    const modeOptions = STAGE_MODES.map(m => `<option value="${m.value}">${toSafeMarkup(m.label)}</option>`).join('');
    const sideOptions = STAGE_SIDES.map(s => `<option value="${s.value}">${toSafeMarkup(s.label)}</option>`).join('');
    const dismissOptions = DISMISS_MODES.map(c => `<option value="${c.value}">${toSafeMarkup(c.label)}</option>`).join('');
    const exitOptions = EXIT_STYLES.map(a => `<option value="${a.value}">${toSafeMarkup(a.label)}</option>`).join('');

    container.innerHTML = `
        <div class="scast-setting-group">
            <label class="scast-mini-field">
                <span class="scast-mini-label">Display style</span>
                <select id="scast-cfg-mode" class="text_pole">${modeOptions}</select>
            </label>
            <label class="scast-mini-field">
                <span class="scast-mini-label">Exit animation</span>
                <select id="scast-cfg-exitanim" class="text_pole">${exitOptions}</select>
            </label>
            <label class="scast-mini-field">
                <span class="scast-mini-label">Stage side</span>
                <select id="scast-cfg-stageside" class="text_pole">${sideOptions}</select>
            </label>
            <label class="scast-mini-field">
                <span class="scast-mini-label">Dismiss mode</span>
                <select id="scast-cfg-dismissmode" class="text_pole">${dismissOptions}</select>
            </label>
            <label class="scast-mini-field" id="scast-cfg-keepalive-wrap">
                <span class="scast-mini-label">Keep-alive replies</span>
                <input type="number" id="scast-cfg-keepalive" class="text_pole" min="0" max="20" step="1" />
            </label>
            <label class="scast-mini-field">
                <span class="scast-mini-label">Max on stage</span>
                <input type="number" id="scast-cfg-maxcast" class="text_pole" min="0" max="${TRAY_CAP}" step="1" />
            </label>
        </div>
        <div class="scast-setting-group" style="margin-top:8px;">
            <label class="scast-mini-field">
                <span class="scast-mini-label">Hue shift (<span id="scast-cfg-hue-val">0</span>°)</span>
                <input type="range" id="scast-cfg-hue" min="0" max="360" step="1" />
            </label>
            <label class="scast-mini-field">
                <span class="scast-mini-label">Card size (<span id="scast-cfg-scale-val">100</span>%)</span>
                <input type="range" id="scast-cfg-scale" min="80" max="160" step="1" />
            </label>
            <div class="scast-mini-checkboxes">
                <label class="scast-mini-check"><input type="checkbox" id="scast-cfg-case" /> Case-sensitive</label>
                <label class="scast-mini-check"><input type="checkbox" id="scast-cfg-showinfo" /> Info bar</label>
                <label class="scast-mini-check"><input type="checkbox" id="scast-cfg-showvarianttag" /> Variant label</label>
            </div>
        </div>
    `;

    const bind = (id, event, stateKey, cb) => {
        const el = container.querySelector(id);
        if (el.type === 'checkbox') el.checked = state[stateKey];
        else el.value = state[stateKey];
        el.addEventListener(event, e => {
            state[stateKey] = el.type === 'checkbox' ? e.target.checked : (el.type === 'number' || el.type === 'range' ? parseFloat(e.target.value) || 0 : e.target.value);
            persistConfig();
            if (cb) cb(e);
        });
    };

    bind('#scast-cfg-mode', 'change', 'stageMode', () => { paintStage(); paintPreviewCard(); });
    bind('#scast-cfg-exitanim', 'change', 'exitAnim');
    bind('#scast-cfg-stageside', 'change', 'stageSide', () => paintStage());
    bind('#scast-cfg-dismissmode', 'change', 'dismissMode');
    bind('#scast-cfg-keepalive', 'change', 'keepAliveReplies');
    bind('#scast-cfg-maxcast', 'change', 'maxCastSize');

    const hueVal = container.querySelector('#scast-cfg-hue-val');
    hueVal.textContent = state.accentHueShift;
    bind('#scast-cfg-hue', 'input', 'accentHueShift', () => {
        hueVal.textContent = state.accentHueShift;
        paintStage(); paintPreviewCard();
    });

    const scaleVal = container.querySelector('#scast-cfg-scale-val');
    scaleVal.textContent = Math.round((state.cardScale || 1) * 100);
    bind('#scast-cfg-scale', 'input', 'cardScale', e => {
        const percent = parseInt(e.target.value) || 100;
        state.cardScale = percent / 100;
        scaleVal.textContent = percent;
        paintStage(); paintPreviewCard();
    });

    bind('#scast-cfg-case', 'change', 'matchCaseSensitive');
    bind('#scast-cfg-showinfo', 'change', 'showInfoBar', () => { paintStage(); paintPreviewCard(); });
    bind('#scast-cfg-showvarianttag', 'change', 'showVariantTag');
}

function renderProfileBar() {
    const select = document.getElementById('scast-profile-select');
    const bindBtn = document.getElementById('scast-profile-bind');
    const note = document.getElementById('scast-profile-binding-note');
    if (!select) return;

    const profiles = listProfiles();
    select.innerHTML = profiles.map(p =>
        `<option value="${p.id}" ${p.id === panelViewingProfileId ? 'selected' : ''}>${toSafeMarkup(p.name)} (${p.count})</option>`
    ).join('');

    const binding = getCurrentBinding();
    const charName = resolveCharacterDisplayName();

    if (!binding.key) {
        note.textContent = 'No character detected';
        bindBtn.disabled = true;
        bindBtn.textContent = 'Bind';
    } else {
        const isBoundHere = binding.profileIds.includes(panelViewingProfileId);
        bindBtn.disabled = false;
        bindBtn.textContent = isBoundHere ? 'Unbind' : 'Bind';
        note.textContent = isBoundHere ? `Bound to ${charName || 'this character'}` : '';
    }
}

function renderRosterGrid() {
    const cast = getProfileCast(panelViewingProfileId);
    const container = document.getElementById('scast-roster-grid');
    if (!container) return;
    container.innerHTML = '';

    const query = panelSearchQuery.trim().toLowerCase();

    cast.forEach((member, idx) => {
        if (query) {
            const name = (member.displayName || '').toLowerCase();
            const termMatch = parseTriggerList(member.triggers).some(t => t.toLowerCase().includes(query));
            if (!name.includes(query) && !termMatch) return;
        }

        const tile = document.createElement('div');
        tile.className = 'scast-roster-tile';
        if (panelSelectedIdx === idx) tile.dataset.selected = 'true';

        const displayName = member.displayName || parseTriggerList(member.triggers)[0] || 'Unnamed';

        tile.innerHTML = `
            <div class="scast-roster-tile-thumb">
                <img src="${member.portrait ? toImgSrc(member.portrait) : PLACEHOLDER_ART}" />
            </div>
            <div class="scast-roster-tile-name">${toSafeMarkup(displayName)}</div>
            <button class="scast-roster-tile-delete"><i class="fa-solid fa-xmark"></i></button>
        `;

        tile.addEventListener('click', () => {
            panelSelectedIdx = idx;
            renderRosterGrid();
            renderEditorPane();
        });

        tile.querySelector('.scast-roster-tile-delete').addEventListener('click', (e) => {
            e.stopPropagation();
            if (!confirm(`Delete "${displayName}"?`)) return;
            
            const oldPath = member.portrait;
            cast.splice(idx, 1);
            persistConfig();
            
            if (isServerImagePath(oldPath)) deleteImageFromServer(oldPath);
            if (isViewingActiveProfile() && activeCast.has(idx)) resetStage();
            
            panelSelectedIdx = null;
            renderProfileBar();
            renderRosterGrid();
            renderEditorPane();
        });

        container.appendChild(tile);
    });
}

function paintPreviewCard() {
    const stage = document.getElementById('scast-preview-stage');
    if (!stage) return;
    applyVisualVars(stage, loadConfig());

    const cast = getProfileCast(panelViewingProfileId);
    const member = (panelSelectedIdx !== null) ? cast[panelSelectedIdx] : null;
    const src = member?.portrait ? toImgSrc(member.portrait) : PLACEHOLDER_ART;
    const name = member?.displayName || 'Preview';

    stage.innerHTML = `
        <div class="scast-card" data-crop-fit="smart">
            <img class="scast-card-bg" src="${src}" onerror="this.onerror=null;this.src='${PLACEHOLDER_ART}'" />
            <img class="scast-card-fg" src="${src}" onerror="this.onerror=null;this.src='${PLACEHOLDER_ART}'" />
            <div class="scast-card-info"><span class="scast-name">${toSafeMarkup(name)}</span></div>
        </div>
    `;
}

function renderEditorPane() {
    const pane = document.getElementById('scast-editor-pane');
    if (!pane) return;

    const cast = getProfileCast(panelViewingProfileId);
    const member = (panelSelectedIdx !== null) ? cast[panelSelectedIdx] : null;

    if (!member) {
        pane.innerHTML = `<div style="opacity:0.5; text-align:center; padding: 20px;">Select a character</div>`;
        return;
    }

    pane.innerHTML = `
        <div class="scast-editor-layout">
            <div class="scast-preview-dock">
                <div id="scast-preview-stage" class="scast-preview-stage"></div>
                <button id="scast-change-portrait-btn" class="menu_button" style="width:100%;margin-top:6px;font-size:11px;">Change Portrait</button>
                <input type="file" id="scast-portrait-upload" accept="image/*" style="display:none;" />
            </div>
            <div class="scast-editor-form">
                <div style="display:flex;gap:8px;">
                    <input type="text" id="scast-ed-name" class="text_pole" placeholder="Display name" value="${toSafeMarkup(member.displayName || '')}" style="flex:1;" />
                    <label class="scast-mini-check"><input type="checkbox" id="scast-ed-active" ${member.active ? 'checked' : ''} /> Active</label>
                </div>
                <input type="text" id="scast-ed-triggers" class="text_pole" placeholder="Triggers (comma separated)" value="${toSafeMarkup(member.triggers || '')}" style="margin-top: 8px;width:100%;box-sizing:border-box;" />
                
                <div style="display:flex;gap:12px;margin-top:8px;">
                    <label class="scast-mini-field" style="width:80px;">
                        <span class="scast-mini-label">Hits needed:</span>
                        <input type="number" id="scast-ed-hits" class="text_pole" min="1" max="10" value="${member.hitsRequired || 1}" />
                    </label>
                    <label class="scast-mini-field" style="flex:1;">
                        <span class="scast-mini-label">Side:</span>
                        <select id="scast-ed-side" class="text_pole">
                            <option value="auto" ${member.sideBias === 'auto' ? 'selected' : ''}>Auto</option>
                            <option value="left" ${member.sideBias === 'left' ? 'selected' : ''}>Left</option>
                            <option value="right" ${member.sideBias === 'right' ? 'selected' : ''}>Right</option>
                        </select>
                    </label>
                </div>

                <hr style="margin:12px 0;opacity:0.15;" />
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                    <b>Variants (${member.variants.length})</b>
                    <button id="scast-ed-add-variant" class="menu_button" style="font-size:11px;">+ Add Variant</button>
                </div>
                <div id="scast-variants-list" style="display:flex;flex-direction:column;gap:6px;"></div>
            </div>
        </div>
    `;

    paintPreviewCard();

    pane.querySelector('#scast-change-portrait-btn').addEventListener('click', () => {
        pane.querySelector('#scast-portrait-upload').click();
    });

    pane.querySelector('#scast-portrait-upload').addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const oldPath = member.portrait;
        try {
            const newPath = await uploadImageToServer(file, IMAGE_SUBFOLDER);
            member.portrait = newPath;
            persistConfig();
            if (isServerImagePath(oldPath) && oldPath !== newPath) deleteImageFromServer(oldPath);
            renderRosterGrid();
            renderEditorPane();
        } catch (err) {
            alert('Upload failed');
        }
    });

    pane.querySelector('#scast-ed-name').addEventListener('input', e => {
        member.displayName = e.target.value;
        persistConfig();
        renderRosterGrid();
        paintPreviewCard();
    });

    pane.querySelector('#scast-ed-active').addEventListener('change', e => {
        member.active = e.target.checked;
        persistConfig();
        if (isViewingActiveProfile() && !member.active && activeCast.has(panelSelectedIdx)) {
            activeCast.delete(panelSelectedIdx);
            queueStagePaint();
        }
        renderRosterGrid();
    });

    pane.querySelector('#scast-ed-triggers').addEventListener('input', e => {
        member.triggers = e.target.value;
        persistConfig();
        renderRosterGrid();
    });

    pane.querySelector('#scast-ed-hits').addEventListener('change', e => {
        member.hitsRequired = Math.max(1, parseInt(e.target.value) || 1);
        persistConfig();
    });

    pane.querySelector('#scast-ed-side').addEventListener('change', e => {
        member.sideBias = e.target.value;
        persistConfig();
    });

    pane.querySelector('#scast-ed-add-variant').addEventListener('click', () => {
        member.variants.push({ tag: '', label: '', portrait: '' });
        persistConfig();
        renderEditorPane();
    });

    const vList = pane.querySelector('#scast-variants-list');
    member.variants.forEach((variant, vIdx) => {
        const vRow = document.createElement('div');
        vRow.style.display = 'flex';
        vRow.style.gap = '6px';
        vRow.style.alignItems = 'center';
        vRow.innerHTML = `
            <img src="${variant.portrait ? toImgSrc(variant.portrait) : PLACEHOLDER_ART}" style="width:30px;height:30px;border-radius:4px;object-fit:cover;" />
            <input type="text" class="text_pole" placeholder="Label (e.g. Angry)" value="${toSafeMarkup(variant.label || '')}" style="flex:1;font-size:12px;" />
            <label class="menu_button" style="cursor:pointer;font-size:11px;"><i class="fa-solid fa-upload"></i><input type="file" accept="image/*" style="display:none;" /></label>
            <button class="menu_button scast-danger-btn" style="font-size:11px;"><i class="fa-solid fa-trash"></i></button>
        `;

        vRow.querySelector('input[type="text"]').addEventListener('input', e => {
            variant.label = e.target.value;
            variant.tag = e.target.value;
            persistConfig();
        });

        vRow.querySelector('input[type="file"]').addEventListener('change', async e => {
            const file = e.target.files[0];
            if (!file) return;
            const oldPath = variant.portrait;
            try {
                const newPath = await uploadImageToServer(file, IMAGE_SUBFOLDER);
                variant.portrait = newPath;
                persistConfig();
                if (isServerImagePath(oldPath) && oldPath !== newPath) deleteImageFromServer(oldPath);
                renderEditorPane();
            } catch (err) {
                alert('Upload failed');
            }
        });

        vRow.querySelector('.scast-danger-btn').addEventListener('click', () => {
            const oldPath = variant.portrait;
            member.variants.splice(vIdx, 1);
            persistConfig();
            if (isServerImagePath(oldPath)) deleteImageFromServer(oldPath);
            renderEditorPane();
        });

        vList.appendChild(vRow);
    });
}

export function mountSidebarPanel() {
    const target = document.getElementById('extensions_settings2') ?? document.getElementById('extensions_settings');
    if (!target) return;

    document.getElementById('scast-sidebar-panel')?.remove();

    const activeIds = getActiveProfileIds();
    const allProfiles = listProfiles();
    const activeNames = activeIds.map(id => allProfiles.find(p => p.id === id)?.name).filter(Boolean);
    const namesText = activeNames.length ? activeNames.join(', ') : 'Default';

    const wrap = document.createElement('div');
    wrap.innerHTML = `
        <div id="scast-sidebar-panel" class="inline-drawer" style="margin-bottom:10px;">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>SceneCast Stage</b>
            </div>
            <div class="inline-drawer-content">
                <div style="padding: 10px; background: rgba(0,0,0,0.2); border-radius: 8px;">
                    <div style="margin-bottom:8px;font-size:12px;opacity:0.8;">Active: <b>${toSafeMarkup(namesText)}</b></div>
                    <button id="scast_open_panel" class="menu_button" style="width:100%;">Open Cast Manager</button>
                </div>
            </div>
        </div>
    `;
    
    target.appendChild(wrap.firstElementChild);
    document.getElementById('scast_open_panel').addEventListener('click', openDirectorPanel);
}