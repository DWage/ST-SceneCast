import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { installMockContext } from './helpers/mockContext.js';

// ui.js has module-level private state (panelViewingProfileId, panelSelectedIdx,
// panelSearchQuery) that only resets via a fresh module instance, so — same as
// every other suite in this repo — every test gets vi.resetModules() + a fresh
// mock SillyTavern context.
async function freshUi(contextOverrides) {
    vi.resetModules();
    const ctx = installMockContext(contextOverrides);
    const config = await import('../src/config.js');
    const stage = await import('../src/stage.js');
    const timeline = await import('../src/timeline.js');
    const ui = await import('../src/ui.js');
    return { config, stage, timeline, ui, ctx };
}

function q(sel) { return document.querySelector(sel); }
function qa(sel) { return Array.from(document.querySelectorAll(sel)); }

function click(el) {
    if (!el) throw new Error('click(): element is null');
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
}

function setValue(el, value) {
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
}

function setValueChange(el, value) {
    el.value = value;
    el.dispatchEvent(new Event('change', { bubbles: true }));
}

// Flush a handful of microtask ticks — enough to let a chain of `await`s
// inside an async click handler (themedConfirm/Prompt -> continuation ->
// possibly another awaited fetch) actually run before we assert on the result.
async function flush(times = 5) {
    for (let i = 0; i < times; i++) await Promise.resolve();
}

// themedConfirm/Alert/Prompt AND the Image Manager panel both use the
// ".scast-subpanel-overlay" class, so a plain class selector can grab the
// wrong overlay when the Image Manager is open behind a dialog. Disambiguate
// by requiring one of the dialog-specific control ids.
function findDialogOverlay() {
    return qa('.scast-subpanel-overlay').find(
        (o) => o.querySelector('#scast-dlg-ok, #scast-dlg-cancel, #scast-dlg-input'),
    );
}

async function confirmDialog(accept = true) {
    await flush();
    const overlay = findDialogOverlay();
    if (!overlay) throw new Error('confirmDialog(): no dialog overlay found');
    const btn = accept ? overlay.querySelector('#scast-dlg-ok') : overlay.querySelector('#scast-dlg-cancel');
    btn.click();
    await flush();
}

async function promptDialog(value) {
    await flush();
    const overlay = findDialogOverlay();
    if (!overlay) throw new Error('promptDialog(): no dialog overlay found');
    if (value === null) {
        overlay.querySelector('#scast-dlg-cancel').click();
    } else {
        overlay.querySelector('#scast-dlg-input').value = value;
        overlay.querySelector('#scast-dlg-ok').click();
    }
    await flush();
}

beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ path: 'user/images/scenecast/uploaded.png' }),
    });
});

// ---------------------------------------------------------------------
// mountDirectorPanel / openDirectorPanel
// ---------------------------------------------------------------------

describe('mountDirectorPanel / openDirectorPanel', () => {
    it('mounts the overlay only once even if called repeatedly', async () => {
        const { ui } = await freshUi();
        ui.mountDirectorPanel();
        ui.mountDirectorPanel();
        expect(document.querySelectorAll('#scast-panel-overlay').length).toBe(1);
    });

    it('every open resets the selected cast member and the settings tab back to "visuals"', async () => {
        const { config, ui } = await freshUi();
        config.getProfileCast('prof_default').push({ triggers: 'Alice', displayName: 'Alice', portrait: '', variants: [] });
        ui.openDirectorPanel();

        click(q('.scast-roster-tile'));
        click(q('.scast-tab-btn[data-tab="logic"]'));
        expect(q('#scast-tab-logic').classList.contains('active')).toBe(true);
        expect(q('#scast-ed-name')).not.toBeNull();

        q('#scast-panel-close').click();
        ui.openDirectorPanel();

        expect(q('#scast-tab-visuals').classList.contains('active')).toBe(true);
        expect(q('.scast-roster-tile[data-selected="true"]')).toBeNull();
        expect(q('#scast-editor-pane').textContent).toContain('Select a cast member');
    });
});

