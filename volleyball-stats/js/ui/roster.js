/** Roster management plus team settings, backup and restore. */

import { ROSTER_POSITIONS } from '../model.js';
import { el, mount, openSheet, closeSheet, toast, confirmDialog, downloadText } from './dom.js';

export function renderRoster(root, store) {
    mount(
        root,
        teamPanel(store),
        el('section.panel', {}, [
            el('div.panel__head', {}, [
                el('h2.panel__title', { text: `Roster (${store.roster.length})` }),
                el('button.btn.btn--primary.btn--sm', {
                    type: 'button',
                    text: '+ Add',
                    onClick: () => openPlayerSheet(store, null),
                }),
            ]),
            store.roster.length === 0
                ? el('p.panel__hint', { text: 'No players yet. Add your first player to get started.' })
                : el(
                      'ul.rosterlist',
                      {},
                      store.roster.map((player) =>
                          el('li.rosterlist__item', {}, [
                              el(
                                  'button.rosterlist__main',
                                  {
                                      type: 'button',
                                      onClick: () => openPlayerSheet(store, player),
                                  },
                                  [
                                      el('span.rosterlist__num', { text: `#${player.number}` }),
                                      el('span.rosterlist__name', { text: player.name }),
                                      player.position && el('span.tag', { text: player.position }),
                                      player.isSetter && el('span.tag.tag--setter', { text: 'S' }),
                                      player.isLibero && el('span.tag.tag--libero', { text: 'L' }),
                                  ],
                              ),
                          ]),
                      ),
                  ),
        ]),
        dataPanel(store),
    );
    return root;
}

function teamPanel(store) {
    return el('section.panel', {}, [
        el('h2.panel__title', { text: 'Team' }),
        labelledInput('Team name', store.state.team.name, (value) =>
            store.update((state) => {
                state.team.name = value || 'My Team';
            }),
        ),
        labelledInput('Season', store.state.season.name, (value) =>
            store.update((state) => {
                state.season.name = value;
            }),
        ),
    ]);
}

function labelledInput(label, value, onCommit) {
    const input = el('input.input', {
        type: 'text',
        value: value ?? '',
        onChange: (event) => onCommit(event.target.value.trim()),
    });
    return el('label.field', {}, [el('span.field__label', { text: label }), input]);
}

/* ------------------------------------------------------------ player sheet */

function openPlayerSheet(store, player) {
    const isNew = !player;
    const draft = {
        number: player?.number ?? '',
        name: player?.name ?? '',
        position: player?.position ?? '',
        isSetter: player?.isSetter ?? false,
        isLibero: player?.isLibero ?? false,
    };

    const numberInput = el('input.input.input--num', {
        type: 'text',
        inputmode: 'numeric',
        placeholder: '00',
        value: draft.number,
        onInput: (event) => {
            draft.number = event.target.value.trim();
        },
    });
    const nameInput = el('input.input', {
        type: 'text',
        placeholder: 'Player name',
        value: draft.name,
        onInput: (event) => {
            draft.name = event.target.value.trim();
        },
    });

    const positionRow = el(
        'div.segmented.segmented--wrap',
        {},
        ROSTER_POSITIONS.map((position) => {
            const button = el('button.seg', {
                type: 'button',
                class: draft.position === position ? 'seg--on' : '',
                text: position,
                onClick: () => {
                    draft.position = draft.position === position ? '' : position;
                    for (const sibling of positionRow.children) {
                        sibling.classList.toggle('seg--on', sibling.textContent === draft.position);
                    }
                },
            });
            return button;
        }),
    );

    const setterToggle = checkbox('Setter', draft.isSetter, (checked) => {
        draft.isSetter = checked;
    });
    const liberoToggle = checkbox('Libero', draft.isLibero, (checked) => {
        draft.isLibero = checked;
    });

    const body = el('div.form', {}, [
        el('div.form__row', {}, [
            el('label.field.field--num', {}, [el('span.field__label', { text: 'Number' }), numberInput]),
            el('label.field.field--grow', {}, [el('span.field__label', { text: 'Name' }), nameInput]),
        ]),
        el('div.field', {}, [el('span.field__label', { text: 'Position' }), positionRow]),
        el('div.form__row', {}, [setterToggle, liberoToggle]),
        el('div.form__actions', {}, [
            !isNew &&
                el('button.btn.btn--danger.btn--sm', {
                    type: 'button',
                    text: 'Delete',
                    onClick: async () => {
                        const confirmed = await confirmDialog({
                            title: `Remove #${player.number} ${player.name}?`,
                            message:
                                'Stats already recorded for this player stay in past matches, but they will no longer appear on the roster.',
                            confirmLabel: 'Remove',
                            danger: true,
                        });
                        if (confirmed) {
                            store.removePlayer(player.id);
                            toast('Player removed', 'warn');
                        }
                    },
                }),
            el('button.btn.btn--primary', {
                type: 'button',
                text: isNew ? 'Add Player' : 'Save',
                onClick: () => {
                    if (!draft.name && !draft.number) {
                        toast('Give the player a number or a name', 'warn');
                        return;
                    }
                    if (isNew) store.addPlayer(draft);
                    else store.updatePlayer(player.id, draft);
                    closeSheet();
                    toast(isNew ? 'Player added' : 'Saved');
                },
            }),
        ]),
    ]);

    openSheet({ title: isNew ? 'Add player' : `#${player.number} ${player.name}`, body });
    setTimeout(() => (isNew ? numberInput : nameInput).focus(), 120);
}

function checkbox(label, checked, onChange) {
    const input = el('input', {
        type: 'checkbox',
        checked: checked || null,
        onChange: (event) => onChange(event.target.checked),
    });
    return el('label.check', {}, [input, el('span', { text: label })]);
}

/* --------------------------------------------------------------- backup */

function dataPanel(store) {
    return el('section.panel', {}, [
        el('h2.panel__title', { text: 'Data' }),
        el('p.panel__hint', {
            text: 'Everything is stored on this device. Export a backup before clearing browser data.',
        }),
        el('div.form__row', {}, [
            el('button.btn.btn--ghost', {
                type: 'button',
                text: 'Export backup',
                onClick: () => {
                    const stamp = new Date().toISOString().slice(0, 10);
                    downloadText(`volleyball-stats-${stamp}.json`, store.exportJson(), 'application/json');
                    toast('Backup downloaded');
                },
            }),
            el('label.btn.btn--ghost', {}, [
                'Import backup',
                el('input', {
                    type: 'file',
                    accept: 'application/json,.json',
                    hidden: true,
                    onChange: async (event) => {
                        const file = event.target.files?.[0];
                        if (!file) return;
                        try {
                            store.importJson(await file.text());
                            toast('Backup restored');
                        } catch (error) {
                            console.error(error);
                            toast('That file could not be read', 'warn');
                        }
                        event.target.value = '';
                    },
                }),
            ]),
        ]),
        el('button.btn.btn--danger.btn--sm', {
            type: 'button',
            text: 'Erase all data',
            onClick: async () => {
                const confirmed = await confirmDialog({
                    title: 'Erase everything?',
                    message: 'Roster, matches and every recorded stat will be deleted from this device.',
                    confirmLabel: 'Erase',
                    danger: true,
                });
                if (confirmed) {
                    store.reset();
                    toast('All data erased', 'warn');
                }
            },
        }),
    ]);
}
