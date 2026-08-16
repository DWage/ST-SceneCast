import { loadConfig, persistConfig, IMAGE_SUBFOLDER, PLACEHOLDER_ART } from './config.js';
import { activeCast, queueStagePaint, resetStage } from './stage.js';
import { toSafeMarkup, parseTriggerList, debounce, uploadImageToServer, deleteImageFromServer, isServerImagePath, toImgSrc } from './utils.js';

let panelSelectedIdx = null;
let panelSearchQuery = '';

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
    
    overlay.addEventListener('mousedown', (e) => {
        if (e.target === overlay) closeDirectorPanel();
    });

    overlay.querySelector('#scast-roster-search').addEventListener('input', debounce((e) => {
        panelSearchQuery = e.target.value;
        renderRosterGrid();
    }, 180));

    overlay.querySelector('#scast-roster-add').addEventListener('click', () => {
        const state = loadConfig();
        state.cast.push({ triggers: '', portrait: '', displayName: '', active: true });
        persistConfig();
        panelSelectedIdx = state.cast.length - 1;
        renderRosterGrid();
        renderEditorPane();
    });
}

export function openDirectorPanel() {
    mountDirectorPanel();
    document.getElementById('scast-panel-overlay').classList.add('visible');
    panelSelectedIdx = null;
    renderRosterGrid();
    renderEditorPane();
}

function closeDirectorPanel() {
    document.getElementById('scast-panel-overlay')?.classList.remove('visible');
}

function renderRosterGrid() {
    const state = loadConfig();
    const container = document.getElementById('scast-roster-grid');
    if (!container) return;
    container.innerHTML = '';

    const query = panelSearchQuery.trim().toLowerCase();

    state.cast.forEach((member, idx) => {
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
            state.cast.splice(idx, 1);
            persistConfig();
            
            if (isServerImagePath(oldPath)) deleteImageFromServer(oldPath);
            if (activeCast.has(idx)) resetStage();
            
            panelSelectedIdx = null;
            renderRosterGrid();
            renderEditorPane();
        });

        container.appendChild(tile);
    });
}

function renderEditorPane() {
    const pane = document.getElementById('scast-editor-pane');
    if (!pane) return;

    const state = loadConfig();
    const member = (panelSelectedIdx !== null) ? state.cast[panelSelectedIdx] : null;

    if (!member) {
        pane.innerHTML = `<div style="opacity:0.5; text-align:center; padding: 20px;">Select a character</div>`;
        return;
    }

    pane.innerHTML = `
        <div class="scast-editor-layout">
            <div class="scast-preview-stage">
                <img src="${member.portrait ? toImgSrc(member.portrait) : PLACEHOLDER_ART}" />
                <input type="file" id="scast-portrait-upload" accept="image/*" style="display:none;" />
            </div>
            <div class="scast-editor-form">
                <input type="text" id="scast-ed-name" class="text_pole" placeholder="Display name" value="${toSafeMarkup(member.displayName || '')}" />
                <input type="text" id="scast-ed-triggers" class="text_pole" placeholder="Triggers (comma separated)" value="${toSafeMarkup(member.triggers || '')}" style="margin-top: 10px;" />
            </div>
        </div>
    `;

    pane.querySelector('.scast-preview-stage').addEventListener('click', () => {
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
            if (isServerImagePath(oldPath) && oldPath !== newPath) {
                deleteImageFromServer(oldPath);
            }
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
    });

    pane.querySelector('#scast-ed-triggers').addEventListener('input', e => {
        member.triggers = e.target.value;
        persistConfig();
        renderRosterGrid();
    });
}

export function mountSidebarPanel() {
    const target = document.getElementById('extensions_settings2') ?? document.getElementById('extensions_settings');
    if (!target) return;

    if (document.getElementById('scast-sidebar-panel')) return;

    const wrap = document.createElement('div');
    wrap.innerHTML = `
        <div id="scast-sidebar-panel" class="inline-drawer" style="margin-bottom:10px;">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>SceneCast Stage</b>
            </div>
            <div class="inline-drawer-content">
                <div style="padding: 10px; background: rgba(0,0,0,0.2); border-radius: 8px;">
                    <button id="scast_open_panel" class="menu_button" style="width:100%;">Open Cast Manager</button>
                </div>
            </div>
        </div>
    `;
    
    target.appendChild(wrap.firstElementChild);
    document.getElementById('scast_open_panel').addEventListener('click', openDirectorPanel);
}