// ---------------------------------------------------------------------
// Profile bar: bind / unbind
// ---------------------------------------------------------------------

describe('profile bar: bind/unbind', () => {
    it('shows "No character/group detected" and disables Bind with no character context', async () => {
        const { ui } = await freshUi();
        ui.openDirectorPanel();
        expect(q('#scast-profile-binding-note').textContent).toContain('No character/group detected');
        expect(q('#scast-profile-bind').disabled).toBe(true);
    });

    it('binds the VIEWED profile, not necessarily the active one', async () => {
        const { config, ui } = await freshUi({
            characterId: 0,
            characters: [{ avatar: 'a.png', name: 'Alice Char' }],
        });
        ui.openDirectorPanel();

        click(q('#scast-profile-new'));
        await promptDialog('World B');
        expect(q('#scast-profile-select').selectedOptions[0].textContent).toContain('World B');

        click(q('#scast-profile-bind'));

        const binding = config.getCurrentBinding();
        expect(binding.profileIds.length).toBe(1);
        const boundName = config.listProfiles().find((p) => p.id === binding.profileIds[0]).name;
        expect(boundName).toBe('World B');
    });

    it('clicking Bind again unbinds (toggle), and the label reflects the current state', async () => {
        const { config, ui } = await freshUi({
            characterId: 0,
            characters: [{ avatar: 'a.png', name: 'Alice Char' }],
        });
        ui.openDirectorPanel();

        click(q('#scast-profile-bind'));
        expect(q('#scast-profile-bind').innerHTML).toContain('Unbind');
        expect(config.getCurrentBinding().isBound).toBe(true);

        click(q('#scast-profile-bind'));
        expect(config.getCurrentBinding().isBound).toBe(false);
    });
});

// ---------------------------------------------------------------------
// Profile CRUD
// ---------------------------------------------------------------------

describe('profile CRUD via UI', () => {
    it('blocks deleting the last remaining profile with a plain alert (no Cancel button)', async () => {
        const { config, ui } = await freshUi();
        ui.openDirectorPanel();
        click(q('#scast-profile-delete'));

        await flush();
        const overlay = findDialogOverlay();
        expect(overlay.querySelector('#scast-dlg-cancel')).toBeNull();
        await confirmDialog(true);

        expect(config.listProfiles().length).toBe(1);
    });

    it('deletes a profile after confirmation, cleans up its images, and only resets the stage if it was the active profile', async () => {
        const { config, stage, ui } = await freshUi();
        const idB = config.createProfile('World B');
        config.getProfileCast(idB).push({ triggers: 'Zoe', portrait: 'user/images/scenecast/zoe.png', variants: [] });

        ui.openDirectorPanel();
        setValueChange(q('#scast-profile-select'), idB);

        const resetSpy = vi.spyOn(stage, 'resetStage');
        click(q('#scast-profile-delete'));
        await confirmDialog(true);

        expect(config.listProfiles().find((p) => p.id === idB)).toBeUndefined();
        expect(global.fetch).toHaveBeenCalled(); // Zoe's portrait deletion attempted
        expect(resetSpy).not.toHaveBeenCalled(); // World B was never the active profile
    });

    it('resets the stage when the DELETED profile was the active one', async () => {
        const { stage, ui } = await freshUi();
        const resetSpy = vi.spyOn(stage, 'resetStage');
        const config = await import('../src/config.js');
        config.createProfile('World B');

        ui.openDirectorPanel(); // viewing prof_default, which IS active
        click(q('#scast-profile-delete'));
        await confirmDialog(true);

        expect(resetSpy).toHaveBeenCalled();
    });

    it('duplicates a profile (viewing switches to the duplicate) then renames the duplicate, not the original', async () => {
        const { config, ui } = await freshUi();
        config.getProfileCast('prof_default').push({ triggers: 'Alice', portrait: '', variants: [] });
        ui.openDirectorPanel();

        click(q('#scast-profile-dup'));
        expect(config.listProfiles().length).toBe(2);
        const dupId = config.listProfiles().find((p) => p.id !== 'prof_default').id;
        expect(q('#scast-profile-select').value).toBe(dupId);

        click(q('#scast-profile-rename'));
        await promptDialog('Renamed World');

        expect(config.listProfiles().find((p) => p.id === dupId).name).toBe('Renamed World');
        expect(config.listProfiles().find((p) => p.id === 'prof_default').name).toBe('Default');
    });
});

