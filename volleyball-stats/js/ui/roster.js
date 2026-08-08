/** Roster management plus team settings, backup and restore. */

import { ROSTER_POSITIONS } from '../model.js';
import { el, mount, openSheet, closeSheet, toast, confirmDialog, downloadText } from './dom.js';

export function renderRoster(root, store) {
    // While a match is open its team wins, so the roster on screen is always the
    // one being scored. Otherwise the tab is free to browse any team.
    const team = store.activeTeam;
    const locked = Boolean(store.activeMatch);

    mount(
        root,
        teamPanel(store, team, locked),
        team &&
            el('section.panel', {}, [
                el('div.panel__head', {}, [
                    el('h2.panel__title', { text: `${team.fullName} (${team.players.length})` }),
                    el('button.btn.btn--primary.btn--sm', {
                        type: 'button',
                        text: '+ Add',
                        onClick: () => openPlayerSheet(store, team, null),
                    }),
                ]),
                team.players.length === 0
                    ? el('p.panel__hint', {
                          text: 'No players on this team yet. Add them here, or add them to roster.json so every coach gets them.',
                      })
                    : el(
                          'ul.rosterlist',
                          {},
                          team.players.map((player) =>
                              el('li.rosterlist__item', {}, [
                                  el(
                                      'button.rosterlist__main',
                                      {
                                          type: 'button',
                                          onClick: () => openPlayerSheet(store, team, player),
                                      },
                                      [
                                          el('span.rosterlist__num', { text: `#${player.number}` }),
                                          el('span.rosterlist__name', { text: player.name }),
                                          player.position && el('span.tag', { text: player.position }),
                                          player.isSetter && el('span.tag.tag--setter', { text: 'S' }),
                                          player.isLibero && el('span.tag.tag--libero', { text: 'L' }),
                                          player.local && el('span.tag', { text: 'this device' }),
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

function teamPanel(store, team, locked) {
    const file = store.state.rosterFile;

    return el('section.panel', {}, [
        el('h2.panel__title', { text: 'Team' }),
        store.teams.length === 0
            ? el('p.panel__hint', {
                  text: 'No teams loaded. Connect to the internet once so the shared roster can download, or add a team below.',
              })
            : el(
                  'div.segmented.segmented--wrap',
                  {},
                  store.teams.map((t) =>
                      el('button.seg', {
                          type: 'button',
                          class: t.id === team?.id ? 'seg--on' : '',
                          text: t.name,
                          title: t.fullName,
                          disabled: locked,
                          onClick: () => store.setActiveTeam(t.id),
                      }),
                  ),
              ),
        locked &&
            el('p.panel__hint', {
                text: 'A match is open, so the roster is locked to that match’s team. Close it from the Log tab to browse others.',
            }),
        el('p.panel__hint', {
            text: file?.updated
                ? `Shared roster last updated ${file.updated}.`
                : 'Shared roster has not been downloaded on this device yet.',
        }),
        labelledInput('Season', store.state.season.name, (value) =>
            store.update((state) => {
                state.season.name = value;
            }),
        ),
        el('button.btn.btn--ghost.btn--sm', {
            type: 'button',
            text: '+ Add a team on this device',
            onClick: () => openTeamSheet(store),
        }),
    ]);
}

/** Teams normally come from roster.json; this covers one-off local additions. */
function openTeamSheet(store) {
    const draft = { name: '', fullName: '' };
    const body = el('div.form', {}, [
        el('label.field', {}, [
            el('span.field__label', { text: 'Short name (e.g. JV)' }),
            el('input.input', {
                type: 'text',
                placeholder: 'JV',
                onInput: (event) => {
                    draft.name = event.target.value.trim();
                },
            }),
        ]),
        el('label.field', {}, [
            el('span.field__label', { text: 'Full name' }),
            el('input.input', {
                type: 'text',
                placeholder: 'Junior Varsity',
                onInput: (event) => {
                    draft.fullName = event.target.value.trim();
                },
            }),
        ]),
        el('div.form__actions', {}, [
            el('button.btn.btn--primary', {
                type: 'button',
                text: 'Add Team',
                onClick: () => {
                    if (!draft.name) {
                        toast('Give the team a short name', 'warn');
                        return;
                    }
                    store.addTeam(draft);
                    closeSheet();
                    toast('Team added');
                },
            }),
        ]),
    ]);
    openSheet({ title: 'Add a team', subtitle: 'Stays on this device only', body });
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

function openPlayerSheet(store, team, player) {
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
                            store.removePlayer(team.id, player.id);
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
                    if (isNew) store.addPlayer(team.id, draft);
                    else store.updatePlayer(team.id, player.id, draft);
                    closeSheet();
                    toast(isNew ? 'Player added' : 'Saved');
                },
            }),
        ]),
    ]);

    openSheet({
        title: isNew ? 'Add player' : `#${player.number} ${player.name}`,
        subtitle: isNew
            ? `Added to ${team.fullName} on this device only`
            : player.local
              ? `${team.fullName} · added on this device`
              : `${team.fullName} · from roster.json — edits here stay on this device`,
        body,
    });
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

/**
 * A file picker dressed as a button.
 *
 * @param {string} label
 * @param {'merge'|'replace'} mode
 * @param {object} store
 */
function fileButton(label, mode, store) {
    return el('label.btn.btn--ghost', { class: mode === 'replace' ? 'btn--sm' : '' }, [
        label,
        el('input', {
            type: 'file',
            accept: 'application/json,.json',
            hidden: true,
            onChange: async (event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (!file) return;

                let text;
                try {
                    text = await file.text();
                } catch (error) {
                    console.error(error);
                    toast('That file could not be read', 'warn');
                    return;
                }

                if (mode === 'merge') {
                    try {
                        const { added, skipped } = store.mergeJson(text);
                        toast(
                            added === 0
                                ? 'Nothing new — those matches are already here'
                                : `Added ${added} match${added === 1 ? '' : 'es'}${
                                      skipped ? `, skipped ${skipped} already here` : ''
                                  }`,
                        );
                    } catch (error) {
                        console.error(error);
                        toast('That file could not be merged', 'warn');
                    }
                    return;
                }

                const confirmed = await confirmDialog({
                    title: 'Replace everything on this device?',
                    message:
                        'Every match currently on this device is deleted and replaced by the file. If you meant to combine two devices, cancel and use Merge instead.',
                    confirmLabel: 'Replace',
                    danger: true,
                });
                if (!confirmed) return;
                try {
                    store.importJson(text);
                    toast('Backup restored');
                } catch (error) {
                    console.error(error);
                    toast('That file could not be read', 'warn');
                }
            },
        }),
    ]);
}

function dataPanel(store) {
    return el('section.panel', {}, [
        el('h2.panel__title', { text: 'Data' }),
        el('p.panel__hint', {
            text: 'Match data is stored on this device only — it is never uploaded. Export a backup before clearing browser data.',
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
            fileButton('Merge a file', 'merge', store),
        ]),
        el('p.panel__hint', {
            text: 'Merge adds another coach’s matches to yours and leaves your own untouched — that is how you combine devices after a game. Replace wipes this device and restores the file exactly.',
        }),
        fileButton('Replace everything from a file', 'replace', store),
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
