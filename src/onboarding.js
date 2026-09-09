import { toSafeMarkup, attachOutsideClickToClose } from './utils.js';
import { loadConfig, persistConfig, STAGE_MODES, STAGE_EFFECTS, EXIT_STYLES } from './config.js';
import { EXIT_KEYFRAMES, EXIT_DURATIONS } from './stage.js';
import { openDonateModal } from './donate.js';

const EXAMPLE1_URL = new URL('../assets/images/example1.png', import.meta.url).href;
const EXAMPLE2_URL = new URL('../assets/images/example2.png', import.meta.url).href;

const STEP_META = [
    { key: 'start', label: 'Overview', icon: 'fa-clapperboard' },
    { key: 'profiles', label: 'Profiles', icon: 'fa-diagram-project' },
    { key: 'addcast', label: 'Cast & Files', icon: 'fa-user-plus' },
    { key: 'triggers', label: 'AI Triggers', icon: 'fa-bullseye' },
    { key: 'stage', label: 'Stage Design', icon: 'fa-palette' },
    { key: 'support', label: 'Support', icon: 'fa-heart' },
];

const TOTAL_STEPS = STEP_META.length;

let currentStep = 0;
let activeUnmount = null;

function buildDemoCard({ name, tag = '', span = 'full', image }) {
    return `
        <div class="scast-card" data-tile-span="${span}" data-crop-fit="smart" data-is-fresh="true" data-held="false">
            <img class="scast-card-bg" src="${image}" alt="" />
            <img class="scast-card-fg" src="${image}" alt="" />
            <div class="scast-fx-overlay"></div>
            <div class="scast-card-info">
                <span class="scast-name">${toSafeMarkup(name)}</span>
                ${tag ? `<span class="scast-tag">${toSafeMarkup(tag)}</span>` : ''}
            </div>
        </div>`;
}

function renderDemoStage({ mode, containerClass, tileCount, cards, hue = 0, scale = 1, fx = 'none', sideId = '' }) {
    const cardsHtml = cards.map(buildDemoCard).join('');
    return `
        <div class="scast-guide-demo-outer" data-stage-mode="${mode}" data-stage-fx="${fx}" data-reduce-motion="false" style="--scast-hue-deg: ${hue}deg; --scast-card-scale: ${scale};">
            <div class="${containerClass} scast-stage" id="${sideId}" data-tile-count="${tileCount}">
                ${cardsHtml}
            </div>
        </div>`;
}

function playCardEntrance(card, delay = 0) {
    try {
        card.animate(
            [{ opacity: 0, transform: 'scale(0.85)' }, { opacity: 1, transform: 'scale(1)' }],
            { duration: 300, delay, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)', fill: 'backwards' },
        );
    } catch (e) {}
}

function playCardExit(card, exitStyle, side) {
    try {
        const kind = EXIT_KEYFRAMES[exitStyle] ? exitStyle : 'fade';
        const duration = EXIT_DURATIONS[kind] || 220;
        card.animate(EXIT_KEYFRAMES[kind](side), { duration, easing: 'ease', fill: 'forwards' });
    } catch (e) {}
}