// ---------------------------------------------------------------------
// Roster grid
// ---------------------------------------------------------------------

describe('roster grid', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('filters tiles by display name or trigger term via debounced search', async () => {
        const { config, ui } = await freshUi();
        config.getProfileCast('prof_default').push(
            { triggers: 'Alice, Aly', displayName: 'Alice', portrait: '', variants: [], active: true },
            { triggers: 'Bob', displayName: 'Bob', portrait: '', variants: [], active: true },
        );
        ui.openDirectorPanel();
        expect(qa('.scast-roster-tile').length).toBe(2);

        setValue(q('#scast-roster-search'), 'aly');
        vi.advanceTimersByTime(200);

        expect(qa('.scast-roster-tile').length).toBe(1);
        expect(q('.scast-roster-tile-name').textContent).toBe('Alice');
    });

    it('shows distinct empty-state text for "no matches" vs. a genuinely empty roster', async () => {
        const { config, ui } = await freshUi();
        ui.openDirectorPanel();
        expect(q('.scast-empty-note').textContent).toContain('No cast members yet');

        config.getProfileCast('prof_default').push({ triggers: 'Alice', displayName: 'Alice', portrait: '', variants: [] });
        ui.openDirectorPanel();

        setValue(q('#scast-roster-search'), 'zzz-no-match');
        vi.advanceTimersByTime(200);
        expect(q('.scast-empty-note').textContent).toContain('No cast members match your search');
    });
});

describe('roster grid: toggle / delete', () => {
    it('toggling active off also evicts the member from activeCast if it was on stage', async () => {
        const { config, stage, ui } = await freshUi();
        config.getProfileCast('prof_default').push({ triggers: 'Alice', displayName: 'Alice', portrait: 'a.png', variants: [], active: true });
        ui.openDirectorPanel();
        stage.activeCast.set(0, { castIdx: 0, artIdx: 0, missCounter: 0, held: false, lastSeenAt: Date.now() });

        click(q('.scast-roster-tile-toggle'));

        expect(config.getProfileCast('prof_default')[0].active).toBe(false);
        expect(stage.activeCast.has(0)).toBe(false);
    });

    it('deletes a cast member after confirmation and attempts to clean up its portrait', async () => {
        const { config, ui } = await freshUi();
        config.getProfileCast('prof_default').push({ triggers: 'Alice', displayName: 'Alice', portrait: 'user/images/scenecast/alice.png', variants: [] });
        ui.openDirectorPanel();

        click(q('.scast-roster-tile-delete'));
        await confirmDialog(true);

        expect(config.getProfileCast('prof_default').length).toBe(0);
        expect(global.fetch).toHaveBeenCalled();
    });

    it('cancelling the delete confirmation keeps the member untouched', async () => {
        const { config, ui } = await freshUi();
        config.getProfileCast('prof_default').push({ triggers: 'Alice', displayName: 'Alice', portrait: '', variants: [] });
        ui.openDirectorPanel();

        click(q('.scast-roster-tile-delete'));
        await confirmDialog(false);

        expect(config.getProfileCast('prof_default').length).toBe(1);
    });
});

