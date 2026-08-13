/**
 * Teams, the program roster, and the device's data.
 *
 * There is one roster. Teams are tags a player carries, so the tab is a list of
 * team labels followed by every player, filterable by tag. A player on both JV
 * and Varsity appears once, with both tags on their row — which is also how you
 * spot swing players at a glance.
 */

import { ROSTER_POSITIONS, isLibero, isSetter, playerLabel } from '../model.js';
import { APP_VERSION } from '../version.js';
import { el, mount, openSheet, closeSheet, toast, confirmDialog, downloadText, shareFile } from './dom.js';

/** Which team's players are listed. null means everyone. */
let filterTeamId = null;
const UNTAGGED = '__untagged__';

export function renderRoster(root, store) {
    // A filter pointing at a team that no longer exists would hide everyone.
    if (filterTeamId && filterTeamId !== UNTAGGED && !store.team(filterTeamId)) filterTeamId = null;

    mount(root, teamsPanel(store), playersPanel(store), seasonPanel(store), dataPanel(store));
    return root;
}

/* ------------------------------------------------------------------ teams */

function teamsPanel(store) {
    const file = store.state.rosterFile;
    const activeMatch = store.activeMatch;

    return el('section.panel', {}, [
        el('div.panel__head', {}, [
            el('h2.panel__title', { text: `Teams (${store.teams.length})` }),
            el('button.btn.btn--primary.btn--sm', {
                type: 'button',
                text: '+ Team',
                onClick: () => openTeamSheet(store, null),
            }),
        ]),
        el('p.panel__hint', {
            text: file?.updated
                ? `Team labels last updated ${file.updated}. Players are managed here on this device.`
                : 'Shared roster has not downloaded on this device yet — open the app once with a connection.',
        }),
        store.teams.length === 0
            ? el('p.panel__hint', { text: 'No teams yet. Add one, or connect so roster.json can download.' })
            : el(
                  'ul.teamlist',
                  {},
                  store.teams.map((team) => {
                      const pool = store.playersForTeam(team.id);
                      const matches = store.matchesFor(team.id);
                      return el('li.teamlist__item', {}, [
                          el('div.teamrow', {}, [
                              el(
                                  'button.teamrow__main',
                                  {
                                      type: 'button',
                                      onClick: () => {
                                          filterTeamId = filterTeamId === team.id ? null : team.id;
                                          store.commit();
                                      },
                                  },
                                  [
                                      el('span.teamrow__name', { text: team.name }),
                                      el('span.teamrow__full', { text: team.fullName }),
                                      activeMatch?.teamId === team.id &&
                                          el('span.tag.tag--setter', { text: 'in play' }),
                                      el('span.teamrow__meta', {
                                          text: `${pool.length} player${pool.length === 1 ? '' : 's'} · ${
                                              matches.length
                                          } match${matches.length === 1 ? '' : 'es'}`,
                                      }),
                                  ],
                              ),
                              el('button.teamrow__edit', {
                                  type: 'button',
                                  'aria-label': `Manage ${team.fullName}`,
                                  text: '⋯',
                                  onClick: () => openTeamSheet(store, team),
                              }),
                          ]),
                      ]);
                  }),
              ),
        removedTeams(store),
    ]);
}

function removedTeams(store) {
    const removable = store.restorableTeamIds;
    if (removable.length === 0) return null;

    return el('div.field', {}, [
        el('span.field__label', { text: 'Removed' }),
        el('p.panel__hint', {
            text: 'Still in roster.json, hidden here. Restoring brings the team and its tags back the next time the app loads online.',
        }),
        el(
            'div.segmented.segmented--wrap',
            {},
            removable.map((id) =>
                el('button.seg', {
                    type: 'button',
                    text: `Restore ${store.team(id)?.name ?? id}`,
                    onClick: () => {
                        store.restoreTeam(id);
                        toast('Restored — reopen online to pull it back');
                    },
                }),
            ),
        ),
    ]);
}

/* ---------------------------------------------------------------- players */

/** How many of these players are still number-only. */
function nameless(players) {
    return players.filter((player) => !player.name).length;
}

