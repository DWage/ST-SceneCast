import { loadConfig, persistConfig } from './config.js';
import { announce, attachOutsideClickToClose } from './utils.js';

export const DONATE_USDT_ADDRESS = 'TDAskD2uuNnk4VpM9c7H7ZWrP4CukbgqG6';
export const DONATE_SWAP_URL = 'https://sideshift.ai/';

const QR_IMAGE_URL = new URL('../assets/images/QR.png', import.meta.url).href;

function mountDonateModal() {
    if (document.getElementById('scast-donate-overlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'scast-donate-overlay';
    overlay.className = 'scast-subpanel-overlay scast-donate-overlay';
    overlay.innerHTML = `
        <div class="scast-donate-card">
            <button id="scast-donate-close" class="scast-donate-close" title="Close"><i class="fa-solid fa-xmark"></i></button>

            <div class="scast-donate-heart"><i class="fa-solid fa-heart"></i></div>
            <h3 class="scast-donate-title">Thank you for using SceneCast!</h3>
            <p class="scast-donate-text">
                If it made your roleplay more fun, feel free to support the project below — totally optional, but every little bit helps me a lot.
            </p>

            <div class="scast-donate-qr-wrap">
                <img src="${QR_IMAGE_URL}" alt="USDT (TRC-20) donation QR code" class="scast-donate-qr" />
            </div>

            <div class="scast-donate-addr-row">
                <code id="scast-donate-addr" class="scast-donate-addr">${DONATE_USDT_ADDRESS}</code>
                <button id="scast-donate-copy" class="menu_button" title="Copy address"><i class="fa-solid fa-copy"></i> Copy</button>
            </div>
            <div class="scast-donate-network-note"><i class="fa-solid fa-triangle-exclamation"></i> USDT — TRC-20 (Tron) network ONLY</div>

            <a href="${DONATE_SWAP_URL}" target="_blank" rel="noopener noreferrer" class="scast-donate-swap-link">
                Have a different coin? <i class="fa-solid fa-arrow-right"></i>
            </a>

            <div class="scast-donate-footnote">
                Crypto only because PayPal/Patreon don't work in my country.
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    attachOutsideClickToClose(overlay, closeDonateModal);

    overlay.querySelector('#scast-donate-close').addEventListener('click', closeDonateModal);
    overlay.querySelector('#scast-donate-copy').addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(DONATE_USDT_ADDRESS);
            announce('Address copied to clipboard');
        } catch (e) {
            announce('Could not copy — please select the address manually');
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && overlay.classList.contains('visible')) closeDonateModal();
    });
}

function closeDonateModal() {
    document.getElementById('scast-donate-overlay')?.classList.remove('visible');
}

export function openDonateModal() {
    mountDonateModal();
    document.getElementById('scast-donate-overlay').classList.add('visible');

    const state = loadConfig();
    if (!state.heartLiked) {
        state.heartLiked = true;
        persistConfig();
        refreshAllHeartButtons();
    }
}

const heartButtons = new Set();

function syncHeartButton(el) {
    const state = loadConfig();
    el.classList.toggle('liked', !!state.heartLiked);
    el.title = state.heartLiked ? 'Glad you like it! ♥' : 'Enjoying SceneCast?';
}

function refreshAllHeartButtons() {
    for (const el of heartButtons) {
        if (!document.body.contains(el)) {
            heartButtons.delete(el);
            continue;
        }
        syncHeartButton(el);
    }
}

export function createHeartButton() {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'scast-heart-btn';
    btn.innerHTML = '<i class="fa-solid fa-heart"></i>';
    btn.addEventListener('click', (e) => { e.stopPropagation(); openDonateModal(); });
    heartButtons.add(btn);
    syncHeartButton(btn);
    return btn;
}

export function _getHeartButtonCountForTests() {
    return heartButtons.size;
}