function renderStart(container) {
    container.innerHTML = `
        <h3>Welcome to SceneCast</h3>
        <p class="scast-guide-sub">SceneCast brings your roleplay to life by displaying character portraits dynamically. It listens to the AI's responses and summons a character's card the moment they are mentioned.</p>

        <div class="scast-guide-hero-layout">
            <div class="scast-guide-hero-side" id="hero-left-stage"></div>
            <div class="scast-guide-hero-center">
                <div class="scast-guide-mock-chat">
                    <i class="fa-solid fa-robot scast-mr" style="opacity:0.5;"></i>
                    The tavern door swung open. <mark>Elara</mark> stepped inside, shaking the rain from her cloak, followed closely by <mark>Kael</mark> who was already scanning the room for trouble.
                </div>
                <button id="scast-guide-demo-replay" class="menu_button">
                    <i class="fa-solid fa-rotate-right scast-mr"></i>Replay Entrance
                </button>
            </div>
            <div class="scast-guide-hero-side" id="hero-right-stage"></div>
        </div>

        <p class="scast-guide-sub" style="margin-top:16px;">To make this magic happen, you only need two things: properly named <b>image files</b> and a <b>Profile</b> linked to your chat. Let's walk through it.</p>
    `;

    const leftStage = container.querySelector('#hero-left-stage');
    const rightStage = container.querySelector('#hero-right-stage');

    function paint() {
        leftStage.innerHTML = renderDemoStage({
            mode: 'bento-fit', containerClass: 'scast-guide-demo-stage', tileCount: 1, sideId: 'scast-stage-left',
            cards: [{ name: 'Elara', image: EXAMPLE1_URL }]
        });
        rightStage.innerHTML = renderDemoStage({
            mode: 'bento-fit', containerClass: 'scast-guide-demo-stage', tileCount: 1, sideId: 'scast-stage-right',
            cards: [{ name: 'Kael', image: EXAMPLE2_URL }]
        });

        const leftCard = leftStage.querySelector('.scast-card');
        const rightCard = rightStage.querySelector('.scast-card');
        if (leftCard) playCardEntrance(leftCard, 0);
        if (rightCard) playCardEntrance(rightCard, 300);
    }

    container.querySelector('#scast-guide-demo-replay').addEventListener('click', paint);
    paint();
}

const BIND_SCENARIOS = {
    oneone: {
        label: '1 Profile → 1 Character',
        html: `
            <div class="scast-guide-diagram-col"><div class="scast-guide-diagram-box">📁 Profile: "Cyberpunk City"</div></div>
            <div class="scast-guide-diagram-arrow">↔</div>
            <div class="scast-guide-diagram-col"><div class="scast-guide-diagram-box">🧑 Card: "Neon Hacker"</div></div>
        `,
        text: 'The most common setup: one unique cast profile linked to a single character card. The actors in this setting stay isolated from your other roleplays.',
    },
    onemany: {
        label: '1 Profile → Many Characters',
        html: `
            <div class="scast-guide-diagram-col"><div class="scast-guide-diagram-box">📁 Profile: "Fantasy Guild"</div></div>
            <div class="scast-guide-diagram-arrow">↔</div>
            <div class="scast-guide-diagram-col">
                <div class="scast-guide-diagram-box">🧑 Card: "Guild Master"</div>
                <div class="scast-guide-diagram-box">🧑 Card: "Elven Archer"</div>
            </div>
        `,
        text: 'You can bind the same profile to multiple cards. Perfect if you have several distinct character cards that exist in the exact same universe and share the same pool of side characters.',
    },
    manyone: {
        label: 'Many Profiles → 1 Character',
        html: `
            <div class="scast-guide-diagram-col">
                <div class="scast-guide-diagram-box">📁 Profile: "Story Arc 1"</div>
                <div class="scast-guide-diagram-box">📁 Profile: "Story Arc 2"</div>
            </div>
            <div class="scast-guide-diagram-arrow">↔</div>
            <div class="scast-guide-diagram-col"><div class="scast-guide-diagram-box">🧑 Card: "Hero's party"</div></div>
        `,
        text: 'You can even bind multiple profiles to a single card. SceneCast will merge the casts together on stage — great for organizing huge stories into manageable folders.',
    },
};

function renderProfiles(container) {
    container.innerHTML = `
        <h3>Cast Profiles</h3>
        <p class="scast-guide-sub">A Profile is a container for a specific group of actors (images and triggers). In SillyTavern, you might play in a Sci-Fi universe today and a Fantasy RPG tomorrow. Profiles keep these casts separate so elves don't accidentally wander into your spaceship.</p>

        <label class="scast-guide-control-label" style="display:block;margin-top:14px;">Common Setups</label>
        <div class="scast-guide-chip-row" id="scast-guide-bind-chips"></div>

        <div class="scast-guide-diagram" id="scast-guide-bind-diagram"></div>
        <p class="scast-guide-note" id="scast-guide-bind-explain"></p>

        <ul class="scast-guide-bullets">
            <li>You manage links using the <b>"Bind"</b> button at the top of the Cast Manager panel.</li>
            <li>If a chat has no linked profile, SceneCast uses the <b>Default</b> profile as a fallback.</li>
        </ul>
    `;

    const chipsEl = container.querySelector('#scast-guide-bind-chips');
    const diagram = container.querySelector('#scast-guide-bind-diagram');
    const explain = container.querySelector('#scast-guide-bind-explain');

    chipsEl.innerHTML = Object.entries(BIND_SCENARIOS).map(([key, s]) => `
        <button class="scast-guide-chip" data-bind="${key}">${toSafeMarkup(s.label)}</button>
    `).join('');

    function setScenario(key) {
        const s = BIND_SCENARIOS[key];
        diagram.innerHTML = s.html;
        explain.textContent = s.text;
        chipsEl.querySelectorAll('.scast-guide-chip').forEach(c => {
            c.dataset.active = String(c.dataset.bind === key);
        });
    }

    chipsEl.querySelectorAll('.scast-guide-chip').forEach(chip => {
        chip.addEventListener('click', () => setScenario(chip.dataset.bind));
    });

    setScenario('oneone');
}