function playersPanel(store) {
    const all = store.players;
    const untagged = store.untaggedPlayers;

    const shown = filterTeamId === UNTAGGED ? untagged : filterTeamId ? store.playersForTeam(filterTeamId) : all;

    const heading =
        filterTeamId === UNTAGGED
            ? 'No team'
            : filterTeamId
              ? (store.team(filterTeamId)?.fullName ?? 'Team')
              : 'All players';

    return el('section.panel', {}, [
        el('div.panel__head', {}, [
            el('h2.panel__title', { text: `${heading} (${shown.length})` }),
            el('button.btn.btn--primary.btn--sm', {
                type: 'button',
                text: '+ Player',
                onClick: () => openPlayerSheet(store, null),
            }),
        ]),

        el('div.segmented.segmented--wrap', {}, [
            filterButton(store, null, `All ${all.length}`),
            ...store.teams.map((team) =>
                filterButton(store, team.id, `${team.name} ${store.playersForTeam(team.id).length}`),
            ),
            untagged.length > 0 && filterButton(store, UNTAGGED, `No team ${untagged.length}`),
        ]),

        untagged.length > 0 &&
            filterTeamId !== UNTAGGED &&
            el('p.panel__hint', {
                text: `${untagged.length} player${untagged.length === 1 ? ' has' : 's have'} no team tag, so they cannot be picked for a lineup.`,
            }),

        // The shared file has numbers but no names, by design. Say so where a
        // coach meets it, or a blank column just looks like a bug.
        nameless(shown) > 0 &&
            el('p.panel__hint', {
                text: `${nameless(shown)} of these have a number but no name. That is fine — the app reads #7 everywhere. Tap a player to add one; names stay on this phone and are never published.`,
            }),

        shown.length === 0
            ? el('p.panel__hint', {
                  text: filterTeamId
                      ? 'Nobody is tagged for this team yet. Tap a player and add the tag.'
                      : 'No players yet. Tap + Player to build the roster — it stays on this device.',
              })
            : el(
                  'ul.rosterlist',
                  {},
                  shown.map((player) =>
                      el('li.rosterlist__item', {}, [
                          el(
                              'button.rosterlist__main',
                              { type: 'button', onClick: () => openPlayerSheet(store, player) },
                              [
                                  el('span.rosterlist__num', { text: `#${player.number}` }),
                                  player.name && el('span.rosterlist__name', { text: player.name }),
                                  player.position &&
                                      el('span.tag', {
                                          class: isSetter(player)
                                              ? 'tag--setter'
                                              : isLibero(player)
                                                ? 'tag--libero'
                                                : '',
                                          text: player.position,
                                      }),
                                  ...player.teams.map((id) =>
                                      el('span.tag.tag--team', { text: store.team(id)?.name ?? id }),
                                  ),
                                  player.teams.length === 0 && el('span.tag.tag--warn', { text: 'no team' }),
                              ],
                          ),
                      ]),
                  ),
              ),
    ]);
}

function filterButton(store, id, label) {
    return el('button.seg', {
        type: 'button',
        class: filterTeamId === id ? 'seg--on' : '',
        text: label,
        onClick: () => {
            filterTeamId = id;
            store.commit();
        },
    });
}

/* ------------------------------------------------------------- team sheet */