describe('Clear All', () => {
    it('collects every portrait/variant path BEFORE clearing the array, then deletes each one afterward', async () => {
        const { config, ui } = await freshUi();
        config.getProfileCast('prof_default').push({
            triggers: 'Alice',
            portrait: 'user/images/scenecast/alice.png',
            variants: [{ tag: 'v', label: 'v', portrait: 'user/images/scenecast/alice-v.png' }],
        });
        ui.openDirectorPanel();

        click(q('#scast-roster-clear-all'));
        await confirmDialog(true);

        expect(config.getProfileCast('prof_default').length).toBe(0);
        expect(global.fetch).toHaveBeenCalledTimes(2); // main portrait + the one variant
    });

    it('shows a plain alert (not a confirm) when the roster is already empty', async () => {
        const { ui } = await freshUi();
        ui.openDirectorPanel();
        click(q('#scast-roster-clear-all'));

        await flush();
        const overlay = findDialogOverlay();
        expect(overlay.querySelector('#scast-dlg-cancel')).toBeNull();
        await confirmDialog(true);
    });
});

// ---------------------------------------------------------------------
// Editor pane: name <-> triggers linking state machine
// ---------------------------------------------------------------------

describe('editor pane: name<->triggers linking', () => {
    it('typing triggers on a brand-new (empty) member mirrors into name — until name is edited directly, after which triggers no longer overwrites it', async () => {
        const { ui } = await freshUi();
        ui.openDirectorPanel();
        click(q('#scast-roster-add'));

        setValue(q('#scast-ed-triggers'), 'Alice');
        expect(q('#scast-ed-name').value).toBe('Alice');

        setValue(q('#scast-ed-name'), 'Alice Custom');
        setValue(q('#scast-ed-triggers'), 'Alice2');
        expect(q('#scast-ed-name').value).toBe('Alice Custom'); // untouched by the later triggers edit
    });

    it('typing name first mirrors into triggers — until triggers is edited directly, after which name no longer overwrites it', async () => {
        const { ui } = await freshUi();
        ui.openDirectorPanel();
        click(q('#scast-roster-add'));

        setValue(q('#scast-ed-name'), 'Bob');
        expect(q('#scast-ed-triggers').value).toBe('Bob');

        setValue(q('#scast-ed-triggers'), 'Bob, Bobby');
        setValue(q('#scast-ed-name'), 'Bob Renamed');
        expect(q('#scast-ed-triggers').value).toBe('Bob, Bobby'); // untouched
    });

    it('an existing member with BOTH fields already filled starts unlinked — editing one never touches the other', async () => {
        const { config, ui } = await freshUi();
        config.getProfileCast('prof_default').push({ triggers: 'Alice, Aly', displayName: 'Alice', portrait: '', variants: [] });
        ui.openDirectorPanel();
        click(q('.scast-roster-tile'));

        setValue(q('#scast-ed-triggers'), 'Alice, Aly, Al');
        expect(q('#scast-ed-name').value).toBe('Alice');
    });
});

// ---------------------------------------------------------------------
// Trigger tester panel
// ---------------------------------------------------------------------

describe('trigger tester panel', () => {
    it('covers match / no-match / suppressed outcomes', async () => {
        const { config, ui } = await freshUi();
        config.getProfileCast('prof_default').push({
            triggers: 'Alice', displayName: 'Alice', portrait: '', variants: [],
            hitsRequired: 1, excludeTriggers: 'John Wick', useRegex: false,
        });
        ui.openDirectorPanel();
        click(q('.scast-roster-tile'));
        click(q('#scast-ed-tester-toggle'));

        const input = q('#scast-ed-tester-input');
        const result = () => q('#scast-ed-tester-result');

        setValue(input, 'Alice walked in');
        click(q('#scast-ed-tester-run'));
        expect(result().dataset.outcome).toBe('match');

        setValue(input, 'nothing relevant here');
        click(q('#scast-ed-tester-run'));
        expect(result().dataset.outcome).toBe('nomatch');

        setValue(input, 'Alice and John Wick both appear');
        click(q('#scast-ed-tester-run'));
        expect(result().dataset.outcome).toBe('suppressed');
    });

    it('an invalid regex trigger fails closed with a "no match" outcome', async () => {
        const { config, ui } = await freshUi();
        config.getProfileCast('prof_default').push({
            triggers: '(unclosed', displayName: 'X', portrait: '', variants: [],
            useRegex: true, hitsRequired: 1, excludeTriggers: '',
        });
        ui.openDirectorPanel();
        click(q('.scast-roster-tile'));
        click(q('#scast-ed-tester-toggle'));
        setValue(q('#scast-ed-tester-input'), 'anything');
        click(q('#scast-ed-tester-run'));
        expect(q('#scast-ed-tester-result').dataset.outcome).toBe('nomatch');
    });

    it('Enter in the tester input runs the test, same as clicking the button', async () => {
        const { config, ui } = await freshUi();
        config.getProfileCast('prof_default').push({ triggers: 'Alice', displayName: 'Alice', portrait: '', variants: [], hitsRequired: 1, excludeTriggers: '' });
        ui.openDirectorPanel();
        click(q('.scast-roster-tile'));
        click(q('#scast-ed-tester-toggle'));
        const input = q('#scast-ed-tester-input');
        setValue(input, 'Alice is here');
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
        expect(q('#scast-ed-tester-result').dataset.outcome).toBe('match');
    });
});

// ---------------------------------------------------------------------
// Variant gallery
// ---------------------------------------------------------------------

describe('variant gallery', () => {
    it('Add Variant appends an empty card immediately', async () => {
        const { config, ui } = await freshUi();
        config.getProfileCast('prof_default').push({ triggers: 'Alice', displayName: 'Alice', portrait: '', variants: [] });
        ui.openDirectorPanel();
        click(q('.scast-roster-tile'));
        click(q('#scast-ed-add-variant'));
        expect(qa('.scast-variant-card').length).toBe(1);
    });

    it('deleting a variant from the middle removes only that one, no off-by-one', async () => {
        const { config, ui } = await freshUi();
        config.getProfileCast('prof_default').push({
            triggers: 'Alice', displayName: 'Alice', portrait: '',
            variants: [
                { tag: 'a', label: 'a', portrait: '' },
                { tag: 'b', label: 'b', portrait: '' },
                { tag: 'c', label: 'c', portrait: '' },
            ],
        });
        ui.openDirectorPanel();
        click(q('.scast-roster-tile'));
        expect(qa('.scast-variant-card').length).toBe(3);

        click(qa('.scast-variant-delete')[1]); // delete "b"

        expect(qa('.scast-variant-label').map((i) => i.value)).toEqual(['a', 'c']);
    });
});

// ---------------------------------------------------------------------
// Move to another profile
// ---------------------------------------------------------------------

describe('move cast member to another profile', () => {
    it('moves the member, resets the stage only if the SOURCE profile was active, and stays viewing the source profile afterward', async () => {
        const { config, stage, ui } = await freshUi();
        config.getProfileCast('prof_default').push({ triggers: 'Alice', displayName: 'Alice', portrait: '', variants: [] });
        const idB = config.createProfile('World B');

        ui.openDirectorPanel(); // viewing prof_default (the active profile)
        click(q('.scast-roster-tile'));

        const resetSpy = vi.spyOn(stage, 'resetStage');
        setValueChange(q('#scast-ed-move-target'), idB);
        click(q('#scast-ed-move-btn'));
        await confirmDialog(true);

        expect(config.getProfileCast('prof_default').length).toBe(0);
        expect(config.getProfileCast(idB).length).toBe(1);
        expect(resetSpy).toHaveBeenCalled();
        expect(q('#scast-profile-select').value).toBe('prof_default'); // did NOT auto-switch to target
    });

    it('the move target dropdown is hidden when there is no other profile to move into', async () => {
        const { config, ui } = await freshUi();
        config.getProfileCast('prof_default').push({ triggers: 'Alice', displayName: 'Alice', portrait: '', variants: [] });
        ui.openDirectorPanel();
        click(q('.scast-roster-tile'));
        expect(q('#scast-ed-move-row').style.display).toBe('none');
    });
});

