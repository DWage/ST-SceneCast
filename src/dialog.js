import { toSafeMarkup, attachOutsideClickToClose } from './utils.js';

function mountDialog(message, { mode, danger = false, defaultValue = '' } = {}) {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'scast-subpanel-overlay visible';
        overlay.style.zIndex = '9000';

        const inputHtml = mode === 'prompt'
            ? `<input type="text" id="scast-dlg-input" class="text_pole" style="width:100%;box-sizing:border-box;" />`
            : '';

        const buttonsHtml = mode === 'alert'
            ? `<button class="menu_button" id="scast-dlg-ok" style="flex:1;">OK</button>`
            : `<button class="menu_button" id="scast-dlg-cancel" style="flex:1;">Cancel</button>
               <button class="menu_button ${danger ? 'scast-danger-btn' : ''}" id="scast-dlg-ok" style="flex:1;">OK</button>`;

        overlay.innerHTML = `
            <div class="scast-donate-card" style="gap:16px;">
                <p style="margin:0;font-size:13px;line-height:1.5;white-space:pre-line;">${toSafeMarkup(message)}</p>
                ${inputHtml}
                <div style="display:flex;gap:8px;width:100%;">${buttonsHtml}</div>
            </div>`;
        document.body.appendChild(overlay);

        const input = mode === 'prompt' ? overlay.querySelector('#scast-dlg-input') : null;
        const closeValue = mode === 'prompt' ? null : (mode === 'alert' ? undefined : false);
        const confirmValue = mode === 'prompt' ? null : (mode === 'alert' ? undefined : true);

        const cleanup = (result) => {
            document.removeEventListener('keydown', onKey);
            overlay.remove();
            resolve(result);
        };

        function onKey(e) {
            if (e.key === 'Escape') {
                cleanup(closeValue);
            } else if (e.key === 'Enter' && mode !== 'prompt') {
                cleanup(confirmValue);
            }
        }
        document.addEventListener('keydown', onKey);

        overlay.querySelector('#scast-dlg-ok').addEventListener('click', () => {
            cleanup(mode === 'prompt' ? input.value : confirmValue);
        });
        const cancelBtn = overlay.querySelector('#scast-dlg-cancel');
        if (cancelBtn) cancelBtn.addEventListener('click', () => cleanup(closeValue));

        attachOutsideClickToClose(overlay, () => cleanup(closeValue));

        if (input) {
            input.value = defaultValue ?? '';
            input.addEventListener('keydown', (e) => {
                e.stopPropagation();
                if (e.key === 'Enter') { e.preventDefault(); cleanup(input.value); }
                if (e.key === 'Escape') { e.preventDefault(); cleanup(null); }
            });
            requestAnimationFrame(() => { input.focus(); input.select(); });
        }
    });
}

export function themedConfirm(message, { danger = false } = {}) {
    return mountDialog(message, { mode: 'confirm', danger });
}

export function themedAlert(message) {
    return mountDialog(message, { mode: 'alert' });
}

export function themedPrompt(message, defaultValue = '') {
    return mountDialog(message, { mode: 'prompt', defaultValue });
}