function openTeamSheet(store, team) {
    const isNew = !team;
    const fromFile = !isNew && store.isFromRosterFile(team.id);
    const pool = isNew ? [] : store.playersForTeam(team.id);
    const matches = isNew ? [] : store.matchesFor(team.id);

    const draft = { name: team?.name ?? '', fullName: team?.fullName ?? '' };

    const nameInput = el('input.input', {
        type: 'text',
        placeholder: 'JV',
        value: draft.name,
        onInput: (event) => {
            draft.name = event.target.value.trim();
        },
    });
    const fullInput = el('input.input', {
        type: 'text',
        placeholder: 'Junior Varsity',
        value: draft.fullName,
        onInput: (event) => {
            draft.fullName = event.target.value.trim();
        },
    });

    const body = el('div.form', {}, [
        el('label.field', {}, [el('span.field__label', { text: 'Short name' }), nameInput]),
        el('label.field', {}, [el('span.field__label', { text: 'Full name' }), fullInput]),

        !isNew &&
            el('p.panel__hint', {
                text: fromFile
                    ? 'This team comes from roster.json. Renaming it here applies to this device only — rename it in the file to change it for everyone.'
                    : 'This team was added on this device, so only you have it.',
            }),

        el('div.form__actions', {}, [
            !isNew &&
                el('button.btn.btn--danger.btn--sm', {
                    type: 'button',
                    text: 'Remove team',
                    onClick: () => confirmRemoveTeam(store, team, fromFile, pool.length, matches.length),
                }),
            el('button.btn.btn--primary', {
                type: 'button',
                text: isNew ? 'Add Team' : 'Save',
                onClick: () => {
                    if (!draft.name) {
                        toast('Give the team a short name', 'warn');
                        return;
                    }
                    if (isNew) store.addTeam(draft);
                    else store.renameTeam(team.id, draft);
                    closeSheet();
                    toast(isNew ? 'Team added' : 'Saved');
                },
            }),
        ]),
    ]);

    openSheet({
        title: isNew ? 'Add a team' : team.fullName,
        subtitle: isNew
            ? 'Stays on this device — add it to roster.json to share it'
            : `${pool.length} players · ${matches.length} match${matches.length === 1 ? '' : 'es'}`,
        body,
    });
    setTimeout(() => nameInput.focus(), 120);
}

async function confirmRemoveTeam(store, team, fromFile, poolCount, matchCount) {
    const message = [
        `Removing a team only removes the tag. ${
            poolCount === 0
                ? 'No players are tagged for it.'
                : `${poolCount} player${poolCount === 1 ? '' : 's'} stay on the roster minus this one tag.`
        }`,
        matchCount === 0
            ? 'It has no matches.'
            : `Its ${matchCount} match${matchCount === 1 ? '' : 'es'} and all their stats are kept.`,
        fromFile
            ? 'It stays in roster.json for everyone else, and will not come back here unless you restore it.'
            : 'It only exists on this device.',
    ].join(' ');

    const confirmed = await confirmDialog({
        title: `Remove ${team.fullName}?`,
        message,
        confirmLabel: 'Remove team',
        danger: true,
    });
    if (!confirmed) return;

    const { playersUntagged, matchesKept } = store.deleteTeam(team.id);
    if (filterTeamId === team.id) filterTeamId = null;
    closeSheet();
    toast(
        `Team removed · ${playersUntagged} player${playersUntagged === 1 ? '' : 's'} untagged, ${matchesKept} match${
            matchesKept === 1 ? '' : 'es'
        } kept`,
        'warn',
    );
}

/* ------------------------------------------------------------ player sheet */