// ---------------------------------------------------------------------
// Live preview click gating
// ---------------------------------------------------------------------

describe('live preview click gating', () => {
    it('does not wire up a file input at all when no cast member is selected', async () => {
        const { ui } = await freshUi();
        ui.openDirectorPanel();
        expect(document.querySelector('#scast-editor-pane input[type="file"]')).toBeNull();
    });

    it('clicking the preview opens the file picker once a member IS selected', async () => {
        const { config, ui } = await freshUi();
        config.getProfileCast('prof_default').push({ triggers: 'Alice', displayName: 'Alice', portrait: '', variants: [] });
        ui.openDirectorPanel();
        click(q('.scast-roster-tile'));

        const fileInput = document.querySelector('#scast-editor-pane input[type="file"]');
        expect(fileInput).not.toBeNull();
        const clickSpy = vi.spyOn(fileInput, 'click');
        click(q('#scast-preview-stage'));
        expect(clickSpy).toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------
// Panel drag-and-drop depth counter
// ---------------------------------------------------------------------

describe('panel drag-and-drop counter', () => {
    it('the "drag-over" class survives nested dragenter/dragleave pairs and clears only at depth zero', async () => {
        const { ui } = await freshUi();
        ui.openDirectorPanel();
        const panelBox = q('#scast-panel');

        if (typeof DragEvent === 'undefined') {
            global.DragEvent = class DragEvent extends Event {
                constructor(type, opts = {}) {
                    super(type, opts);
                    this.dataTransfer = opts.dataTransfer ?? null;
                }
            };
            window.DragEvent = global.DragEvent;
        }

        panelBox.dispatchEvent(new DragEvent('dragenter', { bubbles: true }));
        expect(panelBox.classList.contains('drag-over')).toBe(true);

        panelBox.dispatchEvent(new DragEvent('dragenter', { bubbles: true })); // nested enter
        panelBox.dispatchEvent(new DragEvent('dragleave', { bubbles: true })); // one leave — depth still 1
        expect(panelBox.classList.contains('drag-over')).toBe(true);

        panelBox.dispatchEvent(new DragEvent('dragleave', { bubbles: true })); // depth 0
        expect(panelBox.classList.contains('drag-over')).toBe(false);
    });
});

// ---------------------------------------------------------------------
// Image Manager
// ---------------------------------------------------------------------

describe('Image Manager', () => {
    it('lists server images with usage references (or "Unused")', async () => {
        const { config, ui } = await freshUi();
        config.getProfileCast('prof_default').push({ triggers: 'Alice', displayName: 'Alice', portrait: 'user/images/scenecast/alice.png', variants: [] });
        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ([{ path: 'user/images/scenecast/alice.png' }, { path: 'user/images/scenecast/orphan.png' }]),
        });

        ui.openDirectorPanel();
        click(q('#scast-roster-images'));
        await flush();

        const tiles = qa('.scast-image-tile');
        expect(tiles.length).toBe(2);
        expect(tiles.find((t) => t.textContent.includes('alice.png')).textContent).toContain('Used by: Default: Alice');
        expect(tiles.find((t) => t.textContent.includes('orphan.png')).textContent).toContain('Unused');
    });

    it('deleting an image only clears local references AFTER the server confirms success', async () => {
        const { config, ui } = await freshUi();
        config.getProfileCast('prof_default').push({ triggers: 'Alice', displayName: 'Alice', portrait: 'user/images/scenecast/alice.png', variants: [] });
        global.fetch = vi.fn((url) => {
            if (url === '/api/images/list') return Promise.resolve({ ok: true, json: async () => ([{ path: 'user/images/scenecast/alice.png' }]) });
            if (url === '/api/images/delete') return Promise.resolve({ ok: true });
            return Promise.resolve({ ok: true, json: async () => ({}) });
        });

        ui.openDirectorPanel();
        click(q('#scast-roster-images'));
        await flush();

        click(q('.scast-image-delete'));
        await confirmDialog(true);
        await flush();

        expect(config.getProfileCast('prof_default')[0].portrait).toBe('');
    });

    it('a failed delete leaves local references untouched', async () => {
        const { config, ui } = await freshUi();
        config.getProfileCast('prof_default').push({ triggers: 'Alice', displayName: 'Alice', portrait: 'user/images/scenecast/alice.png', variants: [] });
        global.fetch = vi.fn((url) => {
            if (url === '/api/images/list') return Promise.resolve({ ok: true, json: async () => ([{ path: 'user/images/scenecast/alice.png' }]) });
            if (url === '/api/images/delete') return Promise.resolve({ ok: false, status: 500 });
            return Promise.resolve({ ok: true, json: async () => ({}) });
        });

        ui.openDirectorPanel();
        click(q('#scast-roster-images'));
        await flush();

        click(q('.scast-image-delete'));
        await confirmDialog(true);
        await flush();

        expect(config.getProfileCast('prof_default')[0].portrait).toBe('user/images/scenecast/alice.png');
    });

    it('creating a cast member from a server image adds it to the currently VIEWED profile', async () => {
        const { config, ui } = await freshUi();
        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ([{ path: 'user/images/scenecast/zoe.png' }]),
        });
        ui.openDirectorPanel();
        click(q('#scast-roster-images'));
        await flush();

        click(q('.scast-image-usecard'));
        await promptDialog('Zoe');

        expect(config.getProfileCast('prof_default').some((m) => m.displayName === 'Zoe')).toBe(true);
    });
});

describe('active-toggle targets a member by id, even when merged indices collide across profiles', () => {
    it('toggling off a member via its LOCAL roster index evicts only that member\'s own seat, not a same-numbered seat from another bound profile', async () => {
        const { config, stage, ui } = await freshUi({
            characterId: 0,
            characters: [{ avatar: 'a.png', name: 'Shared Character' }],
        });

        config.getProfileCast('prof_default').push({ triggers: 'MemberA0', displayName: 'MemberA0', portrait: 'a0.png', variants: [], active: true });

        const idB = config.createProfile('Profile B');
        config.getProfileCast(idB).push(
            { triggers: 'MemberB0', displayName: 'MemberB0', portrait: 'b0.png', variants: [], active: true },
            { triggers: 'MemberB1', displayName: 'MemberB1', portrait: 'b1.png', variants: [], active: true },
        );

        config.bindCharacterToProfile('prof_default');
        config.bindCharacterToProfile(idB);
        config.refreshActiveProfileForCurrentChat();

        const merged = config.loadConfig().cast;
        expect(merged.map((m) => m.triggers)).toEqual(['MemberA0', 'MemberB0', 'MemberB1']);

        // MemberB0 sits at merged index 1 and is currently on stage.
        stage.activeCast.set(1, { castIdx: 1, artIdx: 0, missCounter: 0, held: false, lastSeenAt: Date.now() });

        ui.openDirectorPanel();
        setValueChange(q('#scast-profile-select'), idB);

        // Toggle OFF MemberB1 — Profile B's LOCAL index 1, which used to
        // numerically collide with MemberB0's merged index (1) and evict
        // the wrong seat. It must no longer do so.
        click(qa('.scast-roster-tile-toggle')[1]);

        expect(stage.activeCast.has(1)).toBe(true); // MemberB0's seat survives
    });
});

// ---------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------

describe('mountSidebarPanel', () => {
    function mountTarget(id = 'extensions_settings2') {
        const target = document.createElement('div');
        target.id = id;
        document.body.appendChild(target);
        return target;
    }

    it('renders bound profile name(s) under #extensions_settings2 when available', async () => {
        const { ui } = await freshUi();
        mountTarget('extensions_settings2');
        ui.mountSidebarPanel();
        expect(document.getElementById('scast-sidebar-panel')).not.toBeNull();
        expect(q('.scast-sidebar-profile-names').textContent).toBe('Default');
    });

    it('falls back to #extensions_settings when #extensions_settings2 is absent', async () => {
        const { ui } = await freshUi();
        const target = mountTarget('extensions_settings');
        ui.mountSidebarPanel();
        expect(target.querySelector('#scast-sidebar-panel')).not.toBeNull();
    });

    it('does not throw when neither extensions container exists', async () => {
        const { ui } = await freshUi();
        expect(() => ui.mountSidebarPanel()).not.toThrow();
        expect(document.getElementById('scast-sidebar-panel')).toBeNull();
    });

    it('remounting fully replaces the DOM node, losing any expanded/collapsed drawer state', async () => {
        const { ui } = await freshUi();
        mountTarget();
        ui.mountSidebarPanel();
        const firstNode = document.getElementById('scast-sidebar-panel');
        firstNode.querySelector('.inline-drawer-content').style.display = 'block'; // simulate user expanding it

        ui.mountSidebarPanel();
        const secondNode = document.getElementById('scast-sidebar-panel');

        expect(secondNode).not.toBe(firstNode);
        expect(secondNode.querySelector('.inline-drawer-content').style.display).toBe('none');
    });

    it('disabling the Enabled checkbox always calls resetStage() and detachTimelineWatcher()', async () => {
        const { config, stage, timeline, ui } = await freshUi();
        mountTarget();
        config.loadConfig().timelineSync = true;

        const resetSpy = vi.spyOn(stage, 'resetStage');
        const detachSpy = vi.spyOn(timeline, 'detachTimelineWatcher');

        ui.mountSidebarPanel();
        const checkbox = q('#scast_active_toggle');
        expect(checkbox.checked).toBe(true);

        checkbox.checked = false;
        checkbox.dispatchEvent(new Event('change', { bubbles: true }));

        expect(config.loadConfig().isActive).toBe(false);
        expect(resetSpy).toHaveBeenCalled();
        expect(detachSpy).toHaveBeenCalled();
    });

    it('re-enabling only reattaches the timeline watcher if timelineSync was already true', async () => {
        const { config, timeline, ui } = await freshUi();
        mountTarget();
        config.loadConfig().timelineSync = false;

        const attachSpy = vi.spyOn(timeline, 'attachTimelineWatcher');
        ui.mountSidebarPanel();
        const checkbox = q('#scast_active_toggle');

        checkbox.checked = false;
        checkbox.dispatchEvent(new Event('change', { bubbles: true }));
        checkbox.checked = true;
        checkbox.dispatchEvent(new Event('change', { bubbles: true }));

        expect(attachSpy).not.toHaveBeenCalled();
    });

    it('re-enabling DOES reattach the timeline watcher when timelineSync is true', async () => {
        const { config, timeline, ui } = await freshUi();
        mountTarget();
        config.loadConfig().timelineSync = true;

        ui.mountSidebarPanel();
        const checkbox = q('#scast_active_toggle');
        const attachSpy = vi.spyOn(timeline, 'attachTimelineWatcher');

        checkbox.checked = false;
        checkbox.dispatchEvent(new Event('change', { bubbles: true }));
        checkbox.checked = true;
        checkbox.dispatchEvent(new Event('change', { bubbles: true }));

        expect(attachSpy).toHaveBeenCalled();
    });

    it('clicking "Open Cast Manager" opens the director panel', async () => {
        const { ui } = await freshUi();
        mountTarget();
        ui.mountSidebarPanel();
        click(q('#scast_open_panel'));
        expect(document.getElementById('scast-panel-overlay').classList.contains('visible')).toBe(true);
    });
});