const NAMING_FILES = [
    { name: 'Elara.png', explain: '<b>Elara.png</b> — The main portrait. Trigger word automatically set to "Elara".' },
    { name: 'Elara_smiling.png', explain: '<b>Elara_smiling.png</b> — If the character "Elara" does not exist, it will be created with a variant named "smiling". If "Elara" already exists, the "smiling" variant will simply be added to that character.' },
    { name: 'Elara+Kael.png', explain: '<b>Elara+Kael.png</b> — Group portrait. Appears if <i>either</i> Elara OR Kael is mentioned.' },
    { name: 'Kael-Battle.png', explain: '<b>Kael-Battle.png</b> — Without an underscore, this creates a completely separate character named "Kael-Battle", not a variant.', warn: true },
];

function renderAddCast(container) {
    container.innerHTML = `
        <h3>Adding Characters</h3>
        <p class="scast-guide-sub">SceneCast gives you three flexible ways to populate your cast:</p>
        <div class="scast-guide-cards-row">
            <div class="scast-guide-mini-card">
                <i class="fa-solid fa-folder-tree"></i>
                <b>Folder Import</b>
                <p>Select a local folder. SceneCast reads the filenames and automatically builds characters, variants, and trigger lists for you.</p>
            </div>
            <div class="scast-guide-mini-card">
                <i class="fa-solid fa-hand-pointer"></i>
                <b>Drag & Drop</b>
                <p>Drag images straight into the Cast Manager. Existing names are safely updated with new variants, new names create fresh characters.</p>
            </div>
            <div class="scast-guide-mini-card">
                <i class="fa-solid fa-plus"></i>
                <b>Manual Add</b>
                <p>Click "Add" to create a blank character card, then configure triggers and upload images by clicking the preview.</p>
            </div>
        </div>

        <h3 style="margin-top:20px;">Filename Rules for Auto-Import</h3>
        <p class="scast-guide-sub">Hover over the examples below to see how SceneCast understands your files:</p>

        <div class="scast-guide-folder" id="scast-guide-folder-demo">
            <div class="scast-guide-folder-title"><i class="fa-solid fa-folder-open"></i> user/images-for-my-character/</div>
            <div class="scast-guide-folder-rows"></div>
        </div>
        <div class="scast-guide-file-explain" id="scast-guide-file-explain">Hover over a file above ↑</div>

        <ul class="scast-guide-rules">
            <li><i class="fa-solid fa-check" style="color:#4CAF50;"></i> Everything before the <b>first</b> <code>_</code> is the character name and trigger word.</li>
            <li><i class="fa-solid fa-check" style="color:#4CAF50;"></i> Everything after <code>_</code> becomes the variant label.</li>
            <li><i class="fa-solid fa-check" style="color:#4CAF50;"></i> A <code>+</code> sign splits names for group portraits.</li>
        </ul>
    `;

    const rowsEl = container.querySelector('.scast-guide-folder-rows');
    const explainEl = container.querySelector('#scast-guide-file-explain');

    rowsEl.innerHTML = NAMING_FILES.map((f, i) => `
        <div class="scast-guide-file-row" data-idx="${i}">
            <i class="fa-solid ${f.warn ? 'fa-triangle-exclamation' : 'fa-file-image'}" ${f.warn ? 'style="color:#ffb300;"' : ''}></i>
            <span>${toSafeMarkup(f.name)}</span>
        </div>
    `).join('');

    rowsEl.querySelectorAll('.scast-guide-file-row').forEach(row => {
        const show = () => { explainEl.innerHTML = NAMING_FILES[row.dataset.idx].explain; };
        row.addEventListener('mouseenter', show);
        row.addEventListener('click', show);
    });
}

function renderTriggers(container) {
    container.innerHTML = `
        <h3>How Characters Are Summoned</h3>
        <p class="scast-guide-sub">SceneCast scans the <b>AI's replies</b> for your specified trigger words. It does not react to your own user prompts, ensuring the stage reflects the AI's narrative focus.</p>

        <div class="scast-guide-anatomy-wrap">
            <div class="scast-guide-anatomy-chat">
                <i class="fa-solid fa-robot"></i>
                "Wait up!" <mark class="match-good">Elara</mark> shouted, running down the hall. 
                She almost crashed into <mark class="match-bad">Elara's clone</mark> standing by the door.
            </div>

            <div class="scast-guide-anatomy-grid">
                <div class="scast-anatomy-card">
                    <div class="scast-anatomy-title"><i class="fa-solid fa-crosshairs"></i> Trigger Words</div>
                    <p>Comma-separated list of names. If the AI types <b>Elara</b>, her card slides in.</p>
                </div>
                <div class="scast-anatomy-card">
                    <div class="scast-anatomy-title"><i class="fa-solid fa-shield-halved"></i> Suppress Terms</div>
                    <p>Blocks the trigger. E.g., setting <b>Elara's clone</b> as a suppress term prevents the original Elara from appearing here.</p>
                </div>
                <div class="scast-anatomy-card">
                    <div class="scast-anatomy-title"><i class="fa-solid fa-hashtag"></i> Mentions Needed</div>
                    <p>Require the trigger to appear 2 or 3 times in a single reply before summoning the card to avoid brief cameos.</p>
                </div>
            </div>
        </div>

        <p class="scast-guide-note" style="margin-top:16px;">
            <b>Tip:</b> Use the Cast Manager's built-in "Test triggers" text box to verify your complex Regex or Suppress terms before jumping into roleplay.
        </p>
    `;
}

function renderStage(container) {
    const state = loadConfig();
    
    const filteredModes = STAGE_MODES.filter(m => m.value !== 'accordion');

    container.innerHTML = `
        <h3>Designing Your Stage</h3>
        <p class="scast-guide-sub">Global visual settings let you theme the stage to fit your UI. Adjust the controls below to preview them live:</p>

        <div class="scast-guide-visual-layout">
            <div class="scast-guide-visual-controls scast-guide-panel-theme">
                <label class="scast-guide-control-label">Stage Layout</label>
                <select id="guide-mode-sel" class="text_pole">
                    ${filteredModes.map(m => `<option value="${m.value}">${toSafeMarkup(m.label.replace(/^\d+\.\s*/, ''))}</option>`).join('')}
                </select>

                <label class="scast-guide-control-label" style="margin-top:10px;">Visual Effect</label>
                <select id="guide-fx-sel" class="text_pole">
                    ${STAGE_EFFECTS.map(f => `<option value="${f.value}">${toSafeMarkup(f.label)}</option>`).join('')}
                </select>

                <label class="scast-guide-control-label" style="margin-top:10px;">Exit Animation</label>
                <select id="guide-exit-sel" class="text_pole">
                    ${EXIT_STYLES.map(m => `<option value="${m.value}">${toSafeMarkup(m.label)}</option>`).join('')}
                </select>
                
                <button id="guide-play-exit" class="menu_button" style="margin-top:8px;"><i class="fa-solid fa-play scast-mr"></i>Preview Animation</button>

                <div style="margin-top:15px;">
                    <label class="scast-guide-control-label">
                        Hue Shift
                        <input type="range" id="guide-hue-sel" min="0" max="360" value="${state.accentHueShift || 0}" style="width:100%;" />
                    </label>
                </div>
            </div>
            
            <div class="scast-guide-preview-col">
                <div id="scast-guide-visual-stage-wrap"></div>
                <div class="scast-guide-preview-actions">
                    <p class="scast-guide-preview-note"><i class="fa-solid fa-circle-info"></i> Note: In an actual chat, the size and scale of cards may vary depending on your UI. It is recommended to fine-tune the scale and effects to your liking directly in the settings during roleplay!</p>
                </div>
            </div>
        </div>

        <div class="scast-guide-tips-grid">
            <div class="scast-guide-tip-card">
                <i class="fa-solid fa-clock"></i>
                <b>Auto-Dismissal</b>
                <p>Cards automatically leave based on either real-world seconds or AI reply counts. Configure this in Cast Manager.</p>
            </div>
            <div class="scast-guide-tip-card">
                <i class="fa-solid fa-thumbtack"></i>
                <b>Pinning</b>
                <p>Click the pin icon on any active card to hold it on stage permanently until manually released.</p>
            </div>
            <div class="scast-guide-tip-card">
                <i class="fa-solid fa-clock-rotate-left"></i>
                <b>Scroll Sync</b>
                <p>Scroll up in your chat history, and the stage will magically rewind to show who was present at that specific moment.</p>
            </div>
        </div>
    `;

    const stageWrap = container.querySelector('#scast-guide-visual-stage-wrap');
    const modeSel = container.querySelector('#guide-mode-sel');
    const fxSel = container.querySelector('#guide-fx-sel');
    const exitSel = container.querySelector('#guide-exit-sel');
    const hueSel = container.querySelector('#guide-hue-sel');
    const playExitBtn = container.querySelector('#guide-play-exit');

    function paintDemo() {
        stageWrap.innerHTML = renderDemoStage({
            mode: modeSel.value,
            containerClass: 'scast-guide-visual-stage',
            tileCount: 1, 
            sideId: 'scast-stage-right',
            hue: hueSel.value,
            scale: 1,
            fx: fxSel.value,
            cards: [
                { name: 'Elara', tag: 'default', image: EXAMPLE1_URL, span: 'full' }
            ],
        });
        stageWrap.querySelectorAll('.scast-card').forEach((card, i) => playCardEntrance(card, i * 120));
    }

    modeSel.value = (state.stageMode === 'accordion') ? 'bento-fit' : (state.stageMode || 'bento-fit');
    fxSel.value = state.stageFx || 'none';
    exitSel.value = state.exitAnim || 'fade';

    modeSel.addEventListener('change', paintDemo);
    fxSel.addEventListener('change', paintDemo);
    hueSel.addEventListener('input', () => {
        const outer = stageWrap.querySelector('.scast-guide-demo-outer');
        if (outer) outer.style.setProperty('--scast-hue-deg', `${hueSel.value}deg`);
    });

    playExitBtn.addEventListener('click', () => {
        const card = stageWrap.querySelector('.scast-card');
        if (!card) return;
        card.getAnimations().forEach(a => a.cancel());
        playCardExit(card, exitSel.value, 'right');
        setTimeout(() => {
            if (stageWrap.contains(card)) {
                card.getAnimations().forEach(a => a.cancel());
                playCardEntrance(card);
            }
        }, EXIT_DURATIONS[exitSel.value] + 300);
    });

    paintDemo();
}

function renderSupport(container) {
    container.innerHTML = `
        <div class="scast-guide-donate">
            <div class="scast-donate-heart"><i class="fa-solid fa-heart"></i></div>
            <h3 class="scast-donate-title">Made With Care</h3>
<p class="scast-donate-text">A lot of hours went into what you just saw. Go try it in an actual chat first — the support button will be waiting in settings whenever you're ready to say thanks.</p>
            <button id="scast-guide-donate-open" class="menu_button"><i class="fa-solid fa-heart scast-mr"></i>See Support Options</button>
            <button id="scast-guide-finish" class="menu_button scast-guide-finish-btn"><i class="fa-solid fa-circle-check scast-mr"></i>I'm ready, let's go!</button>
        </div>
    `;
    container.querySelector('#scast-guide-donate-open').addEventListener('click', () => openDonateModal(false));
    container.querySelector('#scast-guide-finish').addEventListener('click', closeOnboardingGuide);
}

const STEP_RENDERERS = [
    renderStart, renderProfiles, renderAddCast,
    renderTriggers, renderStage, renderSupport,
];

function buildStepperMarkup() {
    return STEP_META.map((s, i) => `
        <div class="scast-guide-step-item" data-step="${i}">
            <i class="fa-solid ${s.icon}"></i>
            <span>${toSafeMarkup(s.label)}</span>
            <span class="scast-guide-step-num">${i + 1}/${TOTAL_STEPS}</span>
        </div>`).join('');
}

function buildDotsMarkup() {
    return STEP_META.map((_, i) => `<div class="scast-guide-dot" data-step="${i}"></div>`).join('');
}

export function mountOnboardingGuide() {
    if (document.getElementById('scast-guide-overlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'scast-guide-overlay';
    overlay.innerHTML = `
        <div id="scast-guide-panel">
            <div id="scast-guide-header">
                <b><i class="fa-solid fa-clapperboard"></i> SceneCast Guide</b>
                <button id="scast-guide-close" title="Close"><i class="fa-solid fa-xmark"></i></button>
            </div>
            <div id="scast-guide-body">
                <div id="scast-guide-stepper">${buildStepperMarkup()}</div>
                <div id="scast-guide-content"></div>
            </div>
            <div id="scast-guide-footer">
                <div id="scast-guide-dots">${buildDotsMarkup()}</div>
                <div class="scast-guide-nav-btns">
                    <button id="scast-guide-back" class="menu_button"><i class="fa-solid fa-chevron-left scast-mr"></i>Back</button>
                    <button id="scast-guide-next" class="menu_button">Next<i class="fa-solid fa-chevron-right" style="margin-left:5px;"></i></button>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);

    overlay.querySelector('#scast-guide-close').addEventListener('click', closeOnboardingGuide);
    attachOutsideClickToClose(overlay, closeOnboardingGuide);

    overlay.querySelector('#scast-guide-stepper').addEventListener('click', (e) => {
        const item = e.target.closest('.scast-guide-step-item');
        if (item) setStep(parseInt(item.dataset.step, 10));
    });
    overlay.querySelector('#scast-guide-dots').addEventListener('click', (e) => {
        const dot = e.target.closest('.scast-guide-dot');
        if (dot) setStep(parseInt(dot.dataset.step, 10));
    });
    overlay.querySelector('#scast-guide-back').addEventListener('click', () => setStep(currentStep - 1));
    overlay.querySelector('#scast-guide-next').addEventListener('click', () => setStep(currentStep + 1));

    document.addEventListener('keydown', (e) => {
        if (!overlay.classList.contains('visible')) return;
        if (e.key === 'Escape') closeOnboardingGuide();
        if (e.key === 'ArrowRight') setStep(currentStep + 1);
        if (e.key === 'ArrowLeft') setStep(currentStep - 1);
    });
}

function setStep(step) {
    if (step < 0 || step >= TOTAL_STEPS) return;
    currentStep = step;

    if (activeUnmount) { activeUnmount(); activeUnmount = null; }

    const content = document.getElementById('scast-guide-content');
    if (!content) return;
    const result = STEP_RENDERERS[currentStep](content);
    if (result && typeof result.unmount === 'function') activeUnmount = result.unmount;

    document.querySelectorAll('.scast-guide-step-item').forEach((el, i) => {
        el.dataset.active = i === currentStep ? 'true' : 'false';
    });
    document.querySelectorAll('.scast-guide-dot').forEach((el, i) => {
        el.dataset.active = i === currentStep ? 'true' : 'false';
    });

    const backBtn = document.getElementById('scast-guide-back');
    const nextBtn = document.getElementById('scast-guide-next');
    backBtn.style.visibility = currentStep === 0 ? 'hidden' : 'visible';
    nextBtn.style.display = currentStep === TOTAL_STEPS - 1 ? 'none' : 'inline-flex';

    content.scrollTop = 0;
}

export function openOnboardingGuide() {
    mountOnboardingGuide();
    document.getElementById('scast-guide-overlay').classList.add('visible');
    setStep(0);
}

export function closeOnboardingGuide() {
    if (activeUnmount) { activeUnmount(); activeUnmount = null; }
    document.getElementById('scast-guide-overlay')?.classList.remove('visible');

    const state = loadConfig();
    if (!state.hasSeenGuide) {
        state.hasSeenGuide = true;
        persistConfig();
    }
}