function openPlayerSheet(store, player) {
    const isNew = !player;
    const draft = {
        number: player?.number ?? '',
        name: player?.name ?? '',
        position: player?.position ?? '',
        // A new player added while a team filter is on joins that team.
        teams: player ? player.teams.slice() : filterTeamId && filterTeamId !== UNTAGGED ? [filterTeamId] : [],
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

    // Teams are a multi-select: a player can be on JV and Varsity at once.
    const teamRow = el(
        'div.segmented.segmented--wrap',
        {},
        store.teams.map((team) =>
            el('button.seg', {
                type: 'button',
                class: draft.teams.includes(team.id) ? 'seg--on' : '',
                text: team.name,
                title: team.fullName,
                onClick: (event) => {
                    draft.teams = draft.teams.includes(team.id)
                        ? draft.teams.filter((t) => t !== team.id)
                        : [...draft.teams, team.id];
                    event.currentTarget.classList.toggle('seg--on', draft.teams.includes(team.id));
                },
            }),
        ),
    );

    const positionRow = el(
        'div.segmented.segmented--wrap',
        {},
        ROSTER_POSITIONS.map((position) =>
            el('button.seg', {
                type: 'button',
                class: draft.position === position ? 'seg--on' : '',
                text: position,
                onClick: () => {
                    draft.position = draft.position === position ? '' : position;
                    for (const sibling of positionRow.children) {
                        sibling.classList.toggle('seg--on', sibling.textContent === draft.position);
                    }
                },
            }),
        ),
    );

    const body = el('div.form', {}, [
        el('div.form__row', {}, [
            el('label.field.field--num', {}, [el('span.field__label', { text: 'Number' }), numberInput]),
            el('label.field.field--grow', {}, [el('span.field__label', { text: 'Name' }), nameInput]),
        ]),
        el('div.field', {}, [
            el('span.field__label', { text: 'Teams' }),
            store.teams.length === 0 ? el('p.panel__hint', { text: 'No teams to assign yet.' }) : teamRow,
            el('p.panel__hint', { text: 'Pick as many as they play for. Untagged players cannot be put in a lineup.' }),
        ]),
        el('div.field', {}, [
            el('span.field__label', { text: 'Position' }),
            positionRow,
            el('p.panel__hint', {
                text: 'S and L are the setter and libero — picking them here is what marks the player on the court map.',
            }),
        ]),
        el('div.form__actions', {}, [
            !isNew &&
                el('button.btn.btn--danger.btn--sm', {
                    type: 'button',
                    text: 'Delete player',
                    onClick: async () => {
                        const confirmed = await confirmDialog({
                            title: `Delete ${playerLabel(player)}?`,
                            message:
                                'This removes them from the whole program. Stats already recorded stay in past matches. To take them off one team only, untick that team instead.',
                            confirmLabel: 'Delete',
                            danger: true,
                        });
                        if (confirmed) {
                            store.deletePlayer(player.id);
                            closeSheet();
                            toast('Player deleted', 'warn');
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

    openSheet({
        title: isNew ? 'Add player' : playerLabel(player),
        subtitle: isNew
            ? 'Added on this device only'
            : player.local
              ? 'Added on this device'
              : 'From roster.json — edits stay on this device',
        body,
    });
    setTimeout(() => (isNew ? numberInput : nameInput).focus(), 120);
}

/* ----------------------------------------------------------------- season */

function seasonPanel(store) {
    const input = el('input.input', {
        type: 'text',
        value: store.state.season.name ?? '',
        onChange: (event) =>
            store.update((state) => {
                state.season.name = event.target.value.trim();
            }),
    });
    return el('section.panel', {}, [el('label.field', {}, [el('span.field__label', { text: 'Season' }), input])]);
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
                text: 'Share backup',
                onClick: async () => {
                    const stamp = new Date().toISOString().slice(0, 10);
                    const result = await shareFile(`volleyball-stats-${stamp}.json`, store.exportJson(), {
                        title: `${store.state.season.name} — full backup`,
                    });
                    if (result === 'shared') toast('Shared');
                    else if (result === 'downloaded') toast('Downloaded — sharing is not available here');
                },
            }),
            fileButton('Merge a file', 'merge', store),
        ]),
        el('button.btn.btn--ghost.btn--sm', {
            type: 'button',
            text: 'Save backup to this device',
            onClick: () => {
                const stamp = new Date().toISOString().slice(0, 10);
                downloadText(`volleyball-stats-${stamp}.json`, store.exportJson(), 'application/json');
                toast('Backup downloaded');
            },
        }),
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
                    message: 'Teams, players, matches and every recorded stat will be deleted from this device.',
                    confirmLabel: 'Erase',
                    danger: true,
                });
                if (confirmed) {
                    store.reset();
                    toast('All data erased', 'warn');
                }
            },
        }),
        versionRow(store),
    ]);
}

/**
 * Which build this device is running. Publishing an update and then wondering
 * whether the phone actually picked it up is otherwise unanswerable.
 */
function versionRow(store) {
    return el('div.versionrow', {}, [
        el('span.versionrow__text', {
            text: `App version ${APP_VERSION} · roster ${store.state.rosterFile?.updated ?? 'not downloaded'}`,
        }),
        el('button.btn.btn--ghost.btn--sm', {
            type: 'button',
            text: 'Check for update',
            onClick: async () => {
                if (!('serviceWorker' in navigator)) {
                    location.reload();
                    return;
                }
                toast('Checking…');
                try {
                    const registration = await navigator.serviceWorker.getRegistration();
                    await registration?.update();
                } catch (error) {
                    console.warn('Update check failed', error);
                }
                // Reload regardless: with a network-first worker this alone
                // pulls the current files whenever there is a connection.
                setTimeout(() => location.reload(), 400);
            },
        }),
    ]);
}
