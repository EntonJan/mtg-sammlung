/* eslint-disable */
// Spieltisch aus Entons „MTG Lounge“ (arena.html), übernommen in die MTG-Sammlung.
// Firebase läuft über das Projekt mtg-sammlung; Optik über Tailwind (gescoped auf .arena-root, Onyx-Gold-Palette).
import React, { useState, useEffect, useRef, useMemo } from 'react'
import ReactDOM from 'react-dom'
import { collection, doc, setDoc as fsSetDoc, getDocs, getDoc, deleteDoc, onSnapshot, addDoc as fsAddDoc, updateDoc as fsUpdateDoc, increment, query, where, orderBy, limitToLast, runTransaction } from 'firebase/firestore'
import { db } from '../firebase'
import Icon from './Icon'

let arenaUser = null
export const setArenaUser = (u) => { arenaUser = u }
// Rückmeldungen an die App (Ergebnis speichern usw.)
export const arenaHooks = {}
// Ergebnis einmal pro Spieler und Tisch ins eigene Deck melden. Teilnehmer kommen aus dem Ergebnis selbst
// (beim Melden festgehalten), weil Mitspieler den Raum schon verlassen haben können.
const reportResult = (roomId, me, gr, fallbackInfo, fallbackPlayers) => {
  if (!gr || !arenaHooks.onResult) return
  window.__arenaSaved = window.__arenaSaved || {}
  if (window.__arenaSaved[roomId]) return
  window.__arenaSaved[roomId] = true
  const info = gr.participants || fallbackInfo || {}
  const ids = Object.keys(info).length ? Object.keys(info) : (fallbackPlayers || [])
  const w = gr.winner
  const opponents = ids.filter((p) => p !== me).map((p) => ({ uid: p, name: info[p]?.name || '?', deck: info[p]?.deckName || '?', commander: info[p]?.commanderName || '' }))
  Promise.resolve(arenaHooks.onResult({ result: !w || w === 'draw' ? 'draw' : w === me ? 'win' : 'loss', winnerName: w && w !== 'draw' ? (info[w]?.name || '?') : null, opponents, players: ids.length })).catch(console.error)
}
// Firestore lehnt „undefined“ ab (z. B. Karten ohne Stärke/Loyalität/Rückseite) – vor jedem Schreiben entfernen.
// Sonderwerte wie increment() sind keine einfachen Objekte und bleiben unangetastet.
const isPlain = (v) => v !== null && typeof v === 'object' && (Array.isArray(v) || Object.getPrototypeOf(v) === Object.prototype)
const strip = (v) => {
  if (Array.isArray(v)) return v.filter((x) => x !== undefined).map(strip)
  if (!isPlain(v)) return v
  const o = {}
  for (const [k, x] of Object.entries(v)) if (x !== undefined) o[k] = strip(x)
  return o
}
const setDoc = (ref, data, opt) => fsSetDoc(ref, strip(data), opt)
const updateDoc = (ref, data) => fsUpdateDoc(ref, strip(data))
const addDoc = (col, data) => fsAddDoc(col, strip(data))
const runTx = (fn) => runTransaction(db, (tx) => fn({
  get: (r) => tx.get(r),
  update: (r, d) => tx.update(r, strip(d)),
  set: (r, d, o) => tx.set(r, strip(d), o),
  delete: (r) => tx.delete(r),
}))
        
        const generateId = () => Math.random().toString(36).substring(2, 9);
        const ROOM_TIMEOUT_MS = 180000; // 180 seconds = 3 minutes
        const SCRYFALL_API_BASE = 'https://api.scryfall.com';

        const fetchWithRetry = async (url, options = {}, attempts = 0) => {
            try {
                const response = await fetch(url, options);
                if (response.status === 404) return { data: [] }; // No matches - a normal outcome, not a failure, don't retry
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                return response.json();
            } catch (error) {
                if (attempts >= 2) throw error;
                await new Promise(r => setTimeout(r, 500));
                return fetchWithRetry(url, options, attempts + 1);
            }
        };

        // Builder decks now store `commanders: []` (supports Partner pairs); older decks may still have a
        // single `commander` object. This reads a display name that works with either shape.
        const getDeckCommanderDisplayName = (deck) => {
            if (Array.isArray(deck?.commanders) && deck.commanders.length > 0) {
                return deck.commanders.map(c => c.name).join(' & ');
            }
            return deck?.commander?.name || 'Unknown';
        };

        // --- TOKEN-CREATION PARSING ---
        // Best-effort extraction of "create a token" abilities from a card's oracle text, so the
        // right-click menu can offer pre-filled token options instead of always falling back to a
        // blank manual entry. Covers the dominant phrasing patterns ("create a 1/1 white Soldier
        // creature token", "create two 2/2 green Bear creature tokens with flying", common named
        // artifact tokens like Treasure/Clue/Food). Anything more exotic (copy tokens, X-based stats,
        // "equal to" conditions) is intentionally left unparsed - callers should fall back to the
        // manual token modal when this returns an empty array, never guess at unclear text.
        const WORD_TO_NUMBER = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
        const NAMED_ARTIFACT_TOKENS = ['Treasure', 'Clue', 'Food', 'Powerstone', 'Map', 'Blood', 'Incubator', 'Gold', 'Junk', 'Lander', 'Walker', 'Shard', 'Gnome', 'Vial', 'Ticket', 'Scion', 'Saproling', 'Thopter'];
        const COLOR_WORDS = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G', colorless: 'C' };

        // The 7 predefined Role tokens (Comprehensive Rules 111.10j-r). These are Aura enchantment tokens
        // that must be attached to a creature - structurally different from the "[P/T] [color] [type]
        // creature token" pattern the regex parser handles, so they're matched by name instead.
        const ROLE_TOKEN_DEFINITIONS = {
            'Cursed': 'Enchanted creature has base power and toughness 1/1.',
            'Monster': 'Enchanted creature gets +1/+1 and has trample.',
            'Royal': 'Enchanted creature gets +1/+1 and has ward {1}.',
            'Sorcerer': 'Enchanted creature gets +1/+1 and has "Whenever this creature attacks, scry 1."',
            'Wicked': 'Enchanted creature gets +1/+1. When this Aura is put into a graveyard from the battlefield, each opponent loses 1 life.',
            'Young Hero': 'Enchanted creature has "Whenever this creature attacks, if its toughness is 3 or less, put a +1/+1 counter on it."',
            'Virtuous': 'Enchanted creature gets +1/+1 for each enchantment you control.'
        };

        // Predefined emblem/status mechanics with built-in progress tracking. Each entry describes how many
        // stages it has and the text shown at each stage. "The Ring" specifically also requires choosing a
        // Ring-bearer creature each time it advances - handled separately in the UI, not here.
        const EMBLEM_DEFINITIONS = {
            'The Ring': {
                maxStage: 4,
                stageText: [
                    'Your Ring-bearer is legendary and can\'t be blocked by creatures with greater power.',
                    'Whenever your Ring-bearer attacks, draw a card, then discard a card.',
                    'Whenever your Ring-bearer becomes blocked by a creature, that creature\'s controller sacrifices it at the end of combat.',
                    'Whenever your Ring-bearer deals combat damage to a player, each opponent loses 3 life.'
                ],
                requiresBearer: true
            },
            'Max Speed': {
                maxStage: 4,
                stageText: ['Speed 1', 'Speed 2', 'Speed 3', 'Max Speed'],
                requiresBearer: false
            }
        };

        const getOracleTextForParsing = (card) => {
            if (!card) return '';
            if (card.oracle_text) return card.oracle_text;
            if (Array.isArray(card.card_faces)) return card.card_faces.map(f => f.oracle_text || '').join(' ');
            return '';
        };

        // Used to decide where a card played from hand should go: lands go straight to the battlefield,
        // everything else goes onto the shared stack first.
        // Doppelseitige Karten: solange keine Seite gewählt ist (faceIndex fehlt), gilt die Vorderseite. Auf dem
        // Spielfeld trägt die Karte die Felder der angezeigten Seite (withFace); origFace hält die Originalfelder,
        // resetFace stellt sie beim Verlassen des Spielfelds wieder her.
        const curTypeLine = (card) => card?.faceIndex != null ? (card.type_line || '') : ((card?.card_faces?.[0]?.type_line) || (card?.type_line || '').split(' // ')[0]);
        const isLand = (card) => /\bLand\b/i.test(curTypeLine(card));
        const FACE_KEYS = ['name', 'type_line', 'oracle_text', 'power', 'toughness', 'loyalty', 'mana_cost', 'image_url'];
        const hasFaces = (c) => Array.isArray(c?.card_faces) && c.card_faces.length >= 2;
        const faceImg = (c, i) => c?.card_faces?.[i]?.image_uris?.normal || '';
        const withFace = (card, idx) => {
            if (!hasFaces(card)) return card;
            const f = card.card_faces[idx] || card.card_faces[0];
            const orig = card.origFace || Object.fromEntries(FACE_KEYS.filter(k => card[k] !== undefined && card[k] !== null).map(k => [k, card[k]]));
            const out = { ...card, origFace: orig, faceIndex: idx };
            FACE_KEYS.slice(0, 7).forEach(k => { if (f[k] !== undefined && f[k] !== null) out[k] = f[k]; else delete out[k]; });
            out.image_url = faceImg(card, idx) || (idx === 0 ? orig.image_url : '') || orig.image_url || '';
            return out;
        };
        const resetFace = (card) => {
            if (!card || (card.faceIndex == null && !card.origFace)) return card;
            const { origFace, faceIndex, ...rest } = card;
            if (origFace) FACE_KEYS.forEach(k => { if (origFace[k] !== undefined) rest[k] = origFace[k]; else delete rest[k]; });
            return rest;
        };
        // Vorderseite vor dem Betreten des Spielfelds festlegen (Regeltext, Stärke usw. der Seite)
        const frontFace = (card) => (hasFaces(card) && card.faceIndex == null ? withFace(card, 0) : card);
        // Modale doppelseitige Karte mit Land-Rückseite (Agadeem's Awakening, Pathways): Index der Rückseite, sonst null.
        // Ohne layout (alte Kartendaten) gilt: Rückseite ist ein Land und die Vorderseite verwandelt sich nicht.
        const landBackIdx = (card) => {
            if (!hasFaces(card) || card.faceIndex != null) return null;
            const [a, b] = card.card_faces;
            if (!/\bLand\b/i.test(b?.type_line || '')) return null;
            if (card.layout) return card.layout === 'modal_dfc' ? 1 : null;
            return /\btransform/i.test(a?.oracle_text || '') ? null : 1;
        };
        // Bild(er) für die Vorschau: doppelseitige Karten zeigen beide Seiten – die gerade sichtbare zuerst
        const previewOf = (card) => {
            if (hasFaces(card)) {
                const cur = card.faceIndex == null ? (faceImg(card, 0) || card.image_url) : (card.image_url || faceImg(card, card.faceIndex));
                const other = faceImg(card, card.faceIndex === 1 ? 0 : 1) || (card.faceIndex === 1 ? card.origFace?.image_url : '');
                if (cur && other && cur !== other) return [cur, other];
            }
            return card?.image_url || null;
        };
        const cardName = (c) => (c?.faceIndex != null ? (c.name || '') : (c?.name || '').split(' // ')[0]);
        // „Diese Karte kommt getappt ins Spiel“ (ohne „unless“, ohne Wahl wie bei Shocklands)
        const entersTappedSelf = (card) => {
            const t = String(card?.oracle_text || '').replace(/\([^)]*\)/g, '');
            if (!t) return false;
            const nm = cardName(card).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const re = new RegExp(`(?:^|[\\n.]\\s*)(?:this [a-z]+|${nm || '~'}|it) enters(?: the battlefield)? tapped(?! unless)(?! and attacking)`, 'i');
            if (!re.test(t)) return false;
            return !/you may pay \d+ life/i.test(t);
        };
        // „Enchant …“-Zeile einer Aura → erlaubte Ziele
        const parseEnchant = (card) => {
            const m = String(card?.oracle_text || '').match(/^enchant ([^\n(]+)/im);
            const w = (m ? m[1] : 'creature').toLowerCase().trim();
            if (/\b(player|opponent)\b/.test(w) && !/permanent|creature/.test(w)) return { player: true, label: w };
            const ctrl = /you control/.test(w) ? 'me' : /(opponent controls|you don't control)/.test(w) ? 'opp' : null;
            const types = ['creature', 'land', 'artifact', 'enchantment', 'planeswalker'].filter(t => w.includes(t));
            const any = /\bpermanent\b/.test(w) && !types.length;
            return { types, any, nonland: /nonland/.test(w), ctrl, label: w };
        };
        const BASIC_SUBTYPES = ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'];

        // Detects what kind of ETB effect a land has so we can handle it interactively.
        // Returns null for simple lands (basics, Command Tower etc.) or one of:
        //   'shock'   — ETB tapped OR pay 2 life (Hallowed Fountain etc.)
        //   'check'   — ETB tapped UNLESS you control a Plains or Island (Glacial Fortress etc.)
        //   'fast'    — ETB tapped UNLESS you control 2 or fewer other lands (Seachrome Coast etc.)
        //   'slow'    — ETB tapped UNLESS you control 2+ basics (Deserted Beach etc.)
        //   'reveal'  — ETB tapped UNLESS you reveal a Plains or Island from hand (Port Town etc.)
        //   'bounce'  — ETB: return a land you control to hand (Azorius Chancery etc.)
        //   'pain'    — {T}: {1} OR {T}: pay 1 life for colored (Adarkar Wastes etc.)
        //   'scry'    — ETB tapped, then Scry 1 (Temple of Enlightenment etc.)
        //   'surveil' — ETB tapped, then Surveil 1 (Meticulous Archive etc.)
        //   'filter'  — {T}: Pay hybrid mana for double color (Flooded Grove etc.)
        //   'triome'  — ETB tapped, 3 colors/types, Cycling (Ketria Triome etc.)
        const detectLandETB = (card, myBattlefield = [], myHand = []) => {
            if (!isLand(card)) return null;
            const t = (card.oracle_text || '').toLowerCase();
            const tl = (card.type_line || '').toLowerCase();

            // Shock: "as ~ enters, you may pay 2 life. If you don't, ~ enters tapped"
            // (auch ZNR-MDFC-Länder: „you may pay 3 life. If you don't, it enters tapped“)
            if (/you may pay \d+ life/.test(t) && t.includes('enters tapped')) return 'shock';

            // Scry lands: "~ enters the battlefield tapped" + "when ~ enters, scry 1"
            if (t.includes('enters tapped') && t.match(/when [^,]* enters[^,]*, scry/)) return 'scry';

            // Surveil lands: ETB tapped + surveil 1
            if (t.includes('enters tapped') && t.match(/when [^,]* enters[^,]*, surveil/)) return 'surveil';

            // Bounce lands: ETB + return a land to hand
            if (t.includes('enters tapped') && t.includes('return a land you control to its owner') ) return 'bounce';

            // Check lands: ETB tapped unless you control a [type] or [type]
            if (t.match(/enters tapped unless you control an? \w+ or \w+/)) return 'check';

            // Reveal lands: ETB tapped unless you reveal
            if (t.includes('enters tapped') && t.includes('reveal')) return 'reveal';

            // Slow lands: ETB tapped unless you control 2+ basics
            if (t.match(/enters tapped unless you control two or more basic lands/)) return 'slow';

            // Fast lands: ETB tapped unless you control 2 or fewer other lands
            if (t.match(/enters tapped unless you control two or fewer other lands/)) return 'fast';

            // Triome: ETB tapped + cycling + 3 basic land types in type_line
            if (t.includes('cycling') && (tl.match(/— .+ .+ .+/) || t.includes('enters tapped'))) {
                const basicCount = BASIC_SUBTYPES.filter(s => new RegExp(`\\b${s}\\b`, 'i').test(card.type_line || '')).length;
                if (basicCount >= 3) return 'triome';
            }

            // Pain lands: "{T}: Add {1}" + colored option with life
            if (t.match(/\{t\}: add \{c\}|\{t\}: add 1/i) && t.includes('pay 1 life')) return 'pain';

            // Sonst: „This land enters tapped.“ (Gildentore, Triome ohne Zyklen-Erkennung …)
            if (entersTappedSelf(card)) return 'tapped';
            return null;
        };

        // Extracts [power, toughness] from a card, handling both:
        // - card.p_t = "2/3" (tokens, serialized combat data)
        // - card.power + card.toughness as separate Scryfall fields ("2", "3")
        // Returns [0, 0] for non-creatures or missing data.
        // Returns true if a card has the Enduring cycle ability: "When ~ dies, if it was a creature,
        // return it to the battlefield under its owner's control. It's an enchantment."
        const hasEnduringAbility = (card) => {
            const t = (card?.oracle_text || '').toLowerCase();
            return t.includes('dies, if it was a creature') &&
                   t.includes('return it to the battlefield') &&
                   t.includes("it's an enchantment");
        };

        const getPT = (card) => {
            if (!card) return [0, 0];
            if (card.p_t) {
                const parts = card.p_t.split('/');
                return [parseInt(parts[0]) || 0, parseInt(parts[1]) || 0];
            }
            if (card.power !== undefined && card.toughness !== undefined) {
                return [parseInt(card.power) || 0, parseInt(card.toughness) || 0];
            }
            return [0, 0];
        };

        // Returns a "X/Y" string from any card object regardless of storage format.
        const getPTString = (card) => {
            const [p, t] = getPT(card);
            if (p === 0 && t === 0) return '';
            return `${p}/${t}`;
        };

        // ── MANA PARSING ─────────────────────────────────────────────────────────
        const MANA_SYMBOLS = { W:'W', U:'U', B:'B', R:'R', G:'G', C:'C' };
        const ALL_COLORS = ['W','U','B','R','G'];
        const parseManaProduction = (oracleText) => {
            if (!oracleText) return null;
            const t = oracleText;
            // "any color" / "any type" / "one mana of any color" — Command Tower, City of Brass, etc.
            if (/add one mana of any color|adds? mana of any (?:one )?color|add (?:one )?mana of any type/i.test(t)) {
                return { type: 'choice', options: ALL_COLORS };
            }
            // Find "{T}: Add" patterns
            const addMatch = t.match(/\{T\}[^.:\n]*?:\s*[Aa]dd\s*([\{A-Za-z0-9 ,}{}\/\n]+?)(?:\.|$)/);
            if (!addMatch) return null;
            const segment = addMatch[1];
            // "Add {W} or {U}" → choice; "Add {G}{G}" → fixed
            const isChoice = /\bor\b/i.test(segment);
            const symbols = [...segment.matchAll(/\{([WUBRG])\}/g)].map(m => m[1]);
            if (!symbols.length) {
                // Check for colorless {C}
                if (segment.includes('{C}')) return { type: 'fixed', symbols: ['C'] };
                return null;
            }
            if (isChoice || new Set(symbols).size > 1) {
                return { type: 'choice', options: [...new Set(symbols)] };
            }
            return { type: 'fixed', symbols };
        };

        // ── KEYWORD HELPERS ──────────────────────────────────────────────────────
        // All checks read from oracle_text so they work on any card regardless of format.
        const kw = (card, word) => {
            const t = (card?.oracle_text || '') + ' ' + (card?.keywords?.join(' ') || '');
            return t.toLowerCase().includes(word.toLowerCase());
        };
        const hasFlying      = c => kw(c, 'flying');
        const hasReach       = c => kw(c, 'reach');
        const hasMenace      = c => kw(c, 'menace');
        const hasFirstStrike = c => kw(c, 'first strike') || kw(c, 'double strike');
        const hasDoubleStrike= c => kw(c, 'double strike');
        const hasLifelink    = c => kw(c, 'lifelink');
        const hasVigilance   = c => kw(c, 'vigilance');
        const hasHaste       = c => kw(c, 'haste');
        const hasDefender    = c => kw(c, 'defender');
        const hasShroud      = c => kw(c, 'shroud');
        const hasHexproof    = c => kw(c, 'hexproof');
        const hasProtection  = c => kw(c, 'protection from');
        const hasWard        = c => kw(c, 'ward');
        const hasInfect      = c => kw(c, 'infect');
        const hasToxic       = c => kw(c, 'toxic');
        const hasUndying     = c => kw(c, 'undying');
        const hasPersist     = c => kw(c, 'persist');
        const hasExalted     = c => kw(c, 'exalted');
        const hasWither      = c => kw(c, 'wither');

        // Can `blocker` legally block `attacker`?
        const canLegallyBlock = (attacker, blocker) => {
            if (hasDefender(attacker)) return false; // defenders can't attack, but just in case
            // Flying: can only be blocked by flying or reach
            if (hasFlying(attacker) && !hasFlying(blocker) && !hasReach(blocker)) return false;
            // Menace: must be blocked by 2+ creatures — handled in UI (can't enforce count here per card)
            return true;
        };

        // Returns the list of valid blockers from `myCreatures` for a given `attacker`.
        const validBlockers = (attacker, myCreatures) =>
            myCreatures.filter(c => !c.isTapped && canLegallyBlock(attacker, c));
        // Parses oracle_text into a list of recognized triggers. Each trigger has:
        //   event: what fires it ('etb'|'cast_instant_or_sorcery'|'dies'|'attacks')
        //   effect: what it does ('damage_each_opp'|'draw'|'gain_life'|'create_token'|'add_counter')
        //   amount: numeric value if relevant
        //   notify: fallback text if we can't auto-execute
        const parseTriggers = (card) => {
            const text = card?.oracle_text || '';
            if (!text) return [];
            const triggers = [];
            const lines = text.split(/\n/);

            for (const line of lines) {
                const t = line.toLowerCase();
                // „Whenever you cast …“ erledigt castTriggersFor (mit Filter/Manawert, direkt über dem Zauber)
                if (/^\s*(?:[a-z][a-z' ]*\s+[—–-]\s+)?whenever you cast\b/.test(t)) continue;

                // Determine trigger event
                let event = null;
                if (t.match(/when(?:ever)? [^,]* enters(?: the battlefield)?/)) event = 'etb';
                else if (t.match(/whenever you cast an? (?:instant or sorcery|instant|sorcery)/)) event = 'cast_instant_or_sorcery';
                else if (t.match(/when(?:ever)? [^,]* (?:dies|is put into a graveyard from the battlefield)/)) event = 'dies';
                else if (t.match(/whenever [^,]* attacks/)) event = 'attacks';
                else if (t.match(/whenever you draw a card/)) event = 'draw_card';
                else if (t.match(/whenever you gain life/)) event = 'gain_life_trigger';
                else if (t.match(/whenever (?:another )?(?:a )?creature (?:you control )?dies/)) event = 'creature_dies';
                else if (t.match(/whenever a land enters the battlefield under your control|whenever you play a land|landfall/)) event = 'landfall';
                if (!event) continue;

                // Determine effect
                const dmgMatch = t.match(/deals? (\d+) damage to (?:each opponent|each player)/);
                const drawMatch = t.match(/(?:you )?draw (?:a|(\d+)) card/);
                const lifeMatch = t.match(/(?:you )?gain (\d+) life/);
                const loseMatch = t.match(/(?:each opponent|each player) (?:loses?) (\d+) life/);
                const counterMatch = t.match(/put (?:a|(\d+)) \+1\/\+1 counter/);

                if (dmgMatch) {
                    triggers.push({ event, effect: 'damage_each_opp', amount: parseInt(dmgMatch[1]), source: card.name });
                } else if (drawMatch) {
                    triggers.push({ event, effect: 'draw', amount: parseInt(drawMatch[1] || '1'), source: card.name });
                } else if (lifeMatch) {
                    triggers.push({ event, effect: 'gain_life', amount: parseInt(lifeMatch[1]), source: card.name });
                } else if (loseMatch) {
                    triggers.push({ event, effect: 'opp_lose_life', amount: parseInt(loseMatch[1]), source: card.name });
                } else if (counterMatch) {
                    triggers.push({ event, effect: 'add_counter', amount: parseInt(counterMatch[1] || '1'), source: card.name });
                } else {
                    // Can't auto-execute — store as notification-only
                    const shortLine = line.length > 80 ? line.slice(0, 77) + '...' : line;
                    triggers.push({ event, effect: 'notify', text: shortLine, source: card.name });
                }
            }
            return triggers;
        };

        // Effektive Stärke/Widerstand: Grundwerte plus +1/+1- und minus -1/-1-Marker (für Kampf und Anzeige)
        const counterSum = (card, type) => (card?.counters || []).filter(c => c.type === type).reduce((s, c) => s + (Number(c.count) || 0), 0);
        const effectivePT = (card) => {
            const [p, t] = getPT(card);
            const d = counterSum(card, '+1/+1') - counterSum(card, '-1/-1');
            return [p + d, t + d];
        };
        const hasPTData = (card) => !!(card && (card.p_t || (card.power !== undefined && card.power !== null) || (card.toughness !== undefined && card.toughness !== null)));

        // Manawert des gewirkten Zaubers (gewählte Seite einer doppelseitigen Karte, sonst cmc bzw. Manakosten)
        const manaCostValue = (cost) => [...String(cost || '').matchAll(/\{([^}]+)\}/g)].reduce((s, [, x]) => s + (/^\d+$/.test(x) ? Number(x) : /^[XYZ]$/i.test(x) ? 0 : 1), 0);
        const manaValueOf = (card) => {
            if (!card) return 0;
            if (card.faceIndex != null && card.mana_cost) return manaCostValue(card.mana_cost);
            if (card.cmc !== undefined && card.cmc !== null && !isNaN(Number(card.cmc))) return Number(card.cmc);
            return manaCostValue(card.mana_cost || card.card_faces?.[0]?.mana_cost || '');
        };
        const spellColorsOf = (card) => {
            const cost = card?.faceIndex != null ? card?.mana_cost : (card?.mana_cost || card?.card_faces?.[0]?.mana_cost);
            const fromCost = [...new Set([...String(cost || '').matchAll(/\{([^}]+)\}/g)].flatMap(([, x]) => (x.match(/[WUBRG]/g) || [])))];
            return fromCost.length ? fromCost : (Array.isArray(card?.colors) ? card.colors : []);
        };

        // Einfache Effekte aus einem Regeltext-Satz: Schaden an jeden Gegner, Leben, Karten ziehen, Token.
        // Bedingte/optionale Sätze („if“, „you may“) werden nicht automatisch ausgeführt (nur Erinnerung).
        const WORD_NUM = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
        const toNum = (x) => /^\d+$/.test(x) ? Number(x) : (WORD_NUM[String(x).toLowerCase()] || 0);
        const parseSimpleEffects = (text) => {
            const t = String(text || '').toLowerCase();
            if (!t || /\byou may\b|\bif\b|\bunless\b|\bx\b/.test(t)) return [];
            const out = [];
            let m;
            if ((m = t.match(/deals? (\d+|one|two|three|four|five) damage to each opponent/))) out.push({ effect: 'damage_each_opp', amount: toNum(m[1]) });
            if ((m = t.match(/each opponent loses (\d+|one|two|three|four|five) life/))) out.push({ effect: 'opp_lose_life', amount: toNum(m[1]) });
            if ((m = t.match(/(?:^|\band |, |\. )(?:you )?gain (\d+|one|two|three|four|five) life/))) out.push({ effect: 'gain_life', amount: toNum(m[1]) });
            if ((m = t.match(/(?:^|\band |, |\. |\bthen )(?:you )?draw (a|an|one|two|three|four|five|\d+) cards?/))) out.push({ effect: 'draw', amount: toNum(m[1]) || 1 });
            if (/\bcreate\b[^.]*\btokens?\b/.test(t)) out.push({ effect: 'token', amount: 0 });
            return out.filter(e => e.effect === 'token' || e.amount > 0);
        };
        const EFFECT_LABEL = { damage_each_opp: (n) => `${n} Schaden an jeden Gegner`, opp_lose_life: (n) => `jeder Gegner verliert ${n} Leben`, gain_life: (n) => `+${n} Leben`, draw: (n) => `zieht ${n} Karte${n > 1 ? 'n' : ''}`, token: () => 'Token' };

        // „Whenever you cast a <Filter> spell [with mana value N or greater], <Effekt>“ eines Permanents → passt `spell`?
        // Filter: noncreature, creature, instant or sorcery, instant, sorcery, artifact, enchantment, planeswalker,
        // legendary, historic, multicolored, colorless, Farben, leer („a spell“). Unbekannte Filter lösen nicht aus.
        const CAST_TRIGGER_RE = /^whenever you cast (?:an? )?(.*?)\bspells?\b(?: with (?:mana value|converted mana cost) (\d+) or (greater|more|less|fewer))?\s*,\s*(.+)$/i;
        const COLOR_WORD = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' };
        const spellWordOk = (w, tl, colors) => {
            const has = (x) => new RegExp(`\\b${x}\\b`, 'i').test(tl);
            if (w.startsWith('non')) { const r = spellWordOk(w.slice(3).replace(/^-/, ''), tl, colors); return r === null ? null : !r; }
            if (['creature', 'instant', 'sorcery', 'artifact', 'enchantment', 'planeswalker', 'legendary', 'land', 'battle', 'tribal', 'kindred'].includes(w)) return has(w);
            if (w === 'historic') return has('artifact') || has('legendary') || has('saga');
            if (w === 'multicolored') return colors.length > 1;
            if (w === 'monocolored') return colors.length === 1;
            if (w === 'colorless') return colors.length === 0;
            if (COLOR_WORD[w]) return colors.includes(COLOR_WORD[w]);
            return null;
        };
        const spellFilterOk = (filter, spell) => {
            const f = String(filter || '').toLowerCase().replace(/,/g, ' ').trim();
            if (!f) return true;
            const tl = curTypeLine(spell), colors = spellColorsOf(spell);
            let unknown = false;
            const ok = f.split(/\s+or\s+/).some(alt => alt.split(/\s+/).filter(Boolean).every(w => { const r = spellWordOk(w, tl, colors); if (r === null) unknown = true; return r === true; }));
            return unknown ? false : ok;
        };

        // Used to decide how a permanent attaches to another card. Auras are dragged off the stack onto
        // any creature (even an opponent's); Equipment is dragged from one's own battlefield onto one's own
        // creature. A card could in principle be both (rare), in which case Aura takes priority since it's
        // the more common "must attach immediately" case.
        const isAuraCard = (card) => /\bAura\b/i.test(curTypeLine(card));
        const isEquipmentCard = (card) => /\bEquipment\b/i.test(curTypeLine(card));
        const isCreatureLike = (card) => /\bCreature\b/i.test(curTypeLine(card)) || (card?.isToken && card?.p_t);

        // Classifies a card into one of 5 battlefield "neighborhoods" used to decide where it spawns when
        // played, so creatures/lands/artifacts/enchantments/planeswalkers don't all pile up in the same spot.
        // Priority for multi-type cards (e.g. "Artifact Creature", "Land Creature"): Land first (lands are
        // their own clearly-separate thing even when animated), then Creature (the most common and most
        // important-to-see type), then Planeswalker, then Artifact, then Enchantment as the catch-all.
        const getCardZoneType = (card) => {
            const typeLine = curTypeLine(card);
            if (/\bLand\b/i.test(typeLine)) return 'land';
            if (isCreatureLike(card)) return 'creature';
            if (/\bPlaneswalker\b/i.test(typeLine)) return 'planeswalker';
            if (/\bArtifact\b/i.test(typeLine)) return 'artifact';
            if (/\bEnchantment\b/i.test(typeLine)) return 'enchantment';
            return 'creature'; // Fallback for anything unrecognized (e.g. a custom token with no type_line) - the biggest zone.
        };

        // Finds every commander belonging to a given player's state, wherever it currently is (command
        // zone, battlefield, graveyard, exile - isCommander/instanceId survive every zone change). Used
        // to drive the per-commander damage counters: a Partner pair gives 2 entries here, a single
        // commander gives 1, and the list stays correct even after a commander dies and comes back to
        // the command zone, since instanceId never changes.
        const getCommandersOf = (state) => {
            if (!state) return [];
            const zones = [state.commandZone, state.battlefieldUpper, state.battlefieldLower, state.graveyard, state.exile];
            const found = [];
            const seen = new Set();
            zones.forEach(zone => (zone || []).forEach(card => {
                if (card.isCommander && !seen.has(card.instanceId)) {
                    seen.add(card.instanceId);
                    found.push(card);
                }
            }));
            return found;
        };


        // Does this card's oracle text contain a DIRECT token-creation effect (something the card itself
        // does), as opposed to a replacement effect that only modifies other token-creation events (e.g.
        // Academy Manufactor's "if you would create... instead", or Chatterfang's "tokens would be created
        // ... are created instead")? Those cards never create a token on their own, so they shouldn't offer
        // a "Token erstellen" option at all - there's nothing for the button to actually make.
        // Also matches all word forms (create/creates/created), not just the bare infinitive.
        const cardCreatesTokensDirectly = (card) => {
            const text = getOracleTextForParsing(card);
            if (!text || !/\bcreate[sd]?\b/i.test(text) || !/\btoken/i.test(text)) return false;
            // Strip out replacement-effect clauses ("if you would create...instead", "would be created...instead",
            // "would create...instead") before checking for a remaining direct "create a/an/two/... token" clause.
            const withoutReplacementClauses = text.replace(/\bif\b[^.]*?\bwould\b[^.]*?\binstead\b\.?/gi, '');
            return /\bcreate[sd]?\b[^.]*?\btoken/i.test(withoutReplacementClauses);
        };

        const parseTokensFromOracleText = (card) => {
            const text = getOracleTextForParsing(card);
            if (!cardCreatesTokensDirectly(card)) return [];

            const found = [];
            const seen = new Set(); // de-dupe identical token specs mentioned more than once

            const addToken = (token) => {
                const key = `${token.name}|${token.stats}|${token.colors.join(',')}`;
                if (seen.has(key)) return;
                seen.add(key);
                found.push(token);
            };

            // Pattern 1: "[qty] [P/T] [color(s)] [Type(s)] creature token(s) [with Keyword]", anywhere in a
            // sentence that contains "create" - this also catches comma-separated lists like "create a 1/1
            // white Human creature token, a 1/1 blue Merfolk creature token, and a 1/1 red Goblin creature
            // token" where only the very first item directly follows the word "create".
            const creatureTokenRegex = /\b(a|an|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:tapped\s+)?(\d+\/\d+)\s+((?:white|blue|black|red|green|colorless)(?:\s+and\s+(?:white|blue|black|red|green|colorless))*)\s+([A-Z][a-zA-Z]*(?:\s+[A-Z][a-zA-Z]*)*?)\s+(?:artifact\s+|enchantment\s+)?creature\s+tokens?(?:\s+named\s+[A-Z][a-zA-Z]*)?(?:\s+with\s+((?:[a-z]+[, ]*){1,4}?)(?=\.|,|\(|"|;|\s+(?:and|then|before|that|until|unless)\b|$))?/gi;
            let m;
            while ((m = creatureTokenRegex.exec(text)) !== null) {
                // Only count this as a token-creation effect if "create" appears somewhere earlier in the
                // same sentence (not necessarily immediately before this particular match).
                const sentenceStart = text.lastIndexOf('.', m.index) + 1;
                const precedingText = text.slice(sentenceStart, m.index);
                if (!/\bcreates?\b/i.test(precedingText) && !/^create\b/i.test(text.slice(m.index))) continue;

                const qty = WORD_TO_NUMBER[m[1].toLowerCase()] || 1;
                const stats = m[2];
                const colorWords = m[3].toLowerCase().split(/\s+and\s+/).map(w => w.trim());
                const colors = colorWords.map(w => COLOR_WORDS[w]).filter(Boolean);
                const typeLine = m[4].trim();
                const abilityText = m[5] ? m[5].trim().replace(/\s+/g, ' ') : null;
                addToken({
                    name: typeLine,
                    stats,
                    colors: colors.length ? colors : ['C'],
                    quantity: qty,
                    ability: abilityText
                });
            }

            // Pattern 2: named non-creature artifact tokens, e.g. "create a Treasure token", "create three Clue tokens"
            NAMED_ARTIFACT_TOKENS.forEach(tokenName => {
                const re = new RegExp(`create\\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten)\\s+(?:tapped\\s+)?${tokenName}\\s+tokens?`, 'gi');
                let nm;
                while ((nm = re.exec(text)) !== null) {
                    const qty = WORD_TO_NUMBER[nm[1].toLowerCase()] || 1;
                    addToken({
                        name: tokenName,
                        stats: null,
                        colors: ['C'],
                        quantity: qty,
                        ability: null
                    });
                }
            });

            // Pattern 3: the 7 predefined Role tokens, e.g. "create a Royal Role token", "create a Cursed
            // Role token attached to that creature". These are Aura enchantment tokens (not creature tokens),
            // so they're flagged with isAura/isRole - the UI uses that to ask which creature to enchant
            // instead of just dropping the token loose on the battlefield.
            Object.keys(ROLE_TOKEN_DEFINITIONS).forEach(roleName => {
                const re = new RegExp(`create\\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten)?\\s*${roleName}\\s+Role\\s+tokens?`, 'gi');
                let rm;
                while ((rm = re.exec(text)) !== null) {
                    const qty = rm[1] ? (WORD_TO_NUMBER[rm[1].toLowerCase()] || 1) : 1;
                    addToken({
                        name: `${roleName} Role`,
                        stats: null,
                        colors: ['C'],
                        quantity: qty,
                        ability: ROLE_TOKEN_DEFINITIONS[roleName],
                        isAura: true,
                        isRole: true
                    });
                }
            });

            return found;
        };

        const CardImage = ({ src, alt, className, style, onClick, onContextMenu, onMouseEnter, onMouseLeave, isBack = false }) => {
            const imageSrc = isBack ? null : src;
            return (
                <div 
                    className={`relative rounded-lg overflow-hidden bg-gray-800 ${className}`} 
                    style={style}
                    onClick={onClick}
                    onContextMenu={onContextMenu}
                    onMouseEnter={onMouseEnter}
                    onMouseLeave={onMouseLeave}
                >
                    {imageSrc
                        ? <img src={imageSrc} alt={alt || ''} className="w-full h-full object-cover select-none pointer-events-none" />
                        : <div className={isBack ? 'arena-cardback' : 'arena-noimg'}>{!isBack && (alt || '')}</div>}
                    {!isBack && <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-white/5 to-white/10 pointer-events-none"></div>}
                </div>
            );
        };

        const Modal = ({ isOpen, onClose, title, children }) => {
            if (!isOpen) return null;
            return (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
                    <div className="bg-gray-800 border border-gray-600 rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col">
                        <div className="flex justify-between items-center p-4 border-b border-gray-700">
                            <h3 className="text-xl font-bold text-yellow-400">{title}</h3>
                            <button onClick={onClose} className="text-gray-400 hover:text-white">
                                <Icon name="x" className="w-6 h-6" />
                            </button>
                        </div>
                        <div className="p-4 overflow-y-auto flex-grow">
                            {children}
                        </div>
                    </div>
                </div>
            );
        };

        // Mandatory mulligan popup: the hand area itself is "pulled" to the center of the screen.
        // No dismiss button - the player must either mulligan or keep, and if bottoming cards is
        // required, pick exactly that many before the step is considered complete.
        const MulliganModal = ({ hand, seatNumber, cardsToBottom, isBottoming, bottomingSelection, onToggleBottomSelection, onMulligan, onKeep, onConfirmBottom, onHoverCard, onLeaveCard }) => {
            return (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 backdrop-blur-sm p-4">
                    <div className="bg-gray-800 border-2 border-yellow-500/60 rounded-xl shadow-2xl w-full max-w-3xl p-6 flex flex-col items-center gap-4">
                        <h2 className="text-2xl font-bold text-yellow-400">Du bist Spieler {seatNumber}</h2>
                        {!isBottoming ? (
                            <>
                                <p className="text-gray-300 text-sm">Deine Starthand:</p>
                                <div className="flex gap-2 justify-center overflow-x-auto max-w-full pb-1">
                                    {hand.map(card => (
                                        <img key={card.instanceId} src={card.image_url} alt={card.name}
                                            className="w-24 flex-shrink-0 rounded shadow-lg border border-gray-600 cursor-pointer"
                                            onMouseEnter={() => onHoverCard?.(card.image_url)}
                                            onMouseLeave={() => onLeaveCard?.()}
                                        />
                                    ))}
                                </div>
                                <div className="flex gap-4 mt-2">
                                    <button onClick={onMulligan} className="bg-red-600 hover:bg-red-500 text-white font-bold px-6 py-3 rounded-lg shadow-lg">Mulligan</button>
                                    <button onClick={onKeep} className="bg-green-600 hover:bg-green-500 text-white font-bold px-6 py-3 rounded-lg shadow-lg">Hand behalten</button>
                                </div>
                            </>
                        ) : (
                            <>
                                <p className="text-gray-300 text-sm text-center">
                                    Wähle {cardsToBottom} Karte{cardsToBottom > 1 ? 'n' : ''}, die unter deine Bibliothek kommt{cardsToBottom > 1 ? 'en' : ''}.
                                    <br/>Ausgewählt: {bottomingSelection.length}/{cardsToBottom}
                                </p>
                                <div className="flex gap-2 flex-wrap justify-center">
                                    {hand.map(card => {
                                        const selected = bottomingSelection.includes(card.instanceId);
                                        return (
                                            <img 
                                                key={card.instanceId} 
                                                src={card.image_url} 
                                                alt={card.name}
                                                onClick={() => onToggleBottomSelection(card.instanceId)}
                                                onMouseEnter={() => onHoverCard?.(card.image_url)}
                                                onMouseLeave={() => onLeaveCard?.()}
                                                className={`w-24 rounded shadow-lg cursor-pointer transition-all ${selected ? 'border-4 border-red-500 -translate-y-2 opacity-50' : 'border border-gray-600'}`}
                                            />
                                        );
                                    })}
                                </div>
                                <button 
                                    onClick={onConfirmBottom} 
                                    disabled={bottomingSelection.length !== cardsToBottom}
                                    className={`mt-2 font-bold px-6 py-3 rounded-lg shadow-lg ${bottomingSelection.length === cardsToBottom ? 'bg-green-600 hover:bg-green-500 text-white' : 'bg-gray-700 text-gray-500 cursor-not-allowed'}`}
                                >
                                    Bestätigen
                                </button>
                            </>
                        )}
                    </div>
                </div>
            );
        };

        // Aktion vor Spielbeginn: Ja/Nein für alle, sobald alle Mulligans fertig sind. Erkannte Karten der Starthand
        // (Leylines, Gemstone Caverns, Chancellors …) werden gelistet; nach „Ja“ lassen sie sich direkt ausführen.
        const PregameActionModal = ({ onAnswer, candidates = [], hand = [], onPerform, onExileFromHand, isStartingPlayer = false }) => {
            const [stage, setStage] = useState('ask'); // 'ask' | 'act' | { exileFor: card }
            const [done, setDone] = useState({});
            const btn = 'font-bold px-3 py-1.5 rounded text-xs shadow';
            const label = (a) => a.type === 'battlefield' ? (a.counter ? `Aufs Spielfeld (${COUNTER_DE[a.counter] || a.counter}-Marker)` : 'Aufs Spielfeld') : a.type === 'reveal' ? 'Aufdecken' : null;
            return (
                <div data-testid="pregame-modal" className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 backdrop-blur-sm p-4">
                    <div className="bg-gray-800 border-2 border-yellow-500/60 rounded-xl shadow-2xl w-full max-w-lg p-6 flex flex-col items-center gap-4">
                        {stage === 'ask' && <>
                            <h2 className="text-xl font-bold text-yellow-400 text-center">Hast du eine Aktion vor Spielbeginn?</h2>
                            <p className="text-gray-400 text-sm text-center">z. B. eine Fähigkeit, die vor dem eigentlichen Spielbeginn wirkt (Leylines, Companions …).</p>
                            {candidates.length > 0 && <p className="text-yellow-200 text-xs text-center">In deiner Starthand: {candidates.map(c => cardName(c.card)).join(', ')}</p>}
                            <div className="flex gap-4 mt-2">
                                <button onClick={() => (candidates.length ? setStage('act') : onAnswer(true))} className="bg-yellow-600 hover:bg-yellow-500 text-white font-bold px-6 py-3 rounded-lg shadow-lg">Ja</button>
                                <button onClick={() => onAnswer(false)} className="bg-gray-600 hover:bg-gray-500 text-white font-bold px-6 py-3 rounded-lg shadow-lg">Nein</button>
                            </div>
                        </>}
                        {stage === 'act' && <>
                            <h2 className="text-lg font-bold text-yellow-400 text-center">Aktionen vor Spielbeginn</h2>
                            <div className="flex flex-col gap-2 w-full max-h-[55vh] overflow-y-auto">
                                {candidates.map(({ card, action }) => (
                                    <div key={card.instanceId} className="flex items-center gap-3 bg-gray-900/60 rounded-lg p-2 border border-solid border-yellow-700/40">
                                        <img src={card.image_url} alt={cardName(card)} className="w-14 rounded" />
                                        <div className="flex-1 min-w-0">
                                            <div className="text-yellow-200 text-sm font-bold truncate">{cardName(card)}</div>
                                            <div className="text-gray-400 text-[10px] leading-snug">{action.sentence}</div>
                                        </div>
                                        {done[card.instanceId] ? <span className="text-green-400 text-xs font-bold">✓ erledigt</span>
                                            : (isStartingPlayer && /not the starting player/i.test(action.sentence)) ? <span className="text-gray-500 text-[10px] text-right">nur, wenn du nicht beginnst</span>
                                            : label(action) ? <button onClick={() => { setDone(d => ({ ...d, [card.instanceId]: true })); onPerform(card, action); if (action.exileFromHand) setStage({ exileFor: card }); }} className={`${btn} bg-yellow-600 hover:bg-yellow-500 text-white`}>{label(action)}</button>
                                            : <span className="text-gray-500 text-[10px]">von Hand</span>}
                                    </div>
                                ))}
                            </div>
                            <button onClick={() => onAnswer(true)} className="bg-green-600 hover:bg-green-500 text-white font-bold px-6 py-2.5 rounded-lg shadow-lg">Fertig</button>
                        </>}
                        {stage?.exileFor && <>
                            <h2 className="text-lg font-bold text-yellow-400 text-center">{cardName(stage.exileFor)}: eine Handkarte ins Exil</h2>
                            <div className="flex gap-2 flex-wrap justify-center max-h-[55vh] overflow-y-auto">
                                {hand.filter(c => c.instanceId !== stage.exileFor.instanceId).map(c => (
                                    <img key={c.instanceId} src={c.image_url} alt={cardName(c)} title={cardName(c)} data-testid="pregame-exile-pick"
                                        onClick={() => { onExileFromHand(c); setStage('act'); }}
                                        className="w-20 rounded shadow-lg border border-solid border-gray-600 hover:border-yellow-400 cursor-pointer" />
                                ))}
                            </div>
                        </>}
                    </div>
                </div>
            );
        };
        const COUNTER_DE = { luck: 'Glück', charge: 'Ladung', oil: 'Öl', shield: 'Schild', stun: 'Betäubung' };

        // Commander-Regel 903.9: Commander liegt bereits in der Zielzone – zurück in die Commander-Zone (Standard) oder dort lassen?
        const CMD_ZONE_TO = { graveyard: 'in den Friedhof', exile: 'ins Exil', hand: 'auf die Hand', library: 'in die Bibliothek' };
        const CommanderChoiceModal = ({ entry, card, onChoose }) => {
            // Mehrere Commander nacheinander (Partner): der Klick/das Enter, das die vorige Frage beantwortet hat, darf
            // nicht gleich die nächste beantworten – kurz nach dem Erscheinen werden Eingaben ignoriert.
            const shownAt = useRef(Date.now());
            const choose = (toCmd) => { if (Date.now() - shownAt.current < 400) return; onChoose(toCmd); };
            // Leertaste ist am Tisch „Weiter“ – sie soll hier nicht versehentlich den fokussierten Standard-Button auslösen (Enter schon)
            const noSpace = (e) => { if (e.key === ' ' || e.code === 'Space') e.preventDefault(); };
            return (
            <div data-testid="cmd-choice" style={{ zIndex: 650 }} onKeyDown={noSpace} onKeyUp={noSpace} className="fixed inset-0 flex items-center justify-center bg-black/80 p-4">
                <div className="bg-gray-900 border-2 border-solid border-yellow-500/70 rounded-xl shadow-2xl w-full max-w-md p-5 flex flex-col items-center gap-3">
                    {card?.image_url && <img src={card.image_url} alt={entry.name} className="w-28 rounded shadow-lg border border-solid border-yellow-600/60" />}
                    <h2 className="text-lg font-bold text-yellow-400 text-center">Commander {entry.name}: In die Commander-Zone oder {CMD_ZONE_TO[entry.zone] || entry.zone}?</h2>
                    <p className="text-gray-400 text-xs text-center">Commander-Regel: Du darfst deinen Commander statt {CMD_ZONE_TO[entry.zone] || entry.zone} in die Commander-Zone legen.</p>
                    <div className="flex gap-3 mt-1">
                        <button autoFocus onClick={() => choose(true)} className="bg-yellow-500 hover:bg-yellow-400 text-gray-950 font-bold px-5 py-2.5 rounded-lg shadow-lg">Commander-Zone</button>
                        <button onClick={() => choose(false)} className="bg-gray-700 hover:bg-gray-600 text-white font-bold px-5 py-2.5 rounded-lg">{CMD_ZONE_LABEL[entry.zone] || entry.zone}</button>
                    </div>
                </div>
            </div>
            );
        };

        // Shown to a player who just received an Aura token (e.g. a Role) and needs to pick which of their
        // own creatures it enchants. Auras can't just sit loose on the battlefield like a normal token.
        const AuraAttachModal = ({ tokenSpec, myCreatures, onAttach, onCancel }) => (
            <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 backdrop-blur-sm p-4">
                <div className="bg-gray-800 border-2 border-purple-500/60 rounded-xl shadow-2xl w-full max-w-lg p-6 flex flex-col items-center gap-4">
                    <h2 className="text-xl font-bold text-purple-300 text-center">Attach {tokenSpec.name} to which creature?</h2>
                    <p className="text-gray-400 text-xs text-center">{tokenSpec.ability}</p>
                    {myCreatures.length === 0 ? (
                        <p className="text-gray-500 text-sm">Du hast keine Kreatur, an die das angelegt werden kann.</p>
                    ) : (
                        <div className="flex gap-2 flex-wrap justify-center max-h-[50vh] overflow-y-auto">
                            {myCreatures.map(({ card, zone }) => (
                                <img 
                                    key={card.instanceId}
                                    src={card.image_url}
                                    alt={card.name}
                                    title={card.name}
                                    onClick={() => onAttach(card, zone)}
                                    className="w-20 rounded shadow-lg border border-gray-600 hover:border-purple-400 cursor-pointer transition-colors"
                                />
                            ))}
                        </div>
                    )}
                    <button onClick={onCancel} className="bg-gray-600 hover:bg-gray-500 text-white text-sm font-bold px-4 py-2 rounded-lg mt-2">Abbrechen</button>
                </div>
            </div>
        );

        // Lets a player create predefined emblems (The Ring, Max Speed) with automatic stage tracking, or a
        // freeform emblem for anything else (most Planeswalker emblems). Existing emblems show their current
        // stage/text and an "Weiter" button. The Ring also needs onRingAdvance to separately prompt for a
        // Ring-bearer afterward instead of advancing immediately.
        const EmblemModal = ({ isOpen, onClose, emblems, onCreate, onAdvance, onRingAdvance }) => {
            const [customName, setCustomName] = useState('');
            const [customText, setCustomText] = useState('');

            if (!isOpen) return null;
            const predefinedNames = Object.keys(EMBLEM_DEFINITIONS);

            return (
                <Modal isOpen={isOpen} onClose={onClose} title="Embleme">
                    <div className="flex flex-col gap-4">
                        {emblems.length > 0 && (
                            <div className="flex flex-col gap-2">
                                <h4 className="text-sm font-bold text-gray-300">Deine Embleme</h4>
                                {emblems.map(e => (
                                    <div key={e.instanceId} className="bg-gray-900/60 p-3 rounded-lg border border-indigo-500/40">
                                        <div className="flex justify-between items-center mb-1">
                                            <span className="text-indigo-300 font-bold text-sm">{e.name}</span>
                                            <span className="text-xs text-gray-400">Stage {e.stage}/{e.maxStage}</span>
                                        </div>
                                        {e.stage > 0 && <p className="text-xs text-gray-400 mb-2">{e.stageText[e.stage - 1]}</p>}
                                        {e.stage < e.maxStage && (
                                            <button 
                                                onClick={() => e.requiresBearer ? onRingAdvance(e) : onAdvance(e.instanceId)} 
                                                className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold px-3 py-1.5 rounded"
                                            >
                                                {e.requiresBearer ? 'Der Ring versucht dich erneut …' : 'Weiter'}
                                            </button>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}

                        <div className="flex flex-col gap-2 border-t border-gray-700 pt-4">
                            <h4 className="text-sm font-bold text-gray-300">Neues Emblem</h4>
                            <div className="flex gap-2 flex-wrap">
                                {predefinedNames.map(name => (
                                    <button 
                                        key={name}
                                        onClick={() => onCreate(name)}
                                        disabled={emblems.some(e => e.name === name)}
                                        className="bg-indigo-700 hover:bg-indigo-600 disabled:bg-gray-700 disabled:text-gray-500 disabled:cursor-not-allowed text-white text-xs font-bold px-3 py-2 rounded"
                                    >
                                        {name}
                                    </button>
                                ))}
                            </div>
                            <div className="flex gap-2 mt-2">
                                <input 
                                    type="text" 
                                    value={customName} 
                                    onChange={e => setCustomName(e.target.value)} 
                                    placeholder="Name des Emblems" 
                                    className="bg-gray-700 border border-gray-600 p-2 rounded text-white text-sm flex-1" 
                                />
                            </div>
                            <textarea 
                                value={customText} 
                                onChange={e => setCustomText(e.target.value)} 
                                placeholder="Text des Emblems (z. B. Effekt eines Planeswalker-Emblems)" 
                                className="bg-gray-700 border border-gray-600 p-2 rounded text-white text-sm w-full h-20"
                            />
                            <button 
                                onClick={() => { if (customName.trim()) { onCreate(customName.trim(), customText.trim()); setCustomName(''); setCustomText(''); } }}
                                className="bg-gray-600 hover:bg-gray-500 text-white text-xs font-bold px-3 py-2 rounded"
                            >
                                Eigenes Emblem erstellen
                            </button>
                        </div>
                    </div>
                </Modal>
            );
        };

        // Shown when "the Ring tempts you" happens: lets the player pick which creature becomes (or
        // remains) their Ring-bearer as the emblem advances. Skippable if they control no creatures,
        // matching the real rule that the Ring still advances even with nothing to designate.
        const RingBearerModal = ({ myCreatures, currentBearerId, onChoose, onSkip }) => (
            <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 backdrop-blur-sm p-4">
                <div className="bg-gray-800 border-2 border-yellow-600/60 rounded-xl shadow-2xl w-full max-w-lg p-6 flex flex-col items-center gap-4">
                    <h2 className="text-xl font-bold text-yellow-400 text-center">Der Ring versucht dich …</h2>
                    <p className="text-gray-400 text-xs text-center">Wähle eine Kreatur als Ringträger.</p>
                    {myCreatures.length === 0 ? (
                        <p className="text-gray-500 text-sm">Du hast keine Kreaturen – der Ring rückt trotzdem vor.</p>
                    ) : (
                        <div className="flex gap-2 flex-wrap justify-center max-h-[50vh] overflow-y-auto">
                            {myCreatures.map(({ card }) => (
                                <img 
                                    key={card.instanceId}
                                    src={card.image_url}
                                    alt={card.name}
                                    title={card.name}
                                    onClick={() => onChoose(card.instanceId)}
                                    className={`w-20 rounded shadow-lg cursor-pointer transition-colors ${card.instanceId === currentBearerId ? 'border-4 border-yellow-400' : 'border border-gray-600 hover:border-yellow-400'}`}
                                />
                            ))}
                        </div>
                    )}
                    <button onClick={onSkip} className="bg-gray-600 hover:bg-gray-500 text-white text-sm font-bold px-4 py-2 rounded-lg mt-2">
                        {myCreatures.length === 0 ? 'Weiter' : 'Überspringen (ohne Wahl weiter)'}
                    </button>
                </div>
            </div>
        );

        // Shown only to seat #1 once mulligans + pregame answers are all in - tells them who has a
        // pregame action pending so they know whether it's safe to take the first turn yet.
        // Fetch Land Modal — shows all valid library targets for a fetch ability.
        // Supports selecting 1 or 2 cards (count from parseFetchAbility). After the last
        // selection the modal closes automatically and calls onResolve.
        const FetchModal = ({ fetchCard, ability, targets, onResolve, onCancel }) => {
            const [selected, setSelected] = React.useState([]);
            const { count, subtypes, type, mustShareType } = ability;

            // For Myriad Landscape (mustShareType): after 1st pick, filter to cards sharing a subtype
            const availableTargets = React.useMemo(() => {
                if (!mustShareType || selected.length === 0) return targets;
                // Find which basic subtypes the first pick has
                const firstTypeLine = selected[0]?.type_line || '';
                const sharedTypes = BASIC_SUBTYPES.filter(s =>
                    new RegExp(`\\b${s}\\b`, 'i').test(firstTypeLine)
                );
                return targets.filter(c =>
                    sharedTypes.some(s => new RegExp(`\\b${s}\\b`, 'i').test(c.type_line || ''))
                );
            }, [targets, selected, mustShareType]);

            // For specific_two (Krosan Verge): after 1st pick, only show cards with the OTHER subtype
            const filteredForSpecificTwo = React.useMemo(() => {
                if (type !== 'specific_two' || selected.length === 0) return targets;
                const pickedType = subtypes.find(s =>
                    new RegExp(`\\b${s}\\b`, 'i').test(selected[0]?.type_line || '')
                );
                const neededType = subtypes.find(s => s !== pickedType);
                return targets.filter(c => new RegExp(`\\b${neededType}\\b`, 'i').test(c.type_line || ''));
            }, [targets, selected, type, subtypes]);

            const displayTargets = type === 'specific_two' && selected.length > 0
                ? filteredForSpecificTwo
                : (mustShareType ? availableTargets : targets);

            const toggleSelect = (card) => {
                const alreadySelected = selected.find(c => c.instanceId === card.instanceId);
                if (alreadySelected) {
                    setSelected(selected.filter(c => c.instanceId !== card.instanceId));
                } else if (selected.length < count) {
                    const newSelected = [...selected, card];
                    if (newSelected.length === count) {
                        // Last selection — auto-resolve after a tick so the UI shows the selection briefly
                        setTimeout(() => onResolve(newSelected), 80);
                    }
                    setSelected(newSelected);
                }
            };

            const costLabel = fetchCard.oracle_text?.toLowerCase().includes('pay 1 life') ? ' (costs 1 life)' : '';
            const remaining = count - selected.length;

            return (
                <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/85 backdrop-blur-sm p-4">
                    <div className="bg-gray-900 border-2 border-green-500/60 rounded-xl shadow-2xl flex flex-col" style={{ maxWidth: '90vw', maxHeight: '90vh', minWidth: 340 }}>
                        {/* Header */}
                        <div className="flex items-start justify-between p-4 border-b border-gray-700 flex-shrink-0">
                            <div>
                                <h2 className="text-lg font-bold text-green-400">
                                    🔍 {fetchCard.name}{costLabel}
                                </h2>
                                <p className="text-gray-400 text-sm mt-0.5">
                                    {remaining > 0
                                        ? `Noch ${remaining} Land${remaining > 1 ? 'er' : ''} wählen${type === 'specific_two' && selected.length === 1 ? ` (need a ${subtypes.find(s => !new RegExp(`\\b${s}\\b`,'i').test(selected[0]?.type_line||''))})` : ''}`
                                        : 'Confirming…'
                                    }
                                </p>
                                {displayTargets.length === 0 && (
                                    <p className="text-yellow-400 text-sm mt-1">Keine passenden Karten in der Bibliothek.</p>
                                )}
                            </div>
                            <button onClick={onCancel} className="text-gray-400 hover:text-white text-xl ml-4">✕</button>
                        </div>

                        {/* Selected preview strip */}
                        {selected.length > 0 && (
                            <div className="flex gap-2 px-4 pt-3 flex-shrink-0">
                                {selected.map(c => (
                                    <div key={c.instanceId} className="flex flex-col items-center">
                                        <img src={c.image_url} alt={c.name} className="w-16 rounded border-2 border-green-500 shadow-lg" />
                                        <span className="text-[9px] text-green-400 font-bold mt-0.5 text-center max-w-[64px] truncate">{c.name}</span>
                                    </div>
                                ))}
                                <div className="flex items-center text-gray-500 text-sm">
                                    {selected.length < count && <span>← pick {count - selected.length} more</span>}
                                </div>
                            </div>
                        )}

                        {/* Card grid */}
                        <div className="overflow-y-auto flex-1 p-4">
                            <div className="flex flex-wrap gap-3 justify-center">
                                {displayTargets.map(card => {
                                    const isSelected = selected.some(c => c.instanceId === card.instanceId);
                                    const isDisabled = selected.length >= count && !isSelected;
                                    return (
                                        <div
                                            key={card.instanceId}
                                            onClick={() => !isDisabled && toggleSelect(card)}
                                            className={`flex flex-col items-center gap-1 cursor-pointer transition-all rounded-lg p-1
                                                ${isSelected ? 'ring-4 ring-green-400 scale-105 bg-green-900/20' : ''}
                                                ${isDisabled ? 'opacity-30 cursor-not-allowed' : 'hover:scale-105 hover:ring-2 hover:ring-green-600'}
                                            `}
                                        >
                                            <img src={card.image_url} alt={card.name} className="w-24 rounded shadow-md" />
                                            <span className="text-[9px] text-gray-300 text-center max-w-[96px] truncate">{card.name}</span>
                                            <span className="text-[8px] text-gray-500 text-center max-w-[96px] truncate">{card.type_line}</span>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        {/* No targets: just a cancel */}
                        {displayTargets.length === 0 && (
                            <div className="p-4 border-t border-gray-700 flex justify-center flex-shrink-0">
                                <button onClick={onCancel} className="bg-gray-700 hover:bg-gray-600 text-white px-6 py-2 rounded-lg text-sm font-bold">
                                    Mischen & schließen (nichts Passendes)
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            );
        };

        // Shown when a player tries to end their turn with more than 7 cards in hand (the Commander format
        // hand-size rule). The player must click cards to discard them to the graveyard until they have
        // exactly 7 - the End Turn button is locked until then.
        const DiscardModal = ({ hand, onDiscard, onDone }) => {
            const excess = hand.length - 7;
            const [selected, setSelected] = React.useState(new Set());
            const toggle = (id) => {
                setSelected(prev => {
                    const next = new Set(prev);
                    if (next.has(id)) next.delete(id);
                    else if (next.size < excess) next.add(id);
                    return next;
                });
            };
            return (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 backdrop-blur-sm p-4">
                    <div className="bg-gray-800 border-2 border-yellow-700/60 rounded-xl shadow-2xl w-full max-w-4xl p-6 flex flex-col items-center gap-4">
                        <h2 className="text-2xl font-bold text-red-400">Auf Handgröße abwerfen</h2>
                        <p className="text-gray-300 text-sm text-center">
                            Du hast <span className="text-red-400 font-bold">{hand.length}</span> cards in hand. Select <span className="text-red-400 font-bold">{excess - selected.size}</span> more to discard.
                        </p>
                        <div className="flex gap-2 justify-center overflow-x-auto max-w-full pb-1">
                            {hand.map(card => {
                                const isSelected = selected.has(card.instanceId);
                                return (
                                    <div key={card.instanceId} className="relative flex-shrink-0 cursor-pointer" onClick={() => toggle(card.instanceId)}>
                                        <img
                                            src={card.image_url}
                                            alt={card.name}
                                            className={`w-24 rounded shadow-lg transition-all ${isSelected ? 'border-4 border-red-500 -translate-y-2 opacity-60' : 'border border-gray-600 hover:border-red-400'}`}
                                        />
                                        {isSelected && <div className="absolute inset-0 flex items-center justify-center pointer-events-none"><span className="text-red-400 text-2xl font-black">✕</span></div>}
                                    </div>
                                );
                            })}
                        </div>
                        <button
                            onClick={() => { onDiscard([...selected]); }}
                            disabled={selected.size !== excess}
                            className={`font-bold px-8 py-3 rounded-lg shadow-lg text-white transition-colors ${selected.size === excess ? 'bg-red-600 hover:bg-red-500' : 'bg-gray-700 text-gray-500 cursor-not-allowed'}`}
                        >
                            {excess} Karte{excess !== 1 ? 'n' : ''} abwerfen und Zug beenden
                        </button>
                    </div>
                </div>
            );
        };

        // Shared modal for Scry X, Surveil X, and "Look at top X cards" — all share the same
        // card-by-card decision UI but with different per-card options and different final resolution.
        const LibraryActionModal = ({ mode, cards, onResolve, onCancel }) => {
            // decisions maps instanceId → chosen destination ('top'|'bottom'|'graveyard'|'hand'|'reveal')
            const [decisions, setDecisions] = React.useState({});
            const decide = (id, dest) => setDecisions(d => ({ ...d, [id]: dest }));

            const allDecided = cards.every(c => decisions[c.instanceId]);

            const modeLabel = mode === 'scry' ? 'Hellsicht' : mode === 'surveil' ? 'Überwachen' : 'Bibliothek – oberste Karten';
            const modeColor = mode === 'scry' ? 'blue' : mode === 'surveil' ? 'purple' : 'yellow';

            const btnBase = 'px-3 py-1.5 rounded text-xs font-bold transition-colors border-2';
            const btn = (id, dest, label, colors) => {
                const active = decisions[id] === dest;
                return (
                    <button
                        onClick={() => decide(id, dest)}
                        className={`${btnBase} ${active ? colors.active : colors.inactive}`}
                    >{label}</button>
                );
            };

            return (
                <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/85 backdrop-blur-sm p-4">
                    <div className={`bg-gray-900 border-2 border-${modeColor}-500/60 rounded-xl shadow-2xl w-full max-w-5xl flex flex-col`} style={{ maxHeight: '90vh' }}>
                        <div className="flex items-center justify-between p-4 border-b border-gray-700 flex-shrink-0">
                            <h2 className={`text-xl font-bold text-${modeColor}-400`}>{modeLabel} – {cards.length} Karte{cards.length !== 1 ? 'n' : ''}</h2>
                            <div className="flex gap-2 items-center">
                                {mode === 'look' && (
                                    <button
                                        onClick={() => {
                                            // "Put all remaining bottom in random order" — shuffles undecided cards to bottom
                                            const undecided = cards.filter(c => !decisions[c.instanceId]);
                                            const newDec = { ...decisions };
                                            undecided.forEach(c => { newDec[c.instanceId] = 'bottom_random'; });
                                            setDecisions(newDec);
                                        }}
                                        className="bg-gray-700 hover:bg-gray-600 text-gray-300 px-3 py-1.5 rounded text-xs font-bold border border-gray-500"
                                    >Rest unter die Bibliothek (zufällig)</button>
                                )}
                                <button
                                    onClick={() => allDecided && onResolve(decisions)}
                                    disabled={!allDecided}
                                    className={`px-5 py-2 rounded-lg font-bold text-white transition-colors ${allDecided ? `bg-${modeColor}-600 hover:bg-${modeColor}-500` : 'bg-gray-700 text-gray-500 cursor-not-allowed'}`}
                                >
                                    {allDecided ? 'Bestätigen' : `Noch ${cards.filter(c => !decisions[c.instanceId]).length} offen`}
                                </button>
                                <button onClick={onCancel} className="text-gray-400 hover:text-white text-lg px-2">✕</button>
                            </div>
                        </div>
                        <div className="overflow-y-auto flex-1 p-4">
                            <div className="flex flex-wrap gap-4 justify-center">
                                {cards.map(card => {
                                    const dec = decisions[card.instanceId];
                                    return (
                                        <div key={card.instanceId} className={`flex flex-col items-center gap-2 p-2 rounded-lg border-2 transition-colors ${dec ? 'border-green-500/60 bg-green-900/10' : 'border-gray-700'}`} style={{ width: 130 }}>
                                            <img src={card.image_url} alt={card.name} className="w-24 rounded shadow-lg" />
                                            <div className="flex flex-col gap-1 w-full">
                                                {mode === 'scry' && <>
                                                    {btn(card.instanceId, 'top', '▲ Oben', { active: 'bg-blue-600 border-blue-400 text-white', inactive: 'border-yellow-800 text-blue-400 hover:bg-gray-900' })}
                                                    {btn(card.instanceId, 'bottom', '▼ Unten', { active: 'bg-gray-600 border-gray-400 text-white', inactive: 'border-gray-700 text-gray-400 hover:bg-gray-800' })}
                                                </>}
                                                {mode === 'surveil' && <>
                                                    {btn(card.instanceId, 'top', '▲ Oben', { active: 'bg-purple-600 border-purple-400 text-white', inactive: 'border-purple-800 text-purple-400 hover:bg-purple-900' })}
                                                    {btn(card.instanceId, 'graveyard', '💀 Friedhof', { active: 'bg-red-700 border-red-500 text-white', inactive: 'border-yellow-800 text-red-400 hover:bg-gray-900' })}
                                                </>}
                                                {mode === 'look' && <>
                                                    {btn(card.instanceId, 'top', '▲ Oben', { active: 'bg-yellow-600 border-yellow-400 text-white', inactive: 'border-yellow-800 text-yellow-400 hover:bg-yellow-900' })}
                                                    {btn(card.instanceId, 'hand', '✋ Hand', { active: 'bg-blue-600 border-blue-400 text-white', inactive: 'border-yellow-800 text-blue-400 hover:bg-gray-900' })}
                                                    {btn(card.instanceId, 'battlefield', '⚔️ Battlefield', { active: 'bg-green-600 border-green-400 text-white', inactive: 'border-green-800 text-green-400 hover:bg-green-900' })}
                                                    {btn(card.instanceId, 'reveal', '👁 Reveal+Hand', { active: 'bg-teal-600 border-teal-400 text-white', inactive: 'border-teal-800 text-teal-400 hover:bg-teal-900' })}
                                                    {btn(card.instanceId, 'graveyard', '💀 Friedhof', { active: 'bg-red-800 border-red-600 text-white', inactive: 'border-yellow-800 text-red-400 hover:bg-gray-900' })}
                                                    {btn(card.instanceId, 'bottom', '▼ Unten', { active: 'bg-gray-600 border-gray-400 text-white', inactive: 'border-gray-700 text-gray-400 hover:bg-gray-800' })}
                                                </>}
                                                {dec && <div className="text-center text-[10px] text-green-400 font-bold mt-1">✓ {dec.replace('_random','')}</div>}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                </div>
            );
        };

        const StartGameModal = ({ pregameAnswers, getPlayerName, onDismiss }) => (
            <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 backdrop-blur-sm p-4">
                <div className="bg-gray-800 border-2 border-green-500/60 rounded-xl shadow-2xl w-full max-w-md p-6 flex flex-col items-center gap-4">
                    <h2 className="text-2xl font-bold text-green-400 text-center">Ihr könnt loslegen!</h2>
                    {pregameAnswers.length > 0 ? (
                        <div className="w-full bg-gray-900/60 rounded-lg p-3 text-sm">
                            {pregameAnswers.map(({ uid, hasAction }) => (
                                <div key={uid} className="flex justify-between py-1">
                                    <span className="text-gray-300">{getPlayerName(uid)}</span>
                                    <span className={hasAction ? 'text-yellow-400 font-bold' : 'text-gray-500'}>
                                        {hasAction ? 'Aktion vor Spielbeginn' : 'Keine'}
                                    </span>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <p className="text-gray-400 text-sm text-center">Niemand hat eine Aktion vor Spielbeginn.</p>
                    )}
                    <button onClick={onDismiss} className="bg-green-600 hover:bg-green-500 text-white font-bold px-6 py-3 rounded-lg shadow-lg mt-2">Verstanden</button>
                </div>
            </div>
        );
        
        const TokenModal = ({ isOpen, onClose, onCreate, seatedPlayers, getPlayerName, myUid }) => {
            const [name, setName] = useState('Spirit');
            const [stats, setStats] = useState('1/1');
            const [quantity, setQuantity] = useState(1);
            const [colors, setColors] = useState(['W']);
            const [targetPlayerId, setTargetPlayerId] = useState(myUid);
            // Beim Öffnen wieder für dich selbst und 1 Stück – sonst landet ein Token versehentlich beim Gegner
            useEffect(() => { if (isOpen) { setTargetPlayerId(myUid); setQuantity(1) } }, [isOpen, myUid]);

            const toggleColor = (c) => {
                setColors(prev => 
                    prev.includes(c) ? prev.filter(col => col !== c) : [...prev, c]
                );
            };

            const handleSubmit = () => {
                onCreate(targetPlayerId, {
                    name,
                    stats,
                    quantity: parseInt(quantity, 10) || 1,
                    colors
                });
                onClose();
            };

            if (!isOpen) return null;
            const seats = seatedPlayers && seatedPlayers.length > 0 ? seatedPlayers : [myUid];

            return (
                <Modal isOpen={isOpen} onClose={onClose} title="Token erstellen">
                    <div className="flex flex-col gap-4">
                        {seats.length > 1 && (
                            <div>
                                <label className="block text-sm font-medium text-gray-300 mb-1">Token für</label>
                                <select value={targetPlayerId} onChange={e => setTargetPlayerId(e.target.value)} className="bg-gray-700 border border-gray-600 p-2 rounded w-full text-white">
                                    {seats.map((uid, i) => (
                                        <option key={uid} value={uid}>{uid === myUid ? `Spieler ${i + 1} (du)` : `Spieler ${i + 1} – ${getPlayerName(uid)}`}</option>
                                    ))}
                                </select>
                            </div>
                        )}
                        <div>
                            <label className="block text-sm font-medium text-gray-300 mb-1">Token-Name</label>
                            <input type="text" value={name} onChange={e => setName(e.target.value)} className="bg-gray-700 border border-gray-600 p-2 rounded w-full text-white" />
                        </div>
                        
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-300 mb-1">Stärke/Widerstand</label>
                                <input type="text" value={stats} onChange={e => setStats(e.target.value)} className="bg-gray-700 border border-gray-600 p-2 rounded w-full text-white" placeholder="z. B. 1/1" />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-300 mb-1">Anzahl</label>
                                <input type="number" value={quantity} onChange={e => setQuantity(e.target.value)} min="1" className="bg-gray-700 border border-gray-600 p-2 rounded w-full text-white" />
                            </div>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-300 mb-1">Farben</label>
                            <div className="flex gap-2">
                                {['W', 'U', 'B', 'R', 'G'].map(c => (
                                    <button 
                                        key={c}
                                        onClick={() => toggleColor(c)}
                                        className={`mana-toggle ${
                                            c === 'W' ? 'bg-mtg-w text-black' : 
                                            c === 'U' ? 'bg-mtg-u text-white' : 
                                            c === 'B' ? 'bg-mtg-b text-white' : 
                                            c === 'R' ? 'bg-mtg-r text-white' : 
                                            'bg-mtg-g text-white'
                                        } ${colors.includes(c) ? 'ring-2 ring-yellow-400' : 'opacity-50'}`}
                                    >
                                        {c}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <button onClick={handleSubmit} className="bg-green-600 hover:bg-green-500 text-white font-bold py-3 px-4 rounded-lg transition-colors w-full mt-4">
                            {quantity} Token erstellen
                        </button>
                    </div>
                </Modal>
            );
        };

        const ContextMenu = ({ x, y, options, onClose }) => {
            const [activeSubmenu, setActiveSubmenu] = useState(null);
            // { type, mode: 'add'|'remove', max } — set when a numeric counter type is clicked; shows the
            // amount picker before committing the action.
            const [counterPicker, setCounterPicker] = useState(null);
            const [customAmount, setCustomAmount] = useState('');

            const vw = window.innerWidth;
            const vh = window.innerHeight;
            const isCounterSubmenu = activeSubmenu && activeSubmenu.length > 8;
            const menuW = (isCounterSubmenu || counterPicker) ? 360 : 180;
            const menuH = counterPicker ? 160 : Math.min((activeSubmenu || options).length * 36 + 60, vh * 0.8);
            const left = x + menuW > vw ? Math.max(0, x - menuW) : x;
            const top  = y + menuH > vh ? Math.max(0, y - menuH) : y;

            const numericCounters = ['+1/+1', '-1/-1', 'Gift', 'Energie', 'Ladung', 'Loyalität'];
            const isNumeric = (label) => numericCounters.some(n => label.startsWith(n));

            const commitAmount = (amt) => {
                if (!counterPicker || !amt || amt === 0) return;
                counterPicker.action(amt);
                onClose();
            };

            const visibleOptions = activeSubmenu || options;

            return (
                <>
                    <div className="fixed inset-0 z-[199]" onClick={onClose} />
                    <div
                        className="fixed z-[200] bg-gray-800 border border-gray-600 rounded-lg shadow-xl py-1"
                        style={{ left, top, minWidth: (isCounterSubmenu || counterPicker) ? 360 : 170, maxWidth: '90vw' }}
                    >
                        {/* Amount picker — shown after clicking a numeric counter type */}
                        {counterPicker ? (
                            <div className="p-3">
                                <div className="text-xs text-gray-400 font-bold uppercase tracking-wide mb-2">
                                    {counterPicker.mode === 'add' ? `${counterPicker.type}-Marker hinzufügen` : `${counterPicker.type}-Marker entfernen`}
                                </div>
                                <div className="flex gap-2 mb-2">
                                    {[1, 2, 3, 5].map(n => (
                                        <button
                                            key={n}
                                            onClick={() => commitAmount(n)}
                                            className="flex-1 bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold py-2 rounded"
                                        >{n}</button>
                                    ))}
                                </div>
                                <div className="flex gap-2 items-center">
                                    <input
                                        type="number"
                                        min="1"
                                        value={customAmount}
                                        onChange={e => setCustomAmount(e.target.value)}
                                        onKeyDown={e => { if (e.key === 'Enter') commitAmount(parseInt(customAmount) || 0); }}
                                        placeholder="Eigener …"
                                        className="flex-1 bg-gray-700 border border-gray-600 text-white text-sm px-2 py-1.5 rounded"
                                        autoFocus
                                    />
                                    <button
                                        onClick={() => commitAmount(parseInt(customAmount) || 0)}
                                        className="bg-green-600 hover:bg-green-500 text-white text-sm font-bold px-3 py-1.5 rounded"
                                    >OK</button>
                                    <button
                                        onClick={() => { setCounterPicker(null); setCustomAmount(''); }}
                                        className="bg-gray-600 hover:bg-gray-500 text-white text-sm px-2 py-1.5 rounded"
                                    >←</button>
                                </div>
                            </div>
                        ) : isCounterSubmenu ? (
                            /* Multi-column grid for counter submenu */
                            <div className="p-2">
                                {activeSubmenu.filter(o => !isNumeric(o.label)).length > 0 && <>
                                    <div className="text-xs text-gray-400 font-bold uppercase tracking-wide px-1 mb-1">Schlüsselwort-Marker</div>
                                    <div className="grid grid-cols-3 gap-1 mb-3">
                                        {activeSubmenu.filter(o => !isNumeric(o.label)).map((opt, i) => (
                                            <button
                                                key={i}
                                                onClick={() => { opt.action(1); onClose(); }}
                                                className="text-left text-xs text-white bg-gray-700 hover:bg-gray-600 px-2 py-1.5 rounded truncate"
                                                title={opt.label}
                                            >{opt.label}</button>
                                        ))}
                                    </div>
                                </>}
                                <div className="text-xs text-gray-400 font-bold uppercase tracking-wide px-1 mb-1">Zahlen-Marker</div>
                                <div className="grid grid-cols-3 gap-1">
                                    {activeSubmenu.filter(o => isNumeric(o.label) || numericCounters.some(n => o.label.includes(n))).map((opt, i) => (
                                        <button
                                            key={i}
                                            onClick={() => {
                                                setCounterPicker({ type: opt.label.replace(/\s*\(\d+\)/, ''), mode: opt._mode || 'add', action: opt._amountAction || ((n) => opt.action(n)) });
                                                setCustomAmount('');
                                            }}
                                            className="text-left text-xs text-white bg-gray-700 hover:bg-indigo-700 px-2 py-1.5 rounded"
                                        >{opt.label} <span className="text-gray-400">→</span></button>
                                    ))}
                                </div>
                                <button onClick={() => setActiveSubmenu(null)} className="mt-2 text-xs text-gray-400 hover:text-white px-1">← Zurück</button>
                            </div>
                        ) : (
                            /* Normal flat list */
                            <>
                                {activeSubmenu && (
                                    <button onClick={() => setActiveSubmenu(null)} className="flex items-center w-full px-3 py-2 text-sm text-yellow-400 hover:bg-gray-700 border-b border-gray-700 font-bold">
                                        ← Zurück
                                    </button>
                                )}
                                {visibleOptions.map((opt, i) => (
                                    <button
                                        key={i}
                                        onClick={() => {
                                            if (opt.submenu) { setActiveSubmenu(opt.submenu); }
                                            else { opt.action(); onClose(); }
                                        }}
                                        className={`flex items-center justify-between w-full text-left px-4 py-2 text-sm text-white ${opt.label.startsWith('---') ? 'text-gray-500 text-center pointer-events-none' : 'hover:bg-gray-700'} ${opt.disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
                                        disabled={opt.label.startsWith('---') || opt.disabled}
                                    >
                                        <span>{opt.label}</span>
                                        {opt.submenu && <span className="text-gray-400 ml-2">›</span>}
                                    </button>
                                ))}
                            </>
                        )}
                    </div>
                </>
            );
        };

        const ActiveTurnBadge = () => (
            <div className="w-6 h-6 rounded-full bg-gradient-to-br from-yellow-300 to-yellow-600 border border-yellow-700 flex items-center justify-center shadow-lg coin-spin mx-2" title="Zug des aktiven Spielers">
                <Icon name="play" className="w-3 h-3 text-yellow-900" />
            </div>
        );

        // Compact per-opponent tile used in the multiplayer grid (3-4 player tables).
        // Unlike the single 2-player layout, battlefield cards here are laid out in a simple flow
        // (not free x/y positioning) since each tile only gets a fraction of the screen.
        // Karte in einer Gegner-Kachel (3–4 Spieler): Bild, effektive Stärke/Widerstand und Marker wie auf dem großen
        // Spielfeld; während einer Aura-Zielwahl golden markiert und anklickbar.
        const TileCard = ({ card, sizeClass, onHoverCard, auraValid, onAuraPick, zone }) => {
            const [p, t] = effectivePT(card);
            const showPT = isCreatureLike(card) && hasPTData(card);
            const counters = (card.counters || []).filter(c => c && c.count);
            return (
                <div className="relative flex-shrink-0" data-aura-target={auraValid ? '1' : undefined} data-tile-card={card.instanceId}
                    onClick={(e) => { if (onAuraPick && onAuraPick(card, zone, auraValid)) e.stopPropagation(); }}>
                    <CardImage src={card.image_url} className={`${sizeClass} card-shadow ${card.isTapped ? 'tapped' : 'untapped'}`}
                        onMouseEnter={(e) => { e.stopPropagation(); onHoverCard(card.image_url); }}
                        onMouseLeave={() => onHoverCard(null)} />
                    {showPT && <span data-testid="tile-pt" style={{ position: 'absolute', right: 1, bottom: 1, background: t <= 0 ? '#7f1d1d' : 'rgba(0,0,0,0.85)', color: 'white', fontSize: 9, fontWeight: 'bold', lineHeight: 1.2, padding: '0 3px', borderRadius: 3, pointerEvents: 'none' }}>{p}/{t}</span>}
                    {counters.length > 0 && (
                        <div data-testid="tile-counters" style={{ position: 'absolute', left: 1, top: 1, display: 'flex', flexDirection: 'column', gap: 1, pointerEvents: 'none' }}>
                            {counters.map((c, i) => <span key={`${c.type}-${i}`} title={`${c.type}: ${c.count}`} style={{ background: 'rgba(30,27,75,0.92)', border: '1px solid #a5b4fc', color: '#e0e7ff', fontSize: 8, fontWeight: 'bold', lineHeight: 1.1, padding: '0 2px', borderRadius: 3, whiteSpace: 'nowrap' }}>{c.type}{c.count > 1 || /\d/.test(c.type) ? ` ×${c.count}` : ''}</span>)}
                        </div>
                    )}
                    {auraValid && <div className="absolute inset-0 rounded-lg pointer-events-none" style={{ border: '2px solid #facc15', boxShadow: '0 0 10px 3px rgba(250,204,21,0.75)' }} />}
                </div>
            );
        };
        const OpponentTile = ({ name, state, isActivePlayer, isChoosingMulligan, isExpanded, onClick, onHoverCard, myCommanders, auraValidFor, onAuraPick, onReanimate }) => {
            const [viewingZoneLocal, setViewingZoneLocal] = React.useState(null); // 'graveyard' | 'exile' | null
            if (!state) {
                return (
                    <div className="flex-1 min-w-0 bg-gray-900/10 border border-solid border-yellow-700/20 rounded-lg flex items-center justify-center text-red-500/30 text-xs font-bold uppercase tracking-widest">
                        Warte auf Spieler …
                    </div>
                );
            }
            const battlefieldCards = [...(state.battlefieldUpper || []), ...(state.battlefieldLower || [])];
            const zoneOf = (card) => (state.battlefieldUpper || []).some(c => c.instanceId === card.instanceId) ? 'battlefieldUpper' : 'battlefieldLower';
            const cardSizeClass = isExpanded ? 'w-20 h-28' : 'w-12 h-16';
            return (
                <div 
                    onClick={onClick}
                    className={`relative flex-1 min-w-0 bg-gray-900/10 border border-solid rounded-lg flex flex-col overflow-hidden cursor-pointer transition-all ${isActivePlayer ? 'border-green-400 ring-2 ring-green-400/60' : 'border-yellow-700/30'}`}
                >
                    {isChoosingMulligan && (
                        <div className="absolute inset-0 z-20 bg-black/70 flex items-center justify-center pointer-events-none">
                            <span className="text-yellow-400 text-xs font-bold uppercase tracking-wide px-2 py-1 bg-black/60 rounded">{name} wählt die Starthand…</span>
                        </div>
                    )}
                    {/* Header: name, life, commander damage */}
                    <div className="bg-gray-900/60 px-3 py-2 flex-shrink-0">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center min-w-0">
                                <h4 className={`text-red-300 font-bold truncate ${isExpanded ? 'text-base' : 'text-sm'}`} title={name}>{name}</h4>
                                {isActivePlayer && <ActiveTurnBadge />}
                            </div>
                            <div className={`text-white flex items-center gap-3 flex-shrink-0 ${isExpanded ? 'text-sm' : 'text-xs'}`}>
                                <span>Leben: <span className="text-green-400 font-bold">{state.life}</span></span>
                                <span>Cmd: <span className="text-red-400 font-bold">{Object.values(state.commanderDamage || {}).reduce((a, b) => a + b, 0)}</span></span>
                            </div>
                        </div>
                        {/* Per-MY-commander breakdown, only shown when this tile is expanded (there's no room
                            for it in the small grid view) - mirrors the 2-player sidebar's breakdown. */}
                        {isExpanded && myCommanders && myCommanders.length > 0 && (
                            <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
                                {myCommanders.map(cmdr => (
                                    <span key={cmdr.instanceId} className="text-xs text-gray-300 truncate" title={`Schaden durch ${cmdr.name}`}>
                                        {cmdr.name}: <span className="text-red-400 font-bold">{(state.commanderDamage || {})[cmdr.instanceId] || 0}</span>
                                    </span>
                                ))}
                            </div>
                        )}
                        {(state.emblems || []).length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1">
                                {state.emblems.map(e => (
                                    <span key={e.instanceId} className="bg-indigo-700/80 border border-indigo-400 text-indigo-100 text-[9px] font-bold px-1 py-0.5 rounded" title={e.stage > 0 ? e.stageText[e.stage - 1] : 'Gerade erstellt'}>
                                        {e.name} {e.maxStage > 1 ? `${e.stage}/${e.maxStage}` : ''}
                                    </span>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Battlefield — split into the same zones as the player's own half so the opponent's
                        field is visually consistent. Cards within each zone are flowed (not free-positioned)
                        since each tile only gets a fraction of the screen. */}
                    <div className="flex-grow flex flex-col-reverse overflow-hidden min-h-0">
                        {/* Creature zone — gespiegelt wie auf meiner Hälfte: unten, zur Tischmitte hin; eine Reihe, bei Platzmangel als Fächer */}
                        <div className="flex-grow border-t border-yellow-700/10 p-1 overflow-hidden flex flex-col justify-end min-h-0">
                            <div className="text-[8px] text-green-400/40 font-bold uppercase mb-0.5">Kreaturen</div>
                            <div className="flex flex-nowrap overflow-hidden">
                                {(() => { const cr = [...(state.battlefieldUpper || []), ...(state.battlefieldLower || [])].filter(c => getCardZoneType(c) === 'creature'); return cr.map((card, i) => (
                                    <div key={card.instanceId} className="relative" style={{ flex: i === cr.length - 1 ? '0 0 auto' : '0 1 auto', minWidth: 8, paddingRight: 2 }}>
                                        <TileCard card={card} sizeClass={cardSizeClass} onHoverCard={onHoverCard} auraValid={!!auraValidFor?.(card)} onAuraPick={onAuraPick} zone={zoneOf(card)} />
                                    </div>
                                )); })()}
                            </div>
                        </div>
                        {/* Land + Planeswalker row */}
                        <div className="flex border-t border-yellow-700/10 flex-shrink-0" style={{ minHeight: isExpanded ? 36 : 24 }}>
                            <div className="flex-[65] p-0.5 border-r border-yellow-700/10 overflow-hidden">
                                <div className="text-[7px] text-yellow-400/40 font-bold uppercase">Länder</div>
                                <div className="flex flex-wrap gap-0.5">
                                    {[...(state.battlefieldUpper || []), ...(state.battlefieldLower || [])].filter(c => getCardZoneType(c) === 'land').map(card => (
                                        <TileCard key={card.instanceId} card={card} sizeClass={cardSizeClass} onHoverCard={onHoverCard} auraValid={!!auraValidFor?.(card)} onAuraPick={onAuraPick} zone={zoneOf(card)} />
                                    ))}
                                </div>
                            </div>
                            <div className="flex-[35] p-0.5 overflow-hidden">
                                <div className="text-[7px] text-red-300/40 font-bold uppercase">PW</div>
                                <div className="flex flex-wrap gap-0.5">
                                    {[...(state.battlefieldUpper || []), ...(state.battlefieldLower || [])].filter(c => getCardZoneType(c) === 'planeswalker').map(card => (
                                        <TileCard key={card.instanceId} card={card} sizeClass={cardSizeClass} onHoverCard={onHoverCard} auraValid={!!auraValidFor?.(card)} onAuraPick={onAuraPick} zone={zoneOf(card)} />
                                    ))}
                                </div>
                            </div>
                        </div>
                        {/* Enchantment + Artifact row */}
                        <div className="flex flex-shrink-0" style={{ minHeight: isExpanded ? 36 : 24 }}>
                            <div className="flex-1 p-0.5 border-r border-yellow-700/10 overflow-hidden">
                                <div className="text-[7px] text-purple-400/40 font-bold uppercase">Verzaubern</div>
                                <div className="flex flex-wrap gap-0.5">
                                    {[...(state.battlefieldUpper || []), ...(state.battlefieldLower || [])].filter(c => getCardZoneType(c) === 'enchantment').map(card => (
                                        <TileCard key={card.instanceId} card={card} sizeClass={cardSizeClass} onHoverCard={onHoverCard} auraValid={!!auraValidFor?.(card)} onAuraPick={onAuraPick} zone={zoneOf(card)} />
                                    ))}
                                </div>
                            </div>
                            <div className="flex-1 p-0.5 overflow-hidden">
                                <div className="text-[7px] text-orange-400/40 font-bold uppercase">Artefakte</div>
                                <div className="flex flex-wrap gap-0.5">
                                    {[...(state.battlefieldUpper || []), ...(state.battlefieldLower || [])].filter(c => getCardZoneType(c) === 'artifact').map(card => (
                                        <TileCard key={card.instanceId} card={card} sizeClass={cardSizeClass} onHoverCard={onHoverCard} auraValid={!!auraValidFor?.(card)} onAuraPick={onAuraPick} zone={zoneOf(card)} />
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>{/* end flex-grow flex-col battlefield */}
                    {/* Footer: hand count, clickable GY/Exile, command zone with tax */}
                    <div className="flex-shrink-0 bg-gray-900/40 p-2 flex flex-wrap gap-2 items-center text-[10px]">
                        <span className="text-red-300 font-bold">Hand: {state.hand?.length || 0}</span>
                        <span className="text-red-300 font-bold">Lib: {state.library?.length || 0}</span>
                        <button
                            onClick={(e) => { e.stopPropagation(); setViewingZoneLocal('graveyard'); }}
                            className={`font-bold px-1.5 py-0.5 rounded transition-colors ${(state.graveyard?.length || 0) > 0 ? 'text-white bg-gray-700 hover:bg-gray-600' : 'text-red-300'}`}
                        >Friedhof: {state.graveyard?.length || 0}</button>
                        <button
                            onClick={(e) => { e.stopPropagation(); setViewingZoneLocal('exile'); }}
                            className={`font-bold px-1.5 py-0.5 rounded transition-colors ${(state.exile?.length || 0) > 0 ? 'text-white bg-purple-800 hover:bg-purple-700' : 'text-red-300'}`}
                        >Exile: {state.exile?.length || 0}</button>
                        {state.commandZone?.length > 0 && (
                            <div className="flex gap-1 ml-auto items-center">
                                {state.commandZone.map(card => (
                                    <div key={card.instanceId} className="flex flex-col items-center">
                                        <CardImage 
                                            src={card.image_url} 
                                            className="w-8 h-11 border border-yellow-500 flex-shrink-0"
                                            onMouseEnter={(e) => { e.stopPropagation(); onHoverCard(card.image_url); }}
                                            onMouseLeave={() => onHoverCard(null)}
                                        />
                                        {card.isCommander && (state.cmdTax || {})[card.instanceId] !== undefined && (
                                            <span className="text-yellow-400 text-[8px] font-bold">+{(state.cmdTax || {})[card.instanceId] || 0}</span>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* GY / Exile overlay — fixed over the whole screen so it's readable even on small tiles */}
                    {viewingZoneLocal && (
                        <div
                            className="fixed inset-0 z-[150] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
                            onClick={(e) => { e.stopPropagation(); setViewingZoneLocal(null); }}
                        >
                            <div
                                className="bg-gray-900 border border-gray-600 rounded-xl shadow-2xl p-4 max-w-3xl w-full max-h-[80vh] flex flex-col"
                                onClick={(e) => e.stopPropagation()}
                            >
                                <div className="flex items-center justify-between mb-3">
                                    <h3 className="text-white font-bold text-lg">
                                        {name} — {viewingZoneLocal === 'graveyard' ? 'Friedhof' : 'Exil'}
                                        <span className="text-gray-400 text-sm ml-2">
                                            ({(viewingZoneLocal === 'graveyard' ? state.graveyard : state.exile)?.length || 0} cards)
                                        </span>
                                    </h3>
                                    <button onClick={() => setViewingZoneLocal(null)} className="text-gray-400 hover:text-white text-xl font-bold px-2">✕</button>
                                </div>
                                <div className="overflow-y-auto flex-1">
                                    {((viewingZoneLocal === 'graveyard' ? state.graveyard : state.exile) || []).length === 0 ? (
                                        <p className="text-gray-500 text-center py-8">Leer</p>
                                    ) : (
                                        <div className="flex flex-wrap gap-2 justify-center">
                                            {((viewingZoneLocal === 'graveyard' ? state.graveyard : state.exile) || []).map(card => (
                                                <div key={card.instanceId} className="flex flex-col items-center gap-1 w-24">
                                                    <img
                                                        src={card.image_url}
                                                        alt={card.name}
                                                        title={card.name}
                                                        className="w-24 rounded shadow-lg border border-gray-600 hover:border-white transition-colors cursor-default"
                                                        onMouseEnter={() => onHoverCard(card.image_url)}
                                                        onMouseLeave={() => onHoverCard(null)}
                                                    />
                                                    {onReanimate && (
                                                        <button onClick={(e) => { e.stopPropagation(); onHoverCard(null); setViewingZoneLocal(null); onReanimate(card, viewingZoneLocal); }}
                                                            className="bg-purple-700 hover:bg-purple-600 text-white text-[10px] font-bold px-1.5 py-1 rounded w-full leading-tight" title={`Unter deine Kontrolle; ${name} bleibt Besitzer`}>Aufs eigene Spielfeld (reanimieren)</button>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            );
        };

        // ── NOTIFICATION TOAST ────────────────────────────────────────────────────
        // Lightweight toast system — toasts are stored as { id, text, color } in a
        // module-level array and rendered via a portal into (document.getElementById('arena-portal') || document.body).
        // addToast() is called from game logic anywhere in GameSim.
        const _toastListeners = [];
        const _fireToast = (toast) => _toastListeners.forEach(fn => fn(toast));
        const addToast = (text, color = 'blue') => _fireToast({ id: Math.random().toString(36).slice(2), text, color });

        const NotificationToasts = () => {
            const [toasts, setToasts] = React.useState([]);
            React.useEffect(() => {
                const handler = (t) => {
                    setToasts(prev => [...prev.slice(-5), t]); // max 6 visible
                    setTimeout(() => setToasts(prev => prev.filter(x => x.id !== t.id)), 4000);
                };
                _toastListeners.push(handler);
                return () => {
                    const idx = _toastListeners.indexOf(handler);
                    if (idx > -1) _toastListeners.splice(idx, 1);
                };
            }, []);
            if (!toasts.length) return null;
            const colorMap = { blue: '#3b82f6', green: '#22c55e', red: '#ef4444', yellow: '#eab308', purple: '#a855f7', orange: '#f97316' };
            return ReactDOM.createPortal(
                <div style={{ position: 'fixed', top: 16, right: 16, zIndex: 99999, display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 320 }}>
                    {toasts.map(t => (
                        <div key={t.id} style={{ background: '#1f2937', border: `2px solid ${colorMap[t.color] || colorMap.blue}`, borderRadius: 8, padding: '10px 14px', color: 'white', fontSize: 13, fontWeight: 500, boxShadow: '0 8px 24px rgba(0,0,0,0.6)', animation: 'slideIn 0.2s ease' }}>
                            {t.text}
                        </div>
                    ))}
                </div>,
                (document.getElementById('arena-portal') || document.body)
            );
        };

        // ── MANA DISPLAY ──────────────────────────────────────────────────────────
        const MANA_COLORS = { W: { bg: '#fef9c3', text: '#78350f', label: 'W' }, U: { bg: '#1e40af', text: '#bfdbfe', label: 'U' }, B: { bg: '#1c1917', text: '#d4d4d8', label: 'B' }, R: { bg: '#991b1b', text: '#fecaca', label: 'R' }, G: { bg: '#14532d', text: '#bbf7d0', label: 'G' }, C: { bg: '#374151', text: '#d1d5db', label: 'C' } };
        // compact: one row of six pips for the left console (click = +1, right-click or the small − = −1,
        // ✕ clears) so the sidebar fits without scrolling. The default layout keeps separate +/− buttons.
        const ManaPool = ({ pool, onAdd, onRemove, onClear, compact = false, readOnly = false, ownerName = '' }) => {
            const total = Object.values(pool).reduce((s, n) => s + n, 0);
            // Nur-Lese-Variante (Manapool eines Gegners): gleiche Maße wie die eigene, aber ohne Bedienung.
            if (compact && readOnly) return (
                <div data-testid="mana-pool-ro" style={{ position: 'relative', background: 'rgba(0,0,0,0.45)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '5px 18px 3px 5px' }}>
                    <div style={{ display: 'flex', gap: 3 }}>
                        {Object.entries(MANA_COLORS).map(([sym, c]) => (
                            <div key={sym} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, flex: 1 }}>
                                <span title={`${ownerName ? ownerName + ': ' : ''}${c.label}-Mana ${pool[sym] || 0}`}
                                    style={{ width: 22, height: 22, borderRadius: '50%', background: c.bg, color: c.text, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 'bold', border: pool[sym] > 0 ? '1px solid #d4b46a' : '1px solid rgba(255,255,255,0.2)', position: 'relative', opacity: pool[sym] > 0 ? 1 : 0.55, boxSizing: 'border-box' }}
                                >
                                    {c.label}
                                    {pool[sym] > 0 && (
                                        <span style={{ position: 'absolute', top: -4, right: -5, background: '#f59e0b', color: '#000', borderRadius: 7, minWidth: 13, height: 13, padding: '0 2px', fontSize: 8, fontWeight: 'bold', display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}>
                                            {pool[sym]}
                                        </span>
                                    )}
                                </span>
                                <span style={{ width: '100%', height: 9 }} />
                            </div>
                        ))}
                    </div>
                </div>
            );
            if (compact) return (
                <div style={{ position: 'relative', background: 'rgba(0,0,0,0.45)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '5px 18px 3px 5px' }}>
                    <div style={{ display: 'flex', gap: 3 }}>
                        {Object.entries(MANA_COLORS).map(([sym, c]) => (
                            <div key={sym} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, flex: 1 }}>
                                <button
                                    onClick={() => onAdd(sym)}
                                    onContextMenu={(e) => { e.preventDefault(); onRemove(sym); }}
                                    title={`${c.label}-Mana · Klick: +1 · Rechtsklick: −1`}
                                    style={{ width: 22, height: 22, borderRadius: '50%', background: c.bg, color: c.text, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 'bold', border: pool[sym] > 0 ? '1px solid #d4b46a' : '1px solid rgba(255,255,255,0.2)', position: 'relative', cursor: 'pointer', padding: 0 }}
                                >
                                    {c.label}
                                    {pool[sym] > 0 && (
                                        <span style={{ position: 'absolute', top: -4, right: -5, background: '#f59e0b', color: '#000', borderRadius: 7, minWidth: 13, height: 13, padding: '0 2px', fontSize: 8, fontWeight: 'bold', display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}>
                                            {pool[sym]}
                                        </span>
                                    )}
                                </button>
                                <button onClick={() => onRemove(sym)} disabled={!pool[sym]} title={`${c.label}-Mana −1`} style={{ width: '100%', height: 9, background: '#374151', border: 'none', color: '#9ca3af', fontSize: 8, cursor: pool[sym] ? 'pointer' : 'default', borderRadius: 2, lineHeight: 1, padding: 0, opacity: pool[sym] ? 1 : 0.3 }}>−</button>
                            </div>
                        ))}
                    </div>
                    {total > 0 && (
                        <button onClick={onClear} title="Manapool leeren" style={{ position: 'absolute', top: 3, right: 3, width: 13, height: 13, color: '#9ca3af', fontSize: 9, background: 'rgba(55,65,81,0.8)', border: 'none', borderRadius: 3, cursor: 'pointer', padding: 0, lineHeight: 1 }}>✕</button>
                    )}
                </div>
            );
            return (
                <div style={{ background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, padding: '5px 6px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 3 }}>
                        <span style={{ color: '#9ca3af', fontSize: 9, fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Manapool{total > 0 ? ` (${total})` : ''}</span>
                        {total > 0 && <button onClick={onClear} style={{ color: '#6b7280', fontSize: 9, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>Leeren</button>}
                    </div>
                    <div style={{ display: 'flex', gap: 3 }}>
                        {Object.entries(MANA_COLORS).map(([sym, c]) => (
                            <div key={sym} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, flex: 1 }}>
                                {/* + button */}
                                <button onClick={() => onAdd(sym)} style={{ width: '100%', height: 10, background: '#374151', border: 'none', color: '#9ca3af', fontSize: 8, cursor: 'pointer', borderRadius: 2, lineHeight: 1 }}>+</button>
                                {/* Mana symbol circle */}
                                <div style={{ width: 22, height: 22, borderRadius: '50%', background: c.bg, color: c.text, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 'bold', border: '1px solid rgba(255,255,255,0.2)', position: 'relative' }}>
                                    {c.label}
                                    {pool[sym] > 0 && (
                                        <div style={{ position: 'absolute', top: -4, right: -4, background: '#f59e0b', color: '#000', borderRadius: '50%', width: 12, height: 12, fontSize: 8, fontWeight: 'bold', display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}>
                                            {pool[sym]}
                                        </div>
                                    )}
                                </div>
                                {/* - button */}
                                <button onClick={() => onRemove(sym)} style={{ width: '100%', height: 10, background: '#374151', border: 'none', color: '#9ca3af', fontSize: 8, cursor: 'pointer', borderRadius: 2, lineHeight: 1, opacity: pool[sym] ? 1 : 0.3 }} disabled={!pool[sym]}>-</button>
                            </div>
                        ))}
                    </div>
                </div>
            );
        };

        // ── COMBAT OVERLAY ────────────────────────────────────────────────────────
        // Shown during combat phase. Mode: 'attacking' (my turn) or 'blocking' (opponent's turn).
        const CombatOverlay = ({ mode, attackers, myCreatures, pendingAttackers, pendingBlocker, onToggleAttacker, onSetTarget, onDeclareAttackers, onToggleBlocker, onAssignBlock, onPassPriority, onEndCombat, onResolveCombat, opponentNames, blockerMap, combatState, getPlayerName, onToast }) => {
            const toast = onToast || (() => {});
            const [pos, setPos] = React.useState({ x: null, y: null });
            const dragRef = React.useRef(null);

            const handleMouseDown = (e) => {
                if (e.target.tagName === 'BUTTON' || e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT') return;
                const startX = e.clientX - (pos.x || 0);
                const startY = e.clientY - (pos.y || 0);
                const onMove = (me) => setPos({ x: me.clientX - startX, y: me.clientY - startY });
                const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
                window.addEventListener('mousemove', onMove);
                window.addEventListener('mouseup', onUp);
            };

            // Beim Angreifen müssen meine Kreaturen (oberste Reihe meiner Hälfte) frei anklickbar bleiben → ganz unten.
            const baseStyle = pos.x !== null
                ? { position:'fixed', left: pos.x, top: pos.y, transform:'none', bottom:'auto', cursor:'grab' }
                : { position:'fixed', bottom: mode === 'attacking' ? 8 : 80, left:'50%', transform:'translateX(-50%)', cursor:'grab' };
            const MANA_SYM = { W:'🌟', U:'💧', B:'💀', R:'🔥', G:'🌿' };

            if (mode === 'attacking') {
                const allReady = attackers.length > 0 && attackers.every(a => a.targetPlayerId);
                return (
                    <div onMouseDown={handleMouseDown} style={{ ...baseStyle, zIndex:500, background:'#1f2937', border:'2px solid #ef4444', borderRadius:12, padding:16, minWidth:360, maxWidth:600, boxShadow:'0 20px 40px rgba(0,0,0,0.8)', userSelect:'none' }}>
                        <div style={{ color:'#f87171', fontWeight:'bold', marginBottom:8, fontSize:14 }}>⚔️ Angreifer erklären</div>
                        <div style={{ color:'#9ca3af', fontSize:12, marginBottom:8 }}>Ungetappte Kreaturen anklicken, dann jeweils das Ziel wählen.</div>
                        {attackers.length > 0 && (
                            <div style={{ display:'flex', flexDirection:'column', gap:6, marginBottom:12, maxHeight:'clamp(56px, calc(50vh - 280px), 200px)', overflowY:'auto' }}>
                                {attackers.map(a => (
                                    <div key={a.card.instanceId} style={{ display:'flex', alignItems:'center', gap:8, background:'#111827', borderRadius:6, padding:'6px 10px' }}>
                                        <img src={a.card.image_url} style={{ width:32, height:44, borderRadius:3, border:'2px solid #ef4444' }} alt={a.card.name} />
                                        <span style={{ color:'#f87171', fontSize:12, flex:1 }}>{a.card.name}</span>
                                        <select
                                            style={{ background:'#374151', color:'white', border:'1px solid #4b5563', borderRadius:4, fontSize:11, padding:'2px 6px' }}
                                            value={a.targetPlayerId || ''}
                                            onChange={e => onSetTarget(a.card.instanceId, e.target.value)}
                                        >
                                            <option value="">— Ziel wählen —</option>
                                            {Object.entries(opponentNames).map(([id, name]) => (
                                                <option key={id} value={id}>{name}</option>
                                            ))}
                                        </select>
                                        <button onClick={() => onToggleAttacker(a.card)} style={{ color:'#6b7280', background:'none', border:'none', cursor:'pointer', fontSize:14 }}>✕</button>
                                    </div>
                                ))}
                            </div>
                        )}
                        <div style={{ display:'flex', gap:8, justifyContent:'flex-end' }}>
                            <button onClick={onEndCombat} style={{ background:'#374151', color:'#d1d5db', border:'none', borderRadius:6, padding:'6px 14px', cursor:'pointer', fontSize:12 }}>Abbrechen</button>
                            <button onClick={() => onDeclareAttackers(attackers)} disabled={!allReady}
                                style={{ background: allReady ? '#dc2626' : '#374151', color: allReady ? 'white' : '#6b7280', border:'none', borderRadius:6, padding:'6px 14px', cursor: allReady ? 'pointer' : 'not-allowed', fontSize:12, fontWeight:'bold' }}>
                                Angreifen →
                            </button>
                        </div>
                    </div>
                );
            }

            if (mode === 'blocking') {
                const myBlockMap = {}; // atkInstanceId → my blocker
                Object.entries(blockerMap || {}).forEach(([atkId, blk]) => {
                    if (blk.blockerOwnerId === combatState?.myUid) myBlockMap[atkId] = blk;
                });
                return (
                    <div onMouseDown={handleMouseDown} style={{ ...baseStyle, zIndex:500, background:'#1f2937', border:'2px solid #f59e0b', borderRadius:12, padding:16, minWidth:400, maxWidth:600, boxShadow:'0 20px 40px rgba(0,0,0,0.8)', userSelect:'none' }}>
                        <div style={{ color:'#fbbf24', fontWeight:'bold', marginBottom:6, fontSize:14 }}>🛡️ Blocker erklären</div>
                        <div style={{ color:'#9ca3af', fontSize:11, marginBottom:10 }}>
                            {pendingBlocker
                                ? `"${pendingBlocker.name}" selected — click an attacker to block it`
                                : 'Klicke eine deiner Kreaturen als Blocker an, dann den Angreifer'}
                        </div>
                        {/* My creatures — only valid blockers are clickable */}
                        <div style={{ marginBottom:8 }}>
                            <div style={{ color:'#6b7280', fontSize:10, marginBottom:4 }}>Deine Kreaturen:</div>
                            <div style={{ display:'flex', flexWrap:'wrap', gap:4 }}>
                                {myCreatures.filter(c => !c.isTapped).map(c => {
                                    const isSelected = pendingBlocker?.instanceId === c.instanceId;
                                    return (
                                        <div key={c.instanceId}
                                            onClick={() => onToggleBlocker(c)}
                                            style={{ cursor:'pointer', padding:2, borderRadius:4, border: isSelected ? '2px solid #facc15' : '1px solid #374151', opacity:1, transition:'all 0.15s' }}
                                        >
                                            <img src={c.image_url} style={{ width:36, height:50, borderRadius:3, display:'block' }} alt={c.name} />
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                        <div style={{ display:'flex', flexWrap:'wrap', gap:6, marginBottom:12 }}>
                            {attackers.filter(a => {
                                if (!a.targetPlayerId) return true;
                                if (a.targetPlayerId === combatState?.myUid) return true;
                                if (a.targetPlayerId.startsWith('pw_') && a.targetPlayerId.endsWith(`_${combatState?.myUid}`)) return true;
                                return false;
                            }).map(atk => {
                                const isBlocked = !!blockerMap?.[atk.instanceId];
                                const isPWTarget = atk.targetPlayerId?.startsWith('pw_');
                                const needsTwo = hasMenace(atk);
                                const needsFlying = hasFlying(atk);
                                const canBeBlocked = !pendingBlocker || canLegallyBlock(atk, pendingBlocker);
                                return (
                                    <div key={atk.instanceId}
                                        onClick={() => {
                                            if (!pendingBlocker) return;
                                            if (!canLegallyBlock(atk, pendingBlocker)) {
                                                toast(`❌ ${pendingBlocker.name} can't block ${atk.name} (${hasFlying(atk) ? 'Flying' : 'restriction'})`, 'red');
                                                return;
                                            }
                                            onAssignBlock(pendingBlocker, atk);
                                        }}
                                        style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:2, cursor: pendingBlocker ? (canBeBlocked ? 'pointer' : 'not-allowed') : 'default', padding:4, borderRadius:6, border: isBlocked ? '2px solid #22c55e' : '2px solid #ef4444', background: pendingBlocker && !canBeBlocked ? '#1a0a0a' : '#111827', opacity: pendingBlocker && !canBeBlocked ? 0.5 : 1, transition:'all 0.15s' }}
                                    >
                                        <img src={atk.image_url} style={{ width:44, height:60, borderRadius:3 }} alt={atk.name} />
                                        <span style={{ color: isBlocked ? '#4ade80' : '#f87171', fontSize:9, fontWeight:'bold' }}>{atk.name}</span>
                                        <div style={{ display:'flex', gap:2, flexWrap:'wrap', justifyContent:'center' }}>
                                            {needsFlying && <span style={{ color:'#93c5fd', fontSize:7, background:'#1e3a5f', borderRadius:2, padding:'0 2px' }}>✈ FLUG</span>}
                                            {needsTwo && <span style={{ color:'#f97316', fontSize:7, background:'#431407', borderRadius:2, padding:'0 2px' }}>⚔⚔ BEDR</span>}
                                            {isPWTarget && <span style={{ color:'#a78bfa', fontSize:7 }}>→🌟</span>}
                                            {isBlocked && <span style={{ color:'#4ade80', fontSize:7 }}>✓</span>}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                        <div style={{ display:'flex', gap:8, justifyContent:'flex-end' }}>
                            <button onClick={onPassPriority}
                                style={{ background:'#d97706', color:'white', border:'none', borderRadius:6, padding:'6px 14px', cursor:'pointer', fontSize:12, fontWeight:'bold' }}>
                                ✓ Kein Blocker / Priorität abgeben
                            </button>
                        </div>
                    </div>
                );
            }

            if (mode === 'resolving') {
                const [damageAssign, setDamageAssign] = React.useState({});

                // Build combat pairs — use module-level getPT which handles both p_t and power/toughness fields
                const pairs = (attackers||[]).map(atk => {
                    const blocker = (blockerMap || {})[atk.instanceId];
                    const [atkP] = getPT(atk);
                    const hasTrample = atk.oracle_text?.toLowerCase().includes('trample');
                    const hasDeathtouch = atk.oracle_text?.toLowerCase().includes('deathtouch');
                    const assigned = damageAssign[atk.instanceId] || {};
                    const totalAssigned = Object.values(assigned).reduce((s, n) => s + n, 0);
                    const remainingDmg = atkP - totalAssigned;
                    return { atk, blocker, atkP, hasTrample, hasDeathtouch, assigned, totalAssigned, remainingDmg };
                });

                const [damageStep, setDamageStep] = React.useState(0);
                // Step 0 = First Strike damage (only cards with First/Double Strike deal damage)
                // Step 1 = Normal damage (cards without First Strike, plus Double Strike again)
                const hasAnyFirstStrike = (attackers||[]).some(a => hasFirstStrike(a)) ||
                    Object.values(blockerMap||{}).some(b => hasFirstStrike(b));
                const stepsNeeded = hasAnyFirstStrike ? 2 : 1;

                // Which attackers deal damage this step?
                const activePairs = pairs.filter(p => {
                    if (!hasAnyFirstStrike) return true; // no FS involved — all deal together
                    if (damageStep === 0) return hasFirstStrike(p.atk) || (p.blocker && hasFirstStrike(p.blocker));
                    return true; // step 1: everything deals
                });

                const allAssigned = activePairs.every(p => {
                    if (!p.blocker) return true; // unblocked — no assignment needed
                    const [, blkT] = getPT(p.blocker);
                    if (p.hasTrample) {
                        // With trample, only need to assign at least min(blkT, atkP) — rest tramples through
                        return p.totalAssigned >= Math.min(blkT, p.atkP);
                    }
                    return p.totalAssigned === p.atkP;
                });

                return (
                    <div style={{ position:'fixed', inset:0, zIndex:500, background:'rgba(0,0,0,0.85)', display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}>
                        <div style={{ background:'#1f2937', border:'2px solid #22c55e', borderRadius:16, padding:20, minWidth:500, maxWidth:800, maxHeight:'85vh', overflowY:'auto', boxShadow:'0 20px 50px rgba(0,0,0,0.9)' }}>
                            <div style={{ color:'#4ade80', fontWeight:'bold', fontSize:16, marginBottom:4 }}>
                                💥 {hasAnyFirstStrike && stepsNeeded > 1 ? (damageStep === 0 ? '⚡ Erstschlag-Schaden' : 'Normaler Schaden') : 'Kampfschaden verteilen'}
                            </div>
                            <div style={{ color:'#6b7280', fontSize:12, marginBottom:16 }}>
                                {hasAnyFirstStrike && damageStep === 0
                                    ? 'First/Double Strike creatures deal damage first.'
                                    : 'Verteile die Stärke jedes Angreifers auf seine Blocker. Trampel-Überschuss trifft den verteidigenden Spieler.'}
                            </div>

                            <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
                                {activePairs.map(({ atk, blocker, atkP, hasTrample, hasDeathtouch, assigned, totalAssigned, remainingDmg }) => {
                                    const [, atkT] = getPT(atk);
                                    const [blkP, blkT] = blocker ? getPT(blocker) : [0,0];
                                    const blockerDies = blocker && (hasDeathtouch ? (assigned[blocker?.instanceId]||0) >= 1 : (assigned[blocker?.instanceId]||0) >= blkT);
                                    const attackerDies = blocker && blkP >= atkT;
                                    const trampleExcess = hasTrample && blocker ? Math.max(0, atkP - (assigned[blocker?.instanceId]||0)) : 0;

                                    return (
                                        <div key={atk.instanceId} style={{ background:'#111827', borderRadius:10, padding:12, border:`1px solid ${blocker ? '#374151' : '#dc2626'}` }}>
                                            <div style={{ display:'flex', alignItems:'center', gap:12 }}>
                                                {/* Attacker */}
                                                <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:4 }}>
                                                    <img src={atk.image_url} style={{ width:56, height:78, borderRadius:4, border: attackerDies ? '2px solid #ef4444' : '2px solid #6b7280' }} alt={atk.name} />
                                                    <div style={{ color:'#f87171', fontSize:10, fontWeight:'bold' }}>{atk.name}</div>
                                                    <div style={{ color:'#9ca3af', fontSize:10 }}>{getPTString(atk)}</div>
                                                    {attackerDies && <div style={{ color:'#ef4444', fontSize:9, fontWeight:'bold' }}>💀 STIRBT</div>}
                                                    {hasTrample && <div style={{ color:'#fb923c', fontSize:9 }}>Trampelschaden</div>}
                                                    {hasDeathtouch && <div style={{ color:'#a78bfa', fontSize:9 }}>Todesberührung</div>}
                                                </div>

                                                <div style={{ color:'#4b5563', fontSize:20 }}>→</div>

                                                {blocker ? (
                                                    <div style={{ flex:1 }}>
                                                        <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8 }}>
                                                            <img src={blocker.image_url} style={{ width:56, height:78, borderRadius:4, border: blockerDies ? '2px solid #ef4444' : '2px solid #22c55e' }} alt={blocker.name} />
                                                            <div>
                                                                <div style={{ color:'#4ade80', fontSize:11, fontWeight:'bold' }}>{blocker.name}</div>
                                                                <div style={{ color:'#9ca3af', fontSize:10 }}>{getPTString(blocker)}</div>
                                                                {blockerDies && <div style={{ color:'#ef4444', fontSize:9, fontWeight:'bold' }}>💀 STIRBT</div>}
                                                            </div>
                                                        </div>
                                                        {/* Damage input */}
                                                        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                                                            <div style={{ color:'#9ca3af', fontSize:11 }}>Schaden zuweisen:</div>
                                                            <input type="number" min={hasDeathtouch ? 1 : blkT} max={atkP}
                                                                value={assigned[blocker.instanceId] !== undefined ? assigned[blocker.instanceId] : ''}
                                                                placeholder={hasTrample ? `min ${blkT}` : `${atkP}`}
                                                                onChange={e => {
                                                                    const val = Math.min(atkP, Math.max(0, parseInt(e.target.value)||0));
                                                                    setDamageAssign(d => ({ ...d, [atk.instanceId]: { ...d[atk.instanceId], [blocker.instanceId]: val } }));
                                                                }}
                                                                style={{ width:60, background:'#1f2937', color:'white', border:'1px solid #374151', borderRadius:4, padding:'2px 6px', fontSize:12 }}
                                                            />
                                                            <div style={{ color:'#6b7280', fontSize:10 }}>/ {atkP} power</div>
                                                            {hasTrample && (assigned[blocker.instanceId]||0) >= 0 && (
                                                                <div style={{ color:'#fb923c', fontSize:10 }}>→ {Math.max(0, atkP - (assigned[blocker.instanceId]||0))} trample</div>
                                                            )}
                                                            <button onClick={() => setDamageAssign(d => ({ ...d, [atk.instanceId]: { [blocker.instanceId]: hasTrample ? blkT : atkP } }))}
                                                                style={{ background:'#374151', color:'#9ca3af', border:'none', borderRadius:4, padding:'2px 8px', cursor:'pointer', fontSize:10 }}>
                                                                Auto
                                                            </button>
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <div style={{ flex:1 }}>
                                                        <div style={{ color:'#f87171', fontSize:12 }}>
                                                            Ungeblockt – macht {atkP} Schaden an{' '}
                                                            {atk.targetPlayerId?.startsWith('pw_')
                                                                ? (opponentNames?.[atk.targetPlayerId] || '🌟 Planeswalker')
                                                                : atk.targetPlayerId
                                                                ? (getPlayerName ? getPlayerName(atk.targetPlayerId) : (opponentNames?.[atk.targetPlayerId] || 'opponent'))
                                                                : 'opponent'}
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>

                            <div style={{ display:'flex', gap:8, justifyContent:'flex-end', marginTop:16 }}>
                                <button onClick={onEndCombat} style={{ background:'#374151', color:'#d1d5db', border:'none', borderRadius:6, padding:'8px 16px', cursor:'pointer', fontSize:12 }}>Kampf beenden</button>
                                <button onClick={() => {
                                    const autoAssign = {};
                                    pairs.forEach(({ atk, blocker, atkP, hasTrample }) => {
                                        if (!blocker) return;
                                        const [, blkT] = getPT(blocker);
                                        autoAssign[atk.instanceId] = { [blocker.instanceId]: hasTrample ? blkT : atkP };
                                    });
                                    setDamageAssign(autoAssign);
                                }} style={{ background:'#374151', color:'#9ca3af', border:'1px solid #4b5563', borderRadius:6, padding:'8px 16px', cursor:'pointer', fontSize:12 }}>
                                    Alle automatisch
                                </button>
                                <button onClick={() => {
                                    if (hasAnyFirstStrike && damageStep === 0 && stepsNeeded > 1) {
                                        // Resolve first strike damage, then move to normal damage step
                                        onResolveCombat(damageAssign, true); // true = firstStrikeOnly
                                        setDamageAssign({});
                                        setDamageStep(1);
                                    } else {
                                        onResolveCombat(damageAssign, false);
                                    }
                                }} disabled={!allAssigned}
                                    style={{ background: allAssigned ? '#16a34a' : '#374151', color: allAssigned ? 'white' : '#6b7280', border:'none', borderRadius:6, padding:'8px 16px', cursor: allAssigned ? 'pointer' : 'not-allowed', fontSize:12, fontWeight:'bold' }}>
                                    {hasAnyFirstStrike && damageStep === 0 && stepsNeeded > 1 ? '⚡ Erstschlag auflösen →' : 'Schaden auflösen →'}
                                </button>
                            </div>
                        </div>
                    </div>
                );
            }
            return null;
        };

        // Handles all land ETB choices interactively.
        const LandETBModal = ({ modal, myBattlefield, myHand, myLandCount, myBasicCount, onResolve, onCancel }) => {
            const { card, type } = modal;
            const [selectedLand, setSelectedLand] = React.useState(null); // for bounce
            const [revealedCard, setRevealedCard] = React.useState(null); // for reveal

            const oracle = card.oracle_text || '';
            // Parse which subtypes a check/reveal land requires
            const checkMatch = oracle.toLowerCase().match(/enters tapped unless you control an? (\w+) or (\w+)/);
            const checkTypes = checkMatch ? [checkMatch[1], checkMatch[2]].map(s => s.charAt(0).toUpperCase()+s.slice(1)) : [];
            const revealMatch = oracle.toLowerCase().match(/reveal an? (\w+) or (\w+) card/);
            const revealTypes = revealMatch ? [revealMatch[1], revealMatch[2]].map(s => s.charAt(0).toUpperCase()+s.slice(1)) : [];

            // Auto-resolve conditions for check/fast/slow without showing modal
            // Liegt das Land schon auf dem Feld (aus einer Fetch-Suche), zählt es selbst nicht mit.
            const others = modal.onBf ? myBattlefield.filter(c => c.instanceId !== card.instanceId) : myBattlefield;
            const canEnterUntapped = {
                check: checkTypes.length > 0 && others.some(c => checkTypes.some(t => new RegExp(`\\b${t}\\b`,'i').test(c.type_line||''))),
                fast: (modal.onBf ? myLandCount - 1 : myLandCount) <= 2,
                slow: (modal.onBf ? others.filter(c => /\bBasic\b/i.test(c.type_line||'')).length : myBasicCount) >= 2,
            };
            const lifeCost = parseInt((oracle.match(/pay (\d+) life/i) || [])[1]) || 2;

            // For check/fast/slow: auto-place if condition is met
            React.useEffect(() => {
                if ((type === 'check' || type === 'fast' || type === 'slow') && canEnterUntapped[type]) {
                    onResolve(false); // enters untapped automatically
                }
            }, []);

            const img = (w=80,h=112) => <img src={card.image_url} alt={card.name} style={{ width:w, height:h, borderRadius:6, border:'2px solid #6b7280', boxShadow:'0 4px 12px rgba(0,0,0,0.5)' }} />;

            const wrap = (title, color, children) => ReactDOM.createPortal(
                <div style={{ position:'fixed', inset:0, zIndex:9999, background:'rgba(0,0,0,0.85)', display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}>
                    <div style={{ background:'#1f2937', border:`2px solid ${color}`, borderRadius:12, padding:20, maxWidth:480, width:'100%', boxShadow:'0 20px 50px rgba(0,0,0,0.8)' }}>
                        <div style={{ color, fontWeight:'bold', fontSize:16, marginBottom:12 }}>{title}</div>
                        {children}
                        <button onClick={onCancel} style={{ marginTop:12, background:'#374151', color:'#9ca3af', border:'none', borderRadius:6, padding:'6px 14px', cursor:'pointer', fontSize:12 }}>Abbrechen</button>
                    </div>
                </div>, (document.getElementById('arena-portal') || document.body)
            );

            if (type === 'shock' || type === 'shock_fetch') return wrap(`⚡ ${card.name}`, '#ef4444',
                <div data-testid="land-etb-shock">
                    <div style={{ display:'flex', gap:12, alignItems:'center', marginBottom:16 }}>
                        {img()}
                        <p style={{ color:'#d1d5db', fontSize:13 }}>Wie kommt {card.name} ins Spiel? Du kannst {lifeCost} Leben zahlen, sonst kommt es getappt.</p>
                    </div>
                    <div style={{ display:'flex', gap:8 }}>
                        <button onClick={() => onResolve(false, { life: -lifeCost })} style={{ flex:1, background:'#dc2626', color:'white', border:'none', borderRadius:8, padding:'12px 8px', cursor:'pointer', fontWeight:'bold', fontSize:13 }}>
                            ⚡ Ungetappt<br/><span style={{ fontSize:11, opacity:0.8 }}>{lifeCost} Leben zahlen</span>
                        </button>
                        <button onClick={() => onResolve(true)} style={{ flex:1, background:'#374151', color:'#d1d5db', border:'1px solid #4b5563', borderRadius:8, padding:'12px 8px', cursor:'pointer', fontWeight:'bold', fontSize:13 }}>
                            💤 Getappt<br/><span style={{ fontSize:11, opacity:0.8 }}>Keine Kosten</span>
                        </button>
                    </div>
                </div>
            );

            if (type === 'bounce') {
                const myLands = myBattlefield.filter(c => isLand(c));
                return wrap(`↩ ${card.name} — Bounce Land`, '#60a5fa',
                    <div>
                        <p style={{ color:'#d1d5db', fontSize:13, marginBottom:10 }}>{card.name} kommt getappt ins Spiel. Bringe ein Land, das du kontrollierst, auf die Hand zurück:</p>
                        {myLands.length === 0
                            ? <p style={{ color:'#9ca3af', fontSize:12 }}>Kein Land zum Zurücknehmen – getappt kostenlos ins Spiel.</p>
                            : <div style={{ display:'flex', flexWrap:'wrap', gap:6, marginBottom:12, maxHeight:180, overflowY:'auto' }}>
                                {myLands.map(l => (
                                    <div key={l.instanceId} onClick={() => setSelectedLand(l)}
                                        style={{ cursor:'pointer', borderRadius:4, border: selectedLand?.instanceId === l.instanceId ? '2px solid #60a5fa' : '1px solid #374151', padding:2 }}>
                                        <img src={l.image_url} style={{ width:44, height:60, borderRadius:3, display:'block' }} alt={l.name} />
                                    </div>
                                ))}
                            </div>
                        }
                        <button onClick={() => {
                            if (!selectedLand && myLands.length > 0) return;
                            onResolve(true, selectedLand ? { bounce: selectedLand } : {});
                        }} disabled={myLands.length > 0 && !selectedLand}
                            style={{ background: (myLands.length === 0 || selectedLand) ? '#2563eb' : '#374151', color:'white', border:'none', borderRadius:6, padding:'8px 16px', cursor: (myLands.length === 0 || selectedLand) ? 'pointer' : 'not-allowed', fontWeight:'bold', fontSize:13 }}>
                            {selectedLand ? `${selectedLand.name} zurück & legen` : myLands.length === 0 ? 'Getappt legen' : 'Erst ein Land wählen'}
                        </button>
                    </div>
                );
            }

            if (type === 'reveal') {
                const validCards = myHand.filter(c => revealTypes.some(t => new RegExp(`\\b${t}\\b`,'i').test(c.type_line||'')));
                return wrap(`👁 ${card.name} — Reveal Land`, '#a78bfa',
                    <div>
                        <p style={{ color:'#d1d5db', fontSize:13, marginBottom:10 }}>
                            Decke ein {revealTypes.join(' oder ')} aus der Hand auf, damit es ungetappt kommt – oder lege es getappt:
                        </p>
                        {validCards.length > 0 && (
                            <div style={{ display:'flex', gap:6, marginBottom:12, flexWrap:'wrap' }}>
                                {validCards.map(c => (
                                    <div key={c.instanceId} onClick={() => setRevealedCard(prev => prev?.instanceId === c.instanceId ? null : c)}
                                        style={{ cursor:'pointer', border: revealedCard?.instanceId === c.instanceId ? '2px solid #a78bfa' : '1px solid #374151', borderRadius:4, padding:2 }}>
                                        <img src={c.image_url} style={{ width:44, height:60, borderRadius:3 }} alt={c.name} />
                                    </div>
                                ))}
                            </div>
                        )}
                        <div style={{ display:'flex', gap:8 }}>
                            {validCards.length > 0 && <button onClick={() => revealedCard && onResolve(false)}
                                disabled={!revealedCard}
                                style={{ flex:1, background: revealedCard ? '#7c3aed' : '#374151', color:'white', border:'none', borderRadius:6, padding:'8px', cursor: revealedCard ? 'pointer' : 'not-allowed', fontWeight:'bold', fontSize:12 }}>
                                Aufdecken & ungetappt
                            </button>}
                            <button onClick={() => onResolve(true)} style={{ flex:1, background:'#374151', color:'#d1d5db', border:'1px solid #4b5563', borderRadius:6, padding:'8px', cursor:'pointer', fontSize:12 }}>
                                Getappt ins Spiel
                            </button>
                        </div>
                    </div>
                );
            }

            // Scry, Surveil, Check (auto-handled if condition met), Slow, Fast, Triome — just place tapped
            return wrap(`🌍 ${card.name}`, '#22c55e',
                <div>
                    <div style={{ display:'flex', gap:12, alignItems:'center', marginBottom:16 }}>
                        {img()}
                        <div>
                            <p style={{ color:'#d1d5db', fontSize:13, marginBottom:6 }}>
                                {type === 'scry' && 'Kommt getappt ins Spiel, dann Hellsicht 1.'}
                                {type === 'surveil' && 'Kommt getappt ins Spiel, dann Überwachen 1.'}
                                {(type === 'triome' || type === 'tapped') && 'Kommt getappt ins Spiel.'}
                                {(type === 'check' || type === 'fast' || type === 'slow') && 'Kommt getappt ins Spiel (Bedingung nicht erfüllt).'}
                            </p>
                            <p style={{ color:'#6b7280', fontSize:11 }}>{card.name}</p>
                        </div>
                    </div>
                    <button onClick={() => onResolve(true)} style={{ background:'#15803d', color:'white', border:'none', borderRadius:6, padding:'8px 20px', cursor:'pointer', fontWeight:'bold', fontSize:13 }}>
                        Getappt legen {type === 'scry' ? '→ dann Hellsicht 1' : type === 'surveil' ? '→ dann Überwachen 1' : ''}
                    </button>
                </div>
            );
        };

        const CrewModal = ({ modal, myBattlefield, onCrew, onCancel }) => {
            const { vehicle } = modal;
            const crewCost = (vehicle.oracle_text || '').match(/\bcrew\s+(\d+)/i);
            const needed = crewCost ? parseInt(crewCost[1]) : 0;
            const [selected, setSelected] = React.useState([]);

            // Only untapped non-vehicle creatures (can't crew with the vehicle itself)
            const candidates = myBattlefield.filter(c =>
                !c.isTapped &&
                isCreatureLike(c) &&
                c.instanceId !== vehicle.instanceId
            );

            const totalPower = selected.reduce((s, c) => s + effectivePT(c)[0], 0);
            const ready = totalPower >= needed;

            const toggle = (c) => setSelected(prev =>
                prev.find(x => x.instanceId === c.instanceId)
                    ? prev.filter(x => x.instanceId !== c.instanceId)
                    : [...prev, c]
            );

            return ReactDOM.createPortal(
                <div style={{ position:'fixed', inset:0, zIndex:9999, background:'rgba(0,0,0,0.85)', display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}>
                    <div style={{ background:'#1f2937', border:'2px solid #3b82f6', borderRadius:12, padding:20, maxWidth:520, width:'100%', boxShadow:'0 20px 50px rgba(0,0,0,0.8)' }}>
                        <div style={{ color:'#60a5fa', fontWeight:'bold', fontSize:16, marginBottom:4 }}>🚗 Crew {needed} — {vehicle.name}</div>
                        <div style={{ color:'#6b7280', fontSize:12, marginBottom:12 }}>
                            Select untapped creatures with total power ≥ {needed}.
                            Currently selected: <span style={{ color: ready ? '#4ade80' : '#f87171', fontWeight:'bold' }}>{totalPower} / {needed} power</span>
                        </div>
                        {candidates.length === 0
                            ? <p style={{ color:'#9ca3af', fontSize:13 }}>Keine ungetappten Kreaturen zum Bemannen.</p>
                            : <div style={{ display:'flex', flexWrap:'wrap', gap:8, maxHeight:240, overflowY:'auto', marginBottom:16 }}>
                                {candidates.map(c => {
                                    const isSel = selected.some(x => x.instanceId === c.instanceId);
                                    return (
                                        <div key={c.instanceId} onClick={() => toggle(c)}
                                            style={{ cursor:'pointer', borderRadius:6, border: isSel ? '2px solid #3b82f6' : '1px solid #374151', padding:4, background: isSel ? '#1e3a5f' : '#111827', transition:'all 0.15s', position:'relative' }}>
                                            <img src={c.image_url} style={{ width:52, height:72, borderRadius:4, display:'block' }} alt={c.name} />
                                            <div style={{ position:'absolute', bottom:2, right:2, background:'rgba(0,0,0,0.8)', color:'white', fontSize:9, fontWeight:'bold', borderRadius:3, padding:'0 3px' }}>
                                                {getPTString(c)}
                                            </div>
                                            <div style={{ color:'#9ca3af', fontSize:8, textAlign:'center', marginTop:2, maxWidth:52, overflow:'hidden', whiteSpace:'nowrap', textOverflow:'ellipsis' }}>
                                                {getPTString(c)} — {c.name}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        }
                        <div style={{ display:'flex', gap:8, justifyContent:'flex-end' }}>
                            <button onClick={onCancel} style={{ background:'#374151', color:'#d1d5db', border:'none', borderRadius:6, padding:'8px 16px', cursor:'pointer', fontSize:13 }}>Abbrechen</button>
                            <button onClick={() => ready && onCrew(vehicle, modal.zone, selected)} disabled={!ready}
                                style={{ background: ready ? '#2563eb' : '#374151', color: ready ? 'white' : '#6b7280', border:'none', borderRadius:6, padding:'8px 16px', cursor: ready ? 'pointer' : 'not-allowed', fontWeight:'bold', fontSize:13 }}>
                                🚗 Crew with {totalPower} power
                            </button>
                        </div>
                    </div>
                </div>,
                (document.getElementById('arena-portal') || document.body)
            );
        };

        // ── ZUGPHASEN ─────────────────────────────────────────────────────────────
        // Gemeinsamer Zustand im Raum-Dokument: phase = { step, turn, player, first?, at }.
        // turn zählt die Züge am Tisch (1 = erster Zug des Spiels, 0 = Altspiel ohne Phasen), player ist der
        // aktive Spieler, für den die Phase gilt. Fehlt das Feld (oder passt player nicht zu activePlayer),
        // gilt „Hauptphase 1“ – so laufen alte Spiele weiter.
        // Commander-Wahl: Zielzone (moveCardToZone) → Zone im Spielstand, Beschriftungen
        const CMD_ASK_ZONES = { graveyard: 'graveyard', exile: 'exile', hand: 'hand', library_top: 'library', library_bottom: 'library' };
        const CMD_ZONE_LABEL = { graveyard: 'Friedhof', exile: 'Exil', hand: 'Hand', library: 'Bibliothek' };
        const CMD_ZONE_IN = { graveyard: 'im Friedhof', exile: 'im Exil', hand: 'auf der Hand', library: 'in der Bibliothek' };
        const PHASE_STEPS = ['untap', 'upkeep', 'draw', 'main1', 'combat_begin', 'combat_attack', 'combat_block', 'combat_damage', 'combat_end', 'main2', 'end', 'cleanup'];
        const PHASE_LABEL = { untap: 'Enttappen', upkeep: 'Versorgung', draw: 'Ziehen', main1: 'Hauptphase 1', combat_begin: 'Beginn des Kampfes', combat_attack: 'Angreifer erklären', combat_block: 'Blocker erklären', combat_damage: 'Kampfschaden', combat_end: 'Kampfende', main2: 'Hauptphase 2', end: 'Endschritt', cleanup: 'Aufräumen' };
        const PHASE_SHORT = { untap: 'Enttap.', upkeep: 'Versorg.', draw: 'Ziehen', main1: 'Haupt 1', combat_begin: 'Beginn', combat_attack: 'Angriff', combat_block: 'Blocker', combat_damage: 'Schaden', combat_end: 'Kampfende', main2: 'Haupt 2', end: 'Endschr.', cleanup: 'Aufr.' };
        const PHASE_BLOCKS = [
            { key: 'begin', label: 'Anfang', steps: ['untap', 'upkeep', 'draw'] },
            { key: 'main1', label: 'Haupt 1', steps: ['main1'] },
            { key: 'combat', label: 'Kampf', steps: ['combat_begin', 'combat_attack', 'combat_block', 'combat_damage', 'combat_end'] },
            { key: 'main2', label: 'Haupt 2', steps: ['main2'] },
            { key: 'end', label: 'Ende', steps: ['end', 'cleanup'] },
        ];
        const stepIdx = (s) => PHASE_STEPS.indexOf(s);
        const isCombatStep = (s) => typeof s === 'string' && s.startsWith('combat_');
        // Blocker und Schaden erreicht man nur über „Weiter“ (Angreifer bestätigen, Blocker abwarten).
        const isJumpTarget = (s) => s !== 'combat_block' && s !== 'combat_damage';

        // Kartengröße auf dem eigenen Spielfeld (unskaliert) und Höhe der Phasenleiste / des Hand-Reiters.
        const CARD_W = 90;
        const CARD_H = 120;
        const PHASE_BAR_H = 28;
        // Abstand der Phasenleiste zur Tischmitte, damit ihr Goldrand auch oben vollständig sichtbar ist.
        const PHASE_BAR_TOP = 4;
        const HAND_TAB_H = 22;
        // Grüner Rahmen der Hälfte des aktiven Spielers. Als Inline-Schatten, weil die Tailwind-ring-Klassen ohne
        // Preflight/Base (keine --tw-ring-*-Startwerte) keinen gültigen box-shadow ergeben.
        const ACTIVE_RING = 'inset 0 0 0 4px rgba(120, 171, 111, 0.7)';
        // Geometrie meiner Spielfeldhälfte: Phasenleiste oben, darunter drei Reihen zu je einer Kartenhöhe
        // (Kreaturen · Länder|Planeswalker · Verzauberungen|Artefakte), Rest unten frei für den Hand-Reiter.
        // Passen drei Reihen nicht in die Höhe, werden die Karten skaliert (min. 0,75).
        const computeBfGeom = (bfWidth, bfHeight, leftX, rightX) => {
            const avail = bfHeight - PHASE_BAR_TOP - PHASE_BAR_H - HAND_TAB_H - 6;
            const scale = Math.max(0.75, Math.min(1, avail / (3 * CARD_H)));
            const cw = CARD_W * scale, ch = CARD_H * scale;
            const top1 = PHASE_BAR_TOP + PHASE_BAR_H + 2, top2 = top1 + ch, top3 = top2 + ch;
            const zW = Math.max(rightX - leftX, cw);
            const landSplit = leftX + zW * 0.65, halfSplit = leftX + zW * 0.5;
            // Seitenabstand, damit getappte (gedrehte) Karten nicht unter die Seitenleisten ragen
            const pad = (ch - cw) / 2 + 2;
            const zones = {
                creature: { left: leftX, right: leftX + zW, top: top1, label: 'Kreaturen', color: 'rgba(74,222,128,0.3)', text: '#bbf7d0' },
                land: { left: leftX, right: landSplit, top: top2, label: 'Länder', color: 'rgba(234,179,8,0.3)', text: '#fde68a' },
                planeswalker: { left: landSplit, right: leftX + zW, top: top2, label: 'Planeswalker', color: 'rgba(239,68,68,0.3)', text: '#fca5a5' },
                enchantment: { left: leftX, right: halfSplit, top: top3, label: 'Verzaubern', color: 'rgba(168,85,247,0.3)', text: '#d8b4fe' },
                artifact: { left: halfSplit, right: leftX + zW, top: top3, label: 'Artefakte', color: 'rgba(249,115,22,0.3)', text: '#fed7aa' },
            };
            return { scale, cw, ch, pad, zones, bfWidth, bfHeight };
        };
        // Gegnerhälfte = meine Hälfte vertikal gespiegelt: gleiche Breiten, Höhen und Skalierung, aber die
        // Kreaturenreihe liegt unten (zur Tischmitte hin), Verzauberungen/Artefakte oben am Bildschirmrand.
        const mirrorBfGeom = (geom) => ({
            ...geom,
            mirrored: true,
            zones: Object.fromEntries(Object.entries(geom.zones).map(([t, z]) => [t, { ...z, top: geom.bfHeight - z.top - geom.ch }])),
        });
        // x-Position des i-ten von n Karten in einer Zone: nebeneinander, bei Platzmangel enger zusammen (Fächer),
        // nie eine zweite Reihe.
        const fanX = (zone, geom, i, n) => {
            const left = zone.left + geom.pad, width = Math.max(zone.right - zone.left - 2 * geom.pad, geom.cw);
            if (n <= 1) return left;
            const step = Math.min(geom.cw + 4, Math.max(0, (width - geom.cw) / (n - 1)));
            return left + i * step;
        };
        // Pixel-Positionen aller Karten meines Spielfelds: Zone nach Kartentyp, Reihenfolge nach gespeichertem x.
        const layoutMyCards = (cards, geom) => {
            const byType = {};
            cards.forEach((c, idx) => { const t = getCardZoneType(c); (byType[t] = byType[t] || []).push({ c, idx }); });
            const out = {};
            Object.entries(byType).forEach(([t, list]) => {
                list.sort((a, b) => ((a.c.x ?? 0) - (b.c.x ?? 0)) || (a.idx - b.idx));
                const zone = geom.zones[t] || geom.zones.creature;
                list.forEach(({ c }, i) => { out[c.instanceId] = { px: fanX(zone, geom, i, list.length), py: zone.top, rank: i }; });
            });
            return out;
        };

        // ── TRIGGER-HINWEISE ──────────────────────────────────────────────────────
        // Nur Erinnerungen: welche meiner Permanents laut Regeltext jetzt auslösen. Erinnerungstext in Klammern
        // wird ignoriert, doppelseitige Karten liefern beide Seiten.
        const hintText = (card) => {
            const t = card?.oracle_text || (Array.isArray(card?.card_faces) ? card.card_faces.map(f => f?.oracle_text || '').filter(Boolean).join('\n') : '') || card?.ability || '';
            return String(t).replace(/\([^)]*\)/g, '');
        };
        const hintSentences = (card) => hintText(card).split(/\n+|(?<=[.!])\s+(?=[A-Z•])/).map(s => s.trim()).filter(Boolean);
        const hintCanDraw = (s) => /\bdraws? (?:a card|cards|\w+ cards)\b/i.test(s);
        // „your“ nur im eigenen Zug, „each opponent's“ nur im Zug eines Gegners, „each“/„the next“ immer.
        const whoseOk = (who, isMyTurn) => {
            const w = (who || '').trim().toLowerCase();
            if (w.startsWith('your')) return isMyTurn;
            if (w.startsWith("each opponent") || w.startsWith('an opponent')) return !isMyTurn;
            return true;
        };
        const STEP_HINT_RULES = {
            upkeep: { re: /at the beginning of (your next |your |each opponent's |each player's |each |the next )upkeep/i, reason: 'Versorgung' },
            draw: { re: /at the beginning of (your |each opponent's |each player's |each )draw step/i, reason: 'Ziehphase' },
            combat_begin: { re: /at the beginning of (?:combat on (your |each opponent's )turn|(each )combat)/i, reason: 'Beginn des Kampfes' },
            end: { re: /at the beginning of (your next |your |each opponent's |each player's |each |the next )end step/i, reason: 'Endschritt' },
        };
        const stepHintsFor = (card, step, isMyTurn) => {
            const rule = STEP_HINT_RULES[step];
            if (!rule) return [];
            return hintSentences(card).filter(s => { const m = s.match(rule.re); return m && whoseOk(m[1] || m[2] || m[3] || 'each', isMyTurn); })
                .map(s => ({ sentence: s, reason: rule.reason }));
        };
        // „Whenever … attacks“: eigene Angreifer (Name, Kurzname, „this creature“) oder „a creature you control attacks“.
        const attackHintsFor = (card, isAttacking, anyAttack) => {
            const name = (card?.name || '').split(' // ')[0].toLowerCase();
            const short = name.split(',')[0].trim();
            return hintSentences(card).filter(s => {
                const m = s.match(/whenever (.+?) attacks?\b/i);
                if (!m) return /whenever you attack\b/i.test(s) && anyAttack;
                const subj = m[1].toLowerCase().trim();
                if (/creatures? you control|you attack/.test(subj)) return anyAttack;
                if (/equipped creature|enchanted creature/.test(subj)) return false; // über den Träger geprüft
                if (subj === name || subj === short || /^(this creature|this vehicle|it|~)$/.test(subj)) return isAttacking;
                return false;
            }).map(s => ({ sentence: s, reason: 'Angriff' }));
        };
        const attachmentAttackHintsFor = (card) => hintSentences(card).filter(s => /whenever (equipped|enchanted) creature attacks/i.test(s)).map(s => ({ sentence: s, reason: 'Angriff (Träger)' }));
        const combatEnterHintsFor = (card) => hintSentences(card).filter(s => /during combat/i.test(s) && /\benters?\b/i.test(s)).map(s => ({ sentence: s, reason: 'Kreatur kam im Kampf ins Spiel' }));
        // Zauberauslöser eines Permanents für den gewirkten Zauber: [{ sentence, effects, clause }]
        const castTriggersFor = (perm, spell) => {
            if (!perm || !spell || perm.instanceId === spell.instanceId) return [];
            const out = [];
            hintSentences(perm).forEach(s => {
                // Fähigkeitswort davor („Magecraft — Whenever you cast …“) abtrennen
                const m = s.replace(/^[A-Za-z][A-Za-z' ]*\s+[—–-]\s+/, '').match(CAST_TRIGGER_RE);
                if (!m) return;
                // Magecraft: „Whenever you cast or copy an instant or sorcery spell“ → Filter ohne „or copy“
                if (!spellFilterOk(m[1].replace(/^or copy (?:an? )?/i, ''), spell)) return;
                if (m[2]) {
                    const n = Number(m[2]), mv = manaValueOf(spell);
                    if (/greater|more/i.test(m[3]) ? mv < n : mv > n) return;
                }
                out.push({ sentence: s, clause: m[4], effects: parseSimpleEffects(m[4]) });
            });
            return out;
        };
        // „… if a player/an opponent lost N or more life this turn …“ → { who, n } oder null
        const lifeLostCondition = (s) => {
            const m = String(s).match(/if (a player|an opponent|you) lost (\d+|one|two|three|four|five|six|seven|eight|nine|ten) or more life this turn/i);
            return m ? { who: m[1].toLowerCase(), n: toNum(m[2]) } : null;
        };
        // Aktion „vor Spielbeginn“ einer Handkarte (Leylines, Gemstone Caverns, Chancellors …) oder null
        const pregameActionOf = (card) => {
            const t = String(getOracleTextForParsing(card) || '').replace(/\([^)]*\)/g, '');
            const s = t.split(/\n+/).find(l => /opening hand/i.test(l));
            if (!s) return null;
            if (/begin the game with (?:it|this card|[^.]+?) on the battlefield/i.test(s)) {
                const counter = (s.match(/with an? ([a-z]+) counter on it/i) || [])[1] || null;
                return { type: 'battlefield', counter, exileFromHand: /exile a card from your hand/i.test(s), sentence: s.trim() };
            }
            if (/\breveal\b/i.test(s)) return { type: 'reveal', sentence: s.trim(), mana: /first main phase/i.test(s) };
            return { type: 'other', sentence: s.trim() };
        };

        // Phasenleiste („Leiste 3“): fünf Blöcke in einer Reihe, der aktive klappt seine Schritte auf.
        const PhaseBar = ({ step, ownerName, canControl, lockTitle, onJump, onNext, nextDisabled, nextTitle, extra, flash }) => {
            const cur = stepIdx(step);
            return (
                // Randfarbe inline: die globale Regel „.arena-root .rounded-lg.border“ (arena.css) würde sonst die
                // Tailwind-Farbe überstimmen – der Aufblitz-Effekt beim Phasenwechsel wäre unsichtbar.
                <div data-testid="phase-bar" className="h-7 flex items-center gap-1 px-1 rounded-lg bg-gray-950/90 border-solid border shadow-lg select-none transition-colors" style={{ fontSize: 11, borderColor: flash ? '#dcbd76' : 'rgba(212, 180, 106, 0.55)' }}>
                    {ownerName && (
                        <span className="text-gray-400 whitespace-nowrap px-1 truncate flex-shrink min-w-0" style={{ maxWidth: 130 }} title={`Phase von ${ownerName}`}>Phase von <b className="text-yellow-300">{ownerName}</b></span>
                    )}
                    <div className="flex items-center gap-0.5 flex-1 min-w-0 justify-center">
                        {PHASE_BLOCKS.map((b) => {
                            const active = b.steps.includes(step);
                            const past = stepIdx(b.steps[b.steps.length - 1]) < cur;
                            const full = b.steps.map(s => PHASE_LABEL[s]).join(' · ');
                            if (!active) {
                                const can = canControl && !past;
                                return (
                                    <button key={b.key} disabled={!can} onClick={() => can && onJump(b.steps[0])}
                                        title={past ? full : can ? `Springe zu: ${PHASE_LABEL[b.steps[0]]} (${full})` : (lockTitle || full)}
                                        className={`px-1.5 py-0.5 rounded border-0 bg-transparent whitespace-nowrap ${past ? 'text-gray-600' : can ? 'text-gray-300 hover:bg-gray-800 hover:text-yellow-300' : 'text-gray-500'}`}
                                    >{b.label}</button>
                                );
                            }
                            // Ein-Schritt-Block (Haupt 1 / Haupt 2): nur eine hervorgehobene Pille, kein doppelter Name.
                            if (b.steps.length === 1) {
                                return (
                                    <div key={b.key} className="flex items-center rounded-md px-0.5 bg-yellow-900/40 border-solid border border-yellow-600/50 whitespace-nowrap" title={full}>
                                        <button data-step={b.steps[0]} title={`Aktuell: ${full}`} style={{ cursor: 'default' }}
                                            className="px-2 rounded-full border-0 leading-5 bg-amber-400 text-gray-950 font-bold shadow"
                                        >{b.label}</button>
                                    </div>
                                );
                            }
                            return (
                                <div key={b.key} className="flex items-center gap-0.5 rounded-md px-1 bg-yellow-900/40 border-solid border border-yellow-600/50 whitespace-nowrap" title={full}>
                                    <span className="text-yellow-300 font-bold px-0.5">{b.label}</span>
                                    {b.steps.map(s => {
                                        const si = stepIdx(s);
                                        const isCur = s === step;
                                        const can = canControl && si > cur && isJumpTarget(s);
                                        return (
                                            <button key={s} data-step={s} disabled={!can && !isCur} onClick={() => can && onJump(s)}
                                                title={isCur ? `Aktuell: ${PHASE_LABEL[s]}` : can ? `Springe zu: ${PHASE_LABEL[s]}` : si < cur ? PHASE_LABEL[s] : (!isJumpTarget(s) && canControl ? `${PHASE_LABEL[s]} – nur über „Weiter“` : (lockTitle || PHASE_LABEL[s]))}
                                                className={`px-1.5 rounded-full border-0 leading-5 ${isCur ? 'bg-amber-400 text-gray-950 font-bold shadow' : si < cur ? 'bg-transparent text-gray-500' : can ? 'bg-transparent text-gray-200 hover:bg-gray-800' : 'bg-transparent text-gray-400'}`}
                                            >{PHASE_SHORT[s]}</button>
                                        );
                                    })}
                                </div>
                            );
                        })}
                    </div>
                    {extra}
                    <button onClick={onNext} disabled={nextDisabled} title={nextTitle} aria-label="Nächster Schritt"
                        className={`w-7 h-5 flex-shrink-0 rounded font-bold border-0 leading-none ${nextDisabled ? 'bg-gray-800 text-gray-600' : 'bg-yellow-600 hover:bg-yellow-500 text-gray-950'}`}
                    >▸</button>
                </div>
            );
        };

        // Gestapelte Trigger-Hinweise (nur für den Besitzer der Karte), max. 4 sichtbar.
        const HintStack = ({ hints, onDraw, onDismiss }) => {
            if (!hints.length) return null;
            const shown = hints.slice(-4);
            return ReactDOM.createPortal(
                <div data-testid="hint-stack" style={{ position: 'fixed', left: '50%', bottom: 'calc(50% + 6px)', transform: 'translateX(-50%)', zIndex: 600, display: 'flex', flexDirection: 'column', gap: 6, width: 400, maxWidth: 'calc(100vw - 500px)' }}>
                    {hints.length > shown.length && <div style={{ color: '#a0967f', fontSize: 11, textAlign: 'center' }}>+{hints.length - shown.length} weitere</div>}
                    {shown.map(h => (
                        <div key={h.id} className="hint-card" style={{ background: 'rgba(21,20,17,0.96)', border: '1px solid #d4b46a', borderRadius: 8, padding: '6px 8px', boxShadow: '0 8px 24px rgba(0,0,0,0.6)', color: '#ece4cf', fontSize: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div style={{ flex: 1, minWidth: 0 }} title={h.sentence}>
                                <div style={{ fontWeight: 'bold', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>⚡ {h.cardName}: <span style={{ color: '#e4c886' }}>{h.reason}</span></div>
                                <div style={{ color: '#a0967f', fontSize: 10.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{h.sentence}</div>
                            </div>
                            {h.canDraw && <button onClick={() => onDraw(h)} style={{ background: '#4e647b', color: 'white', border: 'none', borderRadius: 5, padding: '3px 8px', fontSize: 11, fontWeight: 'bold', whiteSpace: 'nowrap' }}>Karte ziehen</button>}
                            <button onClick={() => onDismiss(h)} style={{ background: '#2f2c26', color: '#dcd1b6', border: '1px solid #5e4f2c', borderRadius: 5, padding: '3px 8px', fontSize: 11, fontWeight: 'bold' }}>OK</button>
                        </div>
                    ))}
                </div>,
                (document.getElementById('arena-portal') || document.body)
            );
        };

        const GameSim = ({ deck, onLeave, roomId }) => {
            // --- REFACTOR: State is now split ---
            const [lobbyState, setLobbyState] = useState(null); // Data from the main room doc
            const [myState, setMyState] = useState(null); // Data from .../game_state/<my_uid>
            const [opponentStates, setOpponentStates] = useState({}); // { [uid]: stateData } for every other player            
            const [loading, setLoading] = useState(true);
            const [opponentMaximized, setOpponentMaximized] = useState(false);
            // null = grid view (all opponent tiles equal size); otherwise the uid of the opponent currently
            // expanded to take up the top 50%/80% area, in the 3-4 player layout.
            const [expandedOpponentId, setExpandedOpponentId] = useState(null);
            // Stores the pixel boundaries of each card zone, measured from the real DOM elements, so the
            // visual zone markers can draw exactly flush against the hand zone and sidebars with no mismatch.
            const [zoneBounds, setZoneBounds] = useState(null);
            const [viewingZone, setViewingZone] = useState(null); 
            const [draggedCard, setDraggedCard] = useState(null);
            const [hoveredCard, setHoveredCard] = useState(null);
            const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
            const [libraryMenu, setLibraryMenu] = useState(null);
            const [topCardView, setTopCardView] = useState(null);
            const [libraryActionModal, setLibraryActionModal] = useState(null);
            // { mode: 'scry'|'surveil'|'look', cards: [...], decisions: {instanceId: 'top'|'bottom'|'hand'|'graveyard'|'reveal'} }
            const [myHandMinimized, setMyHandMinimized] = useState(false);

            const [leaveGameModal, setLeaveGameModal] = useState(false);
            const [gameResult, setGameResult] = useState({ winner: '', confirmed: false });
            
            const [isTokenModalOpen, setTokenModalOpen] = useState(false);
            const [cardMenu, setCardMenu] = useState(null); 
            const [fetchModal, setFetchModal] = useState(null);
            // { card, zone, ability: { type, subtypes, count }, selected: [] }
            // null = not in card-selection mode; array of selected instanceIds while choosing cards to bottom.
            const [bottomingCards, setBottomingCards] = useState(null);
            const [startGameModalDismissed, setStartGameModalDismissedRaw] = useState(() => { try { return sessionStorage.getItem('arena-start-' + roomId) === '1' } catch { return false } });
            const setStartGameModalDismissed = (v) => { try { if (v) sessionStorage.setItem('arena-start-' + roomId, '1') } catch {} setStartGameModalDismissedRaw(v) };
            // null = no prompt; otherwise the tokenSpec of an Aura token waiting for me to choose a creature.
            const [auraAttachPrompt, setAuraAttachPrompt] = useState(null);
            const [emblemModalOpen, setEmblemModalOpen] = useState(false);
            // null = no prompt; otherwise the emblem object waiting for a Ring-bearer choice.
            const [ringAdvancePrompt, setRingAdvancePrompt] = useState(null);
            // null = no discard needed; otherwise shown when a player tries to end their turn with >7 cards.
            const [discardModal, setDiscardModal] = useState(false);
            // Reset the discard prompt once the hand is back to 7 or fewer (otherwise drawing to 8 later reopens it).
            const myHandLen = myState?.hand?.length ?? 0;
            useEffect(() => { if (discardModal && myHandLen <= 7) setDiscardModal(false); }, [discardModal, myHandLen]);
            const [snapPending, setSnapPending] = useState(false);
            const [pendingTriggers, setPendingTriggers] = useState([]);
            const [landETBModal, setLandETBModal] = useState(null);
            const [crewModal, setCrewModal] = useState(null); // { vehicle, zone }
            // Aura-Zielwahl: { aura, source: 'stack'|'zone'|'bf', stackEntry?, fromZone?, enchant } – Ziele leuchten golden
            const [auraTarget, setAuraTarget] = useState(null);
            // „Karten millen …“: null oder { n }
            const [millPrompt, setMillPrompt] = useState(null);
            // { card, fromZone, type: 'shock'|'check'|'bounce'|'pain'|'reveal'|'scry'|'surveil'|'slow'|'fast' } // triggers waiting to be ordered onto stack
            const isResolvingCombatRef = React.useRef(false);
            const [cmdDmgOpen, setCmdDmgOpen] = useState(false);
            // Fixed viewport position of the commander damage popover ({ left, top }), computed when it opens.
            const [cmdDmgPos, setCmdDmgPos] = useState({ left: 244, top: 8 });
            // ⋯ menu of the left console: null = closed, otherwise its fixed viewport position { left, top }.
            const [myMenuPos, setMyMenuPos] = useState(null);
            const myMenuBtnRef = useRef(null);
            const myMenuRef = useRef(null);

            // ── MANA POOL ─────────────────────────────────────────────────────────
            const [manaPool, setManaPool] = useState({ W:0, U:0, B:0, R:0, G:0, C:0 });
            const addMana = (sym) => setManaPool(p => ({ ...p, [sym]: (p[sym] || 0) + 1 }));
            const removeMana = (sym) => setManaPool(p => ({ ...p, [sym]: Math.max(0, (p[sym] || 0) - 1) }));
            const clearMana = () => setManaPool({ W:0, U:0, B:0, R:0, G:0, C:0 });

            // Card dimensions — defined early so pre-return hooks (snapAllCardsToZones, spawn) can use them
            // Card dimensions defined before early return above

            // ── COMBAT STATE ──────────────────────────────────────────────────────
            // combatPhase: null | 'attacking' | 'blocking' | 'resolving'
            // Stored in Firestore (lobbyState.combat) so both players see the same state.
            const [pendingAttackers, setPendingAttackers] = useState([]); // { card, targetPlayerId }
            const [pendingBlocker, setPendingBlocker] = useState(null); // card being assigned as blocker
            const [manaChoice, setManaChoice] = useState(null); // { card, options: ['W','U',...], pos: {x,y} }
            const combatState = lobbyState?.combat || null;
            const toggleAttacker = (card) => {
                setPendingAttackers(prev =>
                    prev.find(a => a.card.instanceId === card.instanceId)
                        ? prev.filter(a => a.card.instanceId !== card.instanceId)
                        : [...prev, { card, targetPlayerId: null }]
                );
            };

            const setAttackerTarget = (cardInstanceId, targetPlayerId) => {
                setPendingAttackers(prev => prev.map(a =>
                    a.card.instanceId === cardInstanceId ? { ...a, targetPlayerId } : a
                ));
            };

            const playerLowerBattlefieldRef = useRef(null);
            const playerUpperBattlefieldRef = useRef(null);
            // Refs to the UI chrome around my own battlefield, so spawn zones can measure their REAL size
            // (which changes with content - e.g. the left sidebar grows if I have a big Command Zone) instead
            // of relying on hardcoded guesses that drift out of sync with the actual layout.
            const myHandZoneRef = useRef(null);
            const myLeftSidebarRef = useRef(null);
            const myRightSidebarRef = useRef(null);
            const initializingRef = useRef(false);
            const hasInitializedRef = useRef(false); // Used to prevent re-initialization

            const user = arenaUser;
            const isMyAttack = combatState?.attackerId === user?.uid;
            const isMyBlock = combatState && combatState.attackerId !== user?.uid && combatState.phase !== 'done';
            // db kommt aus ../firebase
            
            // --- REFACTOR: New helper refs for state documents ---
            const roomRef = useMemo(() => doc(db, 'arena_rooms', roomId), [roomId, db]);
            const myStateRef = useMemo(() => doc(db, 'arena_rooms', roomId, 'game_state', user.uid), [roomId, db, user.uid]);
            // All other players currently seated at this table (supports 2-4 players total).
            const opponentIds = useMemo(() => (lobbyState?.players || []).filter(p => p !== user.uid), [lobbyState, user.uid]);
            // Stable key so the listener effect below only re-subscribes when the actual set of opponents changes.
            const opponentIdsKey = opponentIds.slice().sort().join(',');

            
            // --- REFACTOR: Split state syncing into multiple listeners ---

            // Listener 1: Sync the main lobby document
            useEffect(() => {
                const unsubscribe = onSnapshot(roomRef, (docSnap) => {
                    if (docSnap.exists()) {
                        const data = docSnap.data();
                        setLobbyState(data);
                        // Debug: log combat state changes
                        if (data.combat) {
                            console.log('[Combat] phase:', data.combat.phase, 'attackerId:', data.combat.attackerId, 'myUid:', user.uid);
                        }
                        
                        if (data.gameResult && !data.gameResult.confirmed && data.gameResult.submittedBy !== user.uid) {
                            setGameResult(data.gameResult);
                            setLeaveGameModal(true);
                        }
                        // The result has been confirmed (by whichever player clicked Confirm first). Everyone
                        // else still sitting on a result screen - whether they're the original reporter, or one
                        // of several opponents in a 3-4 player game who never got around to clicking Confirm
                        // themselves - should leave automatically instead of being stuck waiting forever.
                        if (data.gameResult && data.gameResult.confirmed) {
                            reportResult(roomId, user.uid, data.gameResult, data.playerInfo, data.players);
                            setLeaveGameModal(false);
                            onLeave();
                        }
                    } else { onLeave(); } // Room was deleted
                });
                return () => unsubscribe();
            }, [roomRef, onLeave, user.uid]);
            
            // Listener 2: Sync my own game state
            useEffect(() => {
                const unsubscribe = onSnapshot(myStateRef, (docSnap) => {
                    if (docSnap.exists()) {
                        setMyState(docSnap.data());
                        hasInitializedRef.current = true; // Mark as initialized once we have data
                    } else {
                        setMyState(null); // My state was deleted or not created yet
                    }
                    setLoading(false); // We can stop loading once we check for my state
                });
                return () => unsubscribe();
            }, [myStateRef]);
            
            // Listener 3: Sync every opponent's game state (one onSnapshot subscription per opponent).
            // Re-subscribes whenever the set of opponents actually changes (someone joins/leaves), not on every render.
            useEffect(() => {
                if (opponentIds.length === 0) {
                    setOpponentStates({});
                    return;
                }
                const unsubscribers = opponentIds.map(oppId => {
                    const ref = doc(db, 'arena_rooms', roomId, 'game_state', oppId);
                    return onSnapshot(ref, (docSnap) => {
                        setOpponentStates(prev => {
                            if (docSnap.exists()) {
                                return { ...prev, [oppId]: docSnap.data() };
                            } else {
                                const next = { ...prev };
                                delete next[oppId]; // Opponent left or state not created yet
                                return next;
                            }
                        });
                    });
                });
                return () => unsubscribers.forEach(unsub => unsub());
            }, [opponentIdsKey, db, roomId]);


            // Host Logic: once the table is full, randomly shuffle a seating order for ALL players (not just
            // pick a starter). This seat order doubles as: (1) turn order going forward, and (2) the basis for
            // arranging opponent tiles clockwise around the table in the UI (see seatedOpponentIds below).
            useEffect(() => {
                const capacity = lobbyState?.maxPlayers || 2;
                if (lobbyState && lobbyState.host === user.uid && !lobbyState.seatOrder && lobbyState.players.length === capacity) {
                    const shuffled = [...lobbyState.players];
                    for (let i = shuffled.length - 1; i > 0; i--) {
                        const j = Math.floor(Math.random() * (i + 1));
                        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
                    }
                    // Erster Zug des Spiels beginnt mit Enttappen; first = true steuert das Überspringen des Ziehens (nur bei 2 Spielern).
                    updateDoc(roomRef, { seatOrder: shuffled, activePlayer: shuffled[0], phase: { step: 'untap', turn: 1, player: shuffled[0], first: true, at: Date.now() }, hold: null });
                }
            }, [lobbyState, user.uid, roomRef]);

            // --- REFACTOR: Initialize Player State (writes to subcollection) ---
            useEffect(() => {
                // Wait for listeners to load, check if we've already initialized, or if myState already exists
                if (loading || !lobbyState || myState || hasInitializedRef.current) return;
                
                // Don't run if another init is in progress
                if (initializingRef.current) return;
                
                console.log("Initializing Player State in Subcollection...");
                initializingRef.current = true;
                
                const initLibrary = deck.cards.map(c => ({ ...c, instanceId: generateId(), isTapped: false, counters: [] }));
                for (let i = initLibrary.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [initLibrary[i], initLibrary[j]] = [initLibrary[j], initLibrary[i]];
                }
                const startingHand = initLibrary.splice(0, 7);
                // Support both the current deck shape (commanders: []) and legacy single-commander decks.
                const commanderSources = Array.isArray(deck.commanders) ? deck.commanders : (deck.commander ? [deck.commander] : []);
                const commander = commanderSources.map(c => ({ ...c, instanceId: generateId(), isTapped: false, isCommander: true, counters: [] }));

                const initialPlayerState = {
                    life: 40, commanderDamage: {}, cmdTax: {}, // commanderDamage keyed by the ATTACKING commander's instanceId - one counter per enemy commander
                    library: initLibrary, hand: startingHand, 
                    battlefieldUpper: [], battlefieldLower: [],
                    graveyard: [], exile: [], commandZone: commander
                };

                // Write to the new document: /arena_rooms/<roomId>/game_state/<user.uid>
                setDoc(myStateRef, initialPlayerState)
                    .then(() => {
                        console.log("Player state initialized.");
                        hasInitializedRef.current = true; // We've done it
                        initializingRef.current = false;
                    })
                    .catch(e => {
                        console.error("Failed to initialize player state:", e);
                        initializingRef.current = false; 
                    });
            }, [loading, lobbyState, myState, deck, myStateRef]); // Depends on all state sources

            // Measures the real pixel positions of the sidebars after each render so zone markers and spawn
            // logic always agree. Hand position is no longer needed since zones are fixed proportions.
            useEffect(() => {
                const bf = playerLowerBattlefieldRef.current;
                const left = myLeftSidebarRef.current;
                const right = myRightSidebarRef.current;
                if (!bf || !left || !right) return;
                const bfRect = bf.getBoundingClientRect();
                const leftRect = left.getBoundingClientRect();
                const rightRect = right.getBoundingClientRect();
                const next = {
                    leftSidebarRightX: leftRect.right - bfRect.left,
                    rightSidebarLeftX: rightRect.left - bfRect.left,
                    bfWidth: bfRect.width,
                    bfHeight: bfRect.height
                };
                // Only update state if values actually changed — prevents infinite render loop
                setZoneBounds(prev => {
                    if (prev &&
                        prev.leftSidebarRightX === next.leftSidebarRightX &&
                        prev.rightSidebarLeftX === next.rightSidebarLeftX &&
                        prev.bfWidth === next.bfWidth &&
                        prev.bfHeight === next.bfHeight) return prev;
                    return next;
                });
            }); // intentionally no dep array — measures DOM on every render, but bails early if unchanged

            // A window resize doesn't necessarily re-render GameSim, so the effect above would keep stale
            // sidebar/battlefield positions. Force a render on resize so zoneBounds is re-measured.
            const [, setViewportTick] = useState(0);
            useEffect(() => {
                const onResize = () => setViewportTick(t => t + 1);
                window.addEventListener('resize', onResize);
                return () => window.removeEventListener('resize', onResize);
            }, []);

            // ⋯ menu: close on click outside the menu/its button and on Escape.
            useEffect(() => {
                if (!myMenuPos) return;
                const onDown = (e) => {
                    if (myMenuRef.current?.contains(e.target) || myMenuBtnRef.current?.contains(e.target)) return;
                    setMyMenuPos(null);
                };
                const onKey = (e) => { if (e.key === 'Escape') setMyMenuPos(null); };
                document.addEventListener('mousedown', onDown);
                document.addEventListener('keydown', onKey);
                return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
            }, [myMenuPos]);

            // Track the cursor position while a card preview is showing, so the big preview image can
            // follow the mouse instead of sitting in a fixed corner of the screen.
            useEffect(() => {
                if (!hoveredCard) return;
                const handleMouseMove = (e) => setMousePos({ x: e.clientX, y: e.clientY });
                window.addEventListener('mousemove', handleMouseMove);
                return () => window.removeEventListener('mousemove', handleMouseMove);
            }, [hoveredCard]);

            // --- REFACTOR: Reading state from new sources ---
            // Looks up any player's display name (deck name) from the lobby doc - works for any of the 1-3 opponents.
            const getPlayerName = (uid) => lobbyState?.playerInfo?.[uid]?.name || lobbyState?.playerInfo?.[uid]?.deckName || 'Mitspieler';
            const activePlayerId = lobbyState?.activePlayer;

            // ── SPIELPROTOKOLL ────────────────────────────────────────────────────
            // arena_rooms/{roomId}/log/{id}: { at, uid, name, text, cards?: [{ name, image_url }], kind? }
            // Jeder Client schreibt nur seine eigenen Einträge (Regeln: uid == auth.uid).
            const [logEntries, setLogEntries] = useState([]);
            const [logOpen, setLogOpen] = useState(false);
            const [logSeenAt, setLogSeenAt] = useState(() => Date.now());
            useEffect(() => {
                try {
                    const q = query(collection(db, 'arena_rooms', roomId, 'log'), orderBy('at'), limitToLast(200));
                    return onSnapshot(q, (snap) => setLogEntries(snap.docs.map(d => ({ id: d.id, ...d.data() }))), () => {});
                } catch (e) { return () => {}; }
            }, [roomId]);
            const logScrollRef = useRef(null);
            useEffect(() => {
                if (!logOpen) return;
                setLogSeenAt(Date.now());
                const el = logScrollRef.current;
                if (el) el.scrollTop = el.scrollHeight;
            }, [logOpen, logEntries.length]);
            const logEvent = (text, cards = null, kind = null) => {
                const entry = { at: Date.now(), uid: user.uid, name: getPlayerName(user.uid), text };
                const cs = (cards || []).filter(c => c && c.name).map(c => ({ name: cardName(c), image_url: c.image_url || '' }));
                if (cs.length) entry.cards = cs;
                if (kind) entry.kind = kind;
                addDoc(collection(db, 'arena_rooms', roomId, 'log'), entry).catch(() => {});
            };
            // Aufgedeckte Karten (z. B. vor Spielbeginn) der Mitspieler kurz als Hinweis zeigen
            const revealSeenRef = useRef({ at: Date.now(), ids: new Set() });
            useEffect(() => {
                const r = revealSeenRef.current;
                logEntries.forEach(e => {
                    if (e.kind !== 'reveal' || e.uid === user.uid || r.ids.has(e.id) || (e.at || 0) < r.at - 60000) return;
                    r.ids.add(e.id);
                    addToast(`👁 ${e.name}: ${e.text}`, 'purple');
                });
            }, [logEntries]);
            // Gezogene Karten zusammenfassen (nie Namen): „zieht 3 Karten“
            const drawLogRef = useRef({ n: 0, t: null });
            const noteDraw = (n = 1, suffix = '') => {
                const r = drawLogRef.current;
                r.n += n; clearTimeout(r.t);
                r.t = setTimeout(() => { const k = r.n; r.n = 0; if (k > 0) logEvent(`zieht ${k} Karte${k > 1 ? 'n' : ''}${suffix}`); }, 1500);
            };
            // Lebensänderungen pro Spieler gebündelt (~1,5 s Ruhe): „Leben 40 → 34“ – jeder Client meldet nur sein eigenes Leben
            const lifeLogRef = useRef(null);
            const myLifeNow = myState?.life;
            useEffect(() => {
                if (typeof myLifeNow !== 'number') return;
                const r = lifeLogRef.current;
                if (!r) { lifeLogRef.current = { base: myLifeNow, cur: myLifeNow, t: null }; return; }
                if (myLifeNow === r.cur) return;
                r.cur = myLifeNow; clearTimeout(r.t);
                r.t = setTimeout(() => { if (r.cur !== r.base) logEvent(`Leben ${r.base} → ${r.cur}`); r.base = r.cur; }, 1500);
            }, [myLifeNow]);

            // Anfragen an Mitspieler (Raum-Dokument) per Transaktion anhängen bzw. erledigte entfernen, damit
            // gleichzeitige Anfragen sich nicht gegenseitig überschreiben.
            const pushRoomRequest = (field, req) => runTx(async (tx) => {
                const snap = await tx.get(roomRef);
                if (!snap.exists()) return;
                tx.update(roomRef, { [field]: [...(snap.data()[field] || []), ...(Array.isArray(req) ? req : [req])] });
            }).catch(err => addToast(`❌ Anfrage fehlgeschlagen: ${err.message}`, 'red'));
            // Eingehende Anfragen an MICH: in EINER Transaktion meinen Zustand frisch lesen, die Anfragen anwenden und sie
            // aus der Warteschlange des Raums entfernen. Dadurch wird nichts doppelt angewendet (auch nicht nach einem
            // Neuladen oder wenn ein Snapshot zweimal kommt) und nichts geht verloren. Meine Bearbeitungen laufen
            // nacheinander (Kette), damit sie sich nicht gegenseitig mit veralteten Arrays überschreiben.
            // handler(mine, state) → { state?: Patch für meinen Zustand, push?: { feld: [neue Anfragen] }, after?: () => {} }
            // – muss rein sein (Firestore wiederholt Transaktionen); Toasts/Trigger gehören in `after`.
            const reqChainRef = useRef(Promise.resolve());
            const reqBusyRef = useRef({});
            const processRequests = (field, handler, attempt = 0) => {
                if (!myState || !(lobbyState?.[field] || []).some(r => r?.targetPlayerId === user.uid)) return;
                const busy = reqBusyRef.current;
                if (busy[field]) { busy[field] = 'again'; return; }
                busy[field] = true;
                reqChainRef.current = reqChainRef.current.then(() => runTx(async (tx) => {
                    const rs = await tx.get(roomRef);
                    if (!rs.exists()) return null;
                    const room = rs.data();
                    const all = room[field] || [];
                    const mine = all.filter(r => r?.targetPlayerId === user.uid);
                    if (!mine.length) return null;
                    const ss = await tx.get(myStateRef);
                    if (!ss.exists()) return null;
                    const res = handler(mine, ss.data()) || {};
                    if (res.state && Object.keys(res.state).length) tx.update(myStateRef, res.state);
                    const roomPatch = { [field]: all.filter(r => r?.targetPlayerId !== user.uid) };
                    Object.entries(res.push || {}).forEach(([f, items]) => { if (items?.length) roomPatch[f] = [...(roomPatch[f] || room[f] || []), ...items]; });
                    tx.update(roomRef, roomPatch);
                    return res.after || null;
                })).then(after => { if (typeof after === 'function') after(); return false; })
                    // fehlgeschlagen (offline, Konflikt): nichts wurde angewendet – später erneut versuchen
                    .catch(err => { console.warn('Anfrage', field, err); return attempt < 3; })
                    .then(retry => {
                        const again = busy[field] === 'again'; busy[field] = false;
                        if (again) processRequests(field, handler);
                        else if (retry) setTimeout(() => processRequests(field, handler, attempt + 1), 1500 * (attempt + 1));
                    });
            };

            // Anfragen an Spieler, die den Tisch verlassen haben, würde niemand mehr abarbeiten: der erste noch anwesende
            // Spieler (Sitzreihenfolge) entfernt sie per Transaktion aus allen Warteschlangen. Karten, die an einen
            // gegangenen Besitzer zurück sollten, verlassen das Spiel (Protokollnotiz).
            const REQUEST_FIELDS = ['attachRequests', 'tokenRequests', 'auraFallRequests', 'returnRequests', 'reanimateRequests', 'deathRequests', 'damageRequests', 'loyaltyRequests'];
            const presentNow = lobbyState?.players || [];
            const staleReqSig = lobbyState?.seatOrder ? REQUEST_FIELDS.map(f => (lobbyState?.[f] || []).filter(r => r?.targetPlayerId && !presentNow.includes(r.targetPlayerId)).map(r => r.id).join(',')).join('') : '';
            const queueCleaner = (lobbyState?.seatOrder || []).find(id => presentNow.includes(id)) || presentNow[0];
            useEffect(() => {
                if (!staleReqSig || queueCleaner !== user.uid) return;
                runTx(async (tx) => {
                    const snap = await tx.get(roomRef);
                    if (!snap.exists()) return [];
                    const r = snap.data(), pl = r.players || [];
                    const patch = {}, dropped = [];
                    REQUEST_FIELDS.forEach(f => {
                        const arr = r[f] || [];
                        const gone = arr.filter(x => x?.targetPlayerId && !pl.includes(x.targetPlayerId));
                        if (gone.length) { patch[f] = arr.filter(x => !gone.includes(x)); gone.forEach(x => dropped.push({ f, x })); }
                    });
                    if (Object.keys(patch).length) tx.update(roomRef, patch);
                    return dropped;
                }).then(dropped => (dropped || []).forEach(({ f, x }) => {
                    if (f === 'returnRequests' && x.card) logEvent(`${cardName(x.card)} verlässt das Spiel – Besitzer ist nicht mehr am Tisch`, [x.card]);
                })).catch(() => {});
            }, [staleReqSig, queueCleaner]);

            // Karte verlässt das Spielfeld: Vorderseite, keine Marker außer Loyalität, Anhänge lösen.
            // Auren gehen in den Friedhof IHRES Besitzers, Ausrüstung bleibt lose auf meinem Feld liegen.
            const cleanLeaving = (card) => {
                const c = { ...resetFace(card), isTapped: false, counters: (card.counters || []).filter(x => x.type === 'Loyalität') };
                delete c.attachments; delete c.isCrewed;
                return c;
            };
            const shedAttachments = (card, sendRequests = true) => {
                const ownGy = [], looseEquip = [], falls = [];
                (card.attachments || []).forEach(a => {
                    if (a.kind === 'aura') {
                        if (!a.ownerId || a.ownerId === user.uid) ownGy.push(resetFace(a.card || a));
                        else falls.push({ id: generateId(), targetPlayerId: a.ownerId, card: resetFace(a.card || a) });
                    } else if (a.kind === 'equipment') looseEquip.push({ ...(a.card || a), isTapped: false, x: card.x, y: card.y });
                });
                if (sendRequests) falls.forEach(f => pushRoomRequest('auraFallRequests', f));
                return { ownGy, looseEquip, falls };
            };
            // Gehört die Karte einem Mitspieler (z. B. aus seinem Friedhof reanimiert)?
            const foreignOwner = (c) => !!c?.ownerId && c.ownerId !== user.uid;
            const returnRequestFor = (card, zone) => {
                const c = cleanLeaving(card); delete c.ownerId; delete c.x; delete c.y;
                return { id: generateId(), targetPlayerId: card.ownerId, card: c, zone, fromPlayerId: user.uid };
            };
            const returnToOwner = (card, zone) => {
                const req = returnRequestFor(card, zone), c = req.card;
                // Besitzer hat den Tisch verlassen: die Karte verlässt das Spiel (Regel 800.4a) – nur Protokoll
                if (!(lobbyState?.players || []).includes(card.ownerId)) {
                    addToast(`🚪 ${cardName(c)} verlässt das Spiel (Besitzer ist nicht mehr am Tisch)`, 'blue');
                    logEvent(`${cardName(c)} verlässt das Spiel – Besitzer ${getPlayerName(card.ownerId)} ist nicht mehr am Tisch`, [c]);
                    return;
                }
                pushRoomRequest('returnRequests', req);
                addToast(`↩ ${cardName(c)} geht an ${getPlayerName(card.ownerId)} zurück`, 'blue');
            };

            // Opponents arranged in turn order, clockwise starting from whoever sits after ME.
            // With my own battlefield always at the bottom of the screen, this puts the next player to act
            // at the left of the opponent grid, then the next, and so on - so a glance across the top row,
            // left to right, matches the actual turn order around the table.
            const seatedOpponentIds = useMemo(() => {
                const seatOrder = lobbyState?.seatOrder;
                if (!seatOrder || seatOrder.length === 0) return opponentIds; // Fallback before seating is assigned
                const myIndex = seatOrder.indexOf(user.uid);
                if (myIndex === -1) return opponentIds; // I'm not seated yet (e.g. spectating edge case)
                const rotated = [...seatOrder.slice(myIndex + 1), ...seatOrder.slice(0, myIndex)];
                return rotated.filter(id => id !== user.uid);
            }, [lobbyState?.seatOrder, user.uid, opponentIds]);

            // --- REFACTOR: Simplified Loading Check ---
            // IMPORTANT: All hooks (useEffect/useState/useRef) must be called unconditionally, before any
            // early return - otherwise React sees a different number/order of hooks on the render where
            // myState first becomes non-null, which throws and breaks the whole component. These four
            // listeners used to live after this return and have been moved up here; they reference
            // updateDoc directly (not the updateMyState/createTokens helpers, which are defined
            // further down and wouldn't exist yet at this point in the component).

            // Watches for incoming Aura-attachment requests addressed to ME and applies them to the named
            // creature on my own battlefield (one transaction with clearing the queue, see processRequests).
            useEffect(() => {
                processRequests('attachRequests', (mine, d) => {
                    const upd = { battlefieldLower: [...(d.battlefieldLower || [])], battlefieldUpper: [...(d.battlefieldUpper || [])] };
                    const falls = [], hits = [];
                    mine.forEach(r => {
                        let hit = false;
                        ['battlefieldLower', 'battlefieldUpper'].forEach(zone => {
                            upd[zone] = upd[zone].map(c => { if (c.instanceId !== r.targetCardInstanceId) return c; hit = true; return { ...c, attachments: [...(c.attachments || []), r.attachment] }; });
                        });
                        // Ziel nicht mehr da: die Aura geht in den Friedhof ihres Besitzers
                        if (!hit && r.attachment?.ownerId && r.attachment.ownerId !== user.uid) falls.push({ id: generateId(), targetPlayerId: r.attachment.ownerId, card: r.attachment.card });
                        else if (hit) hits.push(r);
                    });
                    return {
                        state: hits.length ? upd : {}, push: { auraFallRequests: falls },
                        after: () => hits.forEach(r => addToast(`✨ ${getPlayerName(r.fromPlayerId)}: ${r.attachment?.name || 'Aura'} verzaubert deine Karte`, 'purple')),
                    };
                });
            }, [lobbyState?.attachRequests, user.uid, !!myState]);

            // Builds a placeholder-image token the same way createTokens does, for use inside hooks that run
            // before createTokens itself is defined further down (see the token-request listener below).
            const buildPlaceholderTokens = ({ name, stats, quantity, colors, ability }, idPrefix = null) => {
                const bfWidth = playerLowerBattlefieldRef.current?.clientWidth || window.innerWidth;
                const bfHeight = playerLowerBattlefieldRef.current?.clientHeight || 300;
                const tokens = [];
                for (let i = 0; i < quantity; i++) {
                    const pxX = Math.max(bfWidth - 360 - (Math.random() * 50), 0);
                    const pxY = Math.max((bfHeight / 2) - 60 + (Math.random() * 50), 0);
                    const x = bfWidth > 0 ? (pxX / bfWidth) * 100 : 50;
                    const y = bfHeight > 0 ? (pxY / bfHeight) * 100 : 50;
                    const labelLine2 = stats ? stats : (ability || '');
                    const placeholderUrl = `https://placehold.co/200x280/444/FFF?text=${encodeURIComponent(name)}\n${encodeURIComponent(labelLine2)}`;
                    tokens.push({
                        // feste IDs je Anfrage: dieselbe Anfrage kann nie zwei Token-Sätze erzeugen
                        instanceId: idPrefix ? `${idPrefix}-${i}` : generateId(), name, p_t: stats || null, colors, ability: ability || null,
                        image_url: placeholderUrl, isTokenPlaceholder: true, isTapped: false, isToken: true,
                        counters: [], x, y
                    });
                }
                return tokens;
            };

            // Watches for incoming token requests addressed to ME. Plain tokens get created immediately on
            // my battlefield. Aura tokens (Role tokens etc.) instead pop up a "choose a creature to enchant"
            // prompt - they can't just be dropped loose, they need a target the moment they're created.
            // Doppelt angewendete Anfragen (dieselbe Anfrage zweimal in der Warteschlange, zwei Fenster/Geräte desselben
            // Spielers, alte Clients ohne Transaktion) erkennt reqDone (zuletzt erledigte Anfrage-IDs im eigenen Zustand)
            // – zusätzlich bekommen die Token feste IDs aus der Anfrage-ID.
            useEffect(() => {
                processRequests('tokenRequests', (mine, d) => {
                    const done = new Set(d.reqDone || []);
                    const onBf = new Set([...(d.battlefieldLower || []), ...(d.battlefieldUpper || [])].map(c => c.instanceId));
                    const auraSpecs = [], tokens = [], ids = [];
                    mine.forEach(r => {
                        if (!r.tokenSpec || (r.id && (done.has(r.id) || onBf.has(`tk${r.id}-0`)))) return;
                        if (r.id) { done.add(r.id); ids.push(r.id); }
                        if (r.tokenSpec.isAura) auraSpecs.push(r.tokenSpec);
                        else tokens.push(...buildPlaceholderTokens(r.tokenSpec, r.id ? `tk${r.id}` : null));
                    });
                    const state = {};
                    if (tokens.length) state.battlefieldLower = [...(d.battlefieldLower || []), ...tokens];
                    if (ids.length) state.reqDone = [...(d.reqDone || []), ...ids].slice(-60);
                    return { state, after: () => auraSpecs.forEach(s => setAuraAttachPrompt(s)) };
                });
            }, [lobbyState?.tokenRequests, user.uid, !!myState]);

            // Watches for incoming "your Aura fell off a creature" notices (the host left someone ELSE's
            // battlefield) and puts the Aura into MY OWN graveyard, since I'm its owner.
            useEffect(() => {
                processRequests('auraFallRequests', (mine, d) => {
                    const inGy = new Set((d.graveyard || []).map(c => c.instanceId));
                    const cards = mine.filter(r => r.card && !inGy.has(r.card.instanceId)).map(r => resetFace(r.card));
                    if (!cards.length) return {};
                    return {
                        state: { graveyard: [...cards, ...(d.graveyard || [])] },
                        after: () => addToast(`💀 ${cards.map(cardName).join(', ')} → dein Friedhof`, 'red'),
                    };
                });
            }, [lobbyState?.auraFallRequests, user.uid, !!myState]);

            // Karten, die mir gehören und bei einem Mitspieler das Spielfeld verlassen (reanimiert, dann gestorben
            // usw.), kommen in MEINE Zone zurück.
            useEffect(() => {
                processRequests('returnRequests', (mine, d) => {
                    const upd = { graveyard: [...(d.graveyard || [])], exile: [...(d.exile || [])], hand: [...(d.hand || [])], library: [...(d.library || [])], commandZone: [...(d.commandZone || [])] };
                    const ZL = { graveyard: 'Friedhof', exile: 'Exil', hand: 'Hand', library_top: 'Bibliothek', library_bottom: 'Bibliothek', command: 'Commander-Zone' };
                    const msgs = [], pend = [], done = new Set(d.reqDone || []), ids = [];
                    const have = new Set(['graveyard', 'exile', 'hand', 'library', 'commandZone', 'battlefieldLower', 'battlefieldUpper'].flatMap(z => (d[z] || []).map(c => c.instanceId)));
                    mine.forEach(r => {
                        if (!r.card) return;
                        // schon angewendet (doppelt zugestellt) oder die Karte liegt schon bei mir → nicht verdoppeln
                        if ((r.id && done.has(r.id)) || have.has(r.card.instanceId)) return;
                        if (r.id) { done.add(r.id); ids.push(r.id); }
                        const c = { ...resetFace(r.card), isTapped: false };
                        delete c.ownerId; delete c.x; delete c.y;
                        if (c.isCommander && r.zone === 'command') upd.commandZone.unshift({ ...c, counters: [] });
                        // Commander in Friedhof/Exil/Hand/Bibliothek: erst dorthin, dann entscheide ich (Regel 903.9)
                        if (c.isCommander && r.zone !== 'command') pend.push({ instanceId: c.instanceId, name: cardName(c), zone: String(r.zone || 'graveyard').startsWith('library') ? 'library' : (r.zone || 'graveyard') });
                        if (c.isCommander && r.zone === 'command') { /* schon erledigt */ }
                        else if (r.zone === 'exile') upd.exile.unshift(c);
                        else if (r.zone === 'hand') upd.hand.push(c);
                        else if (r.zone === 'library_top') upd.library.unshift(c);
                        else if (r.zone === 'library_bottom') upd.library.push(c);
                        else upd.graveyard.unshift(c);
                        msgs.push(`↩ ${cardName(c)} kommt zu dir zurück (${ZL[r.zone] || 'Friedhof'})`);
                    });
                    if (!ids.length && !msgs.length) return {};
                    if (ids.length) upd.reqDone = [...(d.reqDone || []), ...ids].slice(-60);
                    if (pend.length) upd.cmdPending = [...(d.cmdPending || []), ...pend];
                    return { state: upd, after: () => msgs.forEach(m => addToast(m, 'blue')) };
                });
            }, [lobbyState?.returnRequests, user.uid, !!myState]);

            // Ein Mitspieler reanimiert eine Karte aus meinem Friedhof/Exil auf sein Spielfeld: hier nur entfernen.
            useEffect(() => {
                processRequests('reanimateRequests', (mine, d) => {
                    const ids = new Set(mine.map(r => r.instanceId));
                    const gone = [...(d.graveyard || []), ...(d.exile || [])].filter(c => ids.has(c.instanceId));
                    return {
                        state: gone.length ? { graveyard: (d.graveyard || []).filter(c => !ids.has(c.instanceId)), exile: (d.exile || []).filter(c => !ids.has(c.instanceId)) } : {},
                        after: () => mine.forEach(r => { const c = gone.find(g => g.instanceId === r.instanceId); if (c) addToast(`🧟 ${getPlayerName(r.fromPlayerId)} holt ${cardName(c)} aus deinem ${r.fromZone === 'exile' ? 'Exil' : 'Friedhof'}`, 'purple'); }),
                    };
                });
            }, [lobbyState?.reanimateRequests, user.uid, !!myState]);

            // Watches for incoming "your creature died in combat" requests from the attacker.
            // The attacker cannot write to MY game_state, so they post a request here and I apply it myself.
            useEffect(() => {
                processRequests('deathRequests', (mine, d) => {
                    const deadIds = new Set(mine.flatMap(r => r.instanceIds || []));
                    const bfLower = d.battlefieldLower || [];
                    const bfUpper = d.battlefieldUpper || [];
                    const deadCards = [
                        ...bfLower.filter(c => deadIds.has(c.instanceId)),
                        ...bfUpper.filter(c => deadIds.has(c.instanceId)),
                    ];
                    if (deadCards.length === 0) return {}; // Cards already gone — just clear the requests
                    const enduringCards = deadCards.filter(c => !c.isToken && !c.isCommander && !foreignOwner(c) && hasEnduringAbility(c));
                    const cmdDead = deadCards.filter(c => c.isCommander && !foreignOwner(c));
                    const foreignDead = deadCards.filter(c => !c.isToken && foreignOwner(c));
                    const normalDead = deadCards.filter(c => !c.isToken && !c.isCommander && !foreignOwner(c) && !hasEnduringAbility(c));
                    const returned = enduringCards.map(c => ({
                        ...c, isTapped: false,
                        type_line: c.type_line?.replace(/Enchantment Creature/i, 'Enchantment').replace(/\bCreature\b/i, '').trim() || 'Enchantment',
                        x: 50, y: 50
                    }));
                    const shedGy = [], shedEquip = [], falls = [];
                    deadCards.forEach(c => { const r = shedAttachments(c, false); shedGy.push(...r.ownGy); shedEquip.push(...r.looseEquip); falls.push(...r.falls); });
                    const returns = foreignDead.map(c => returnRequestFor(c, 'graveyard'));
                    return {
                        state: {
                            battlefieldLower: [...bfLower.filter(c => !deadIds.has(c.instanceId)), ...returned, ...shedEquip],
                            battlefieldUpper: bfUpper.filter(c => !deadIds.has(c.instanceId)),
                            // Commander erst in den Friedhof – der Besitzer (ich) entscheidet gleich im Fenster (Regel 903.9a)
                            graveyard: [...normalDead.map(cleanLeaving), ...cmdDead.map(cleanLeaving), ...shedGy, ...(d.graveyard || [])],
                            ...(cmdDead.length ? { cmdPending: [...(d.cmdPending || []), ...cmdDead.map(c => ({ instanceId: c.instanceId, name: cardName(c), zone: 'graveyard' }))] } : {})
                        },
                        push: { auraFallRequests: falls, returnRequests: returns },
                        after: () => {
                            foreignDead.forEach(c => addToast(`↩ ${cardName(c)} geht an ${getPlayerName(c.ownerId)} zurück`, 'blue'));
                            if (cmdDead.length) logEvent(`${cmdDead.map(cardName).join(', ')} stirbt (Commander)`, cmdDead);
                            if (normalDead.length) addToast(`💀 ${normalDead.map(c => c.name).join(', ')} → Friedhof`, 'red');
                            if (enduringCards.length) addToast(`♾️ ${enduringCards.map(c => c.name).join(', ')} kehrt als Verzauberung zurück`, 'purple');
                            normalDead.forEach(dead => { fireTriggers('dies', dead); fireTriggers('creature_dies', dead); });
                        },
                    };
                });
            }, [lobbyState?.deathRequests, user.uid, !!myState]);
            // Process incoming combat damage requests — attacker can't write our life total directly
            useEffect(() => {
                processRequests('damageRequests', (mine, d) => {
                    const totalDmg = mine.reduce((s, r) => s + (r.amount || 0), 0);
                    if (totalDmg <= 0) return {};
                    return { state: { life: (d.life || 0) - totalDmg }, after: () => addToast(`💔 Du erleidest ${totalDmg} Kampfschaden`, 'red') };
                });
            }, [lobbyState?.damageRequests, user.uid, !!myState]);

            // Process incoming loyalty change requests for my planeswalkers
            useEffect(() => {
                processRequests('loyaltyRequests', (mine, d) => {
                    const applyLoyalty = (arr) => (arr || []).map(card => {
                        const req = mine.find(r => r.instanceId === card.instanceId);
                        if (!req) return card;
                        const newCounters = (card.counters||[]).filter(c => c.type !== 'Loyalität');
                        newCounters.push({ type: 'Loyalität', count: req.newLoyalty });
                        return { ...card, counters: newCounters };
                    });
                    return { state: { battlefieldLower: applyLoyalty(d.battlefieldLower), battlefieldUpper: applyLoyalty(d.battlefieldUpper) } };
                });
            }, [lobbyState?.loyaltyRequests, user.uid, !!myState]);

            // ── ZUGPHASEN: Enttappen, automatisches Ziehen, Manapool, Trigger-Hinweise ─────────────
            // Enttappen passiert jetzt über die Phase „untap“ (früher beim Wechsel von activePlayer) – siehe unten.
            const phaseRaw = lobbyState?.phase || null;
            const phase = phaseRaw && phaseRaw.player === activePlayerId && PHASE_STEPS.includes(phaseRaw.step) ? phaseRaw : null;
            const curStep = phase ? phase.step : 'main1';
            const turnKey = phase ? `${phase.turn}-${phase.player}` : 'legacy';
            const stepKey = `${turnKey}:${curStep}`;
            const hasMyState = !!myState;

            // Neuer Zug: der neue aktive Spieler enttappt seine Permanents (einmal pro Zug, auch nach Neuladen)
            // und schaltet danach selbst in die Versorgung weiter.
            const untapDoneRef = useRef(null);
            useEffect(() => {
                // Auch wenn jemand schneller weitergeschaltet hat (Weiter vor Abschluss der Transaktion), wird
                // noch enttappt – lastUntapKey verhindert ein zweites Enttappen im selben Zug.
                if (!phase || phase.player !== user.uid || !hasMyState || !(phase.turn >= 1)) return;
                if (phase.step !== 'untap' && myState.lastUntapKey === turnKey) return;
                const key = turnKey;
                if (untapDoneRef.current === key) return;
                untapDoneRef.current = key;
                runTx(async (tx) => {
                    const snap = await tx.get(myStateRef);
                    const room = await tx.get(roomRef);
                    if (!snap.exists() || !room.exists()) return 'retry';
                    const d = snap.data(); const ph = room.data().phase;
                    if (!ph || ph.player !== user.uid || `${ph.turn}-${ph.player}` !== key) return null;
                    if (ph.step !== 'untap' && d.lastUntapKey === key) return null;
                    let untapped = false;
                    if (d.lastUntapKey !== key) {
                        const untap = (arr) => (arr || []).map(c => {
                            let n = c;
                            if (c.isTapped) n = { ...n, isTapped: false };
                            if ((n.attachments || []).some(a => a.isTapped)) n = { ...n, attachments: n.attachments.map(a => a.isTapped ? { ...a, isTapped: false } : a) };
                            return n;
                        });
                        tx.update(myStateRef, { battlefieldLower: untap(d.battlefieldLower), battlefieldUpper: untap(d.battlefieldUpper), lastUntapKey: key });
                        untapped = true;
                    }
                    if (ph.step === 'untap') tx.update(roomRef, { phase: { ...ph, step: 'upkeep', at: Date.now() }, hold: null });
                    return untapped ? 'untapped' : null;
                }).then(r => {
                    if (r === 'retry') untapDoneRef.current = null;
                    if (r === 'untapped' && (phase.turn || 0) > 1) addToast('🔄 Neuer Zug – alles enttappt', 'blue');
                    if (r === 'untapped' && (phase.turn || 0) >= 1) logEvent(`Zug ${phase.turn} – ${getPlayerName(user.uid)}`, null, 'turn');
                }).catch(() => { untapDoneRef.current = null; });
            }, [phase?.step, turnKey, user.uid, hasMyState, myState?.lastUntapKey]);

            // Ziehphase: der aktive Spieler zieht automatisch genau eine Karte. Abgesichert über lastDrawKey im
            // eigenen Spielstand (Transaktion), damit Neuladen/mehrere Listener nie doppelt ziehen. Wer die
            // Ziehphase überspringt (Sprung nach vorne), zieht trotzdem. Erster Zug bei genau 2 Spielern: kein Ziehen.
            const drawDoneRef = useRef(null);
            useEffect(() => {
                if (!phase || phase.player !== user.uid || !hasMyState || !(phase.turn >= 1)) return;
                if (stepIdx(phase.step) < stepIdx('draw')) return;
                const key = turnKey;
                if (myState.lastDrawKey === key || drawDoneRef.current === key) return;
                drawDoneRef.current = key;
                // Regel 103.8a: nur im Zwei-Spieler-Spiel überspringt der Startspieler das Ziehen. Maßgeblich ist die
                // Sitzordnung beim Spielstart (seatOrder), nicht wer gerade noch am Tisch sitzt; ohne Sitzordnung nie überspringen.
                const seats = (lobbyState?.seatOrder || []).length;
                const skip = !!phase.first && phase.turn === 1 && seats === 2;
                runTx(async (tx) => {
                    const snap = await tx.get(myStateRef);
                    if (!snap.exists()) return 'retry';
                    const d = snap.data();
                    if (d.lastDrawKey === key) return null;
                    if (skip) { tx.update(myStateRef, { lastDrawKey: key }); return 'skip'; }
                    const lib = [...(d.library || [])];
                    if (!lib.length) { tx.update(myStateRef, { lastDrawKey: key }); return 'empty'; }
                    const card = lib.shift();
                    tx.update(myStateRef, { library: lib, hand: [...(d.hand || []), card], lastDrawKey: key });
                    return 'drawn';
                }).then(r => {
                    if (r === 'retry') drawDoneRef.current = null;
                    if (r === 'drawn') { addToast('📖 Karte gezogen (Ziehphase)', 'blue'); logEvent('zieht 1 Karte (Ziehphase)'); }
                    if (r === 'skip') addToast('Erster Zug (2 Spieler): kein Ziehen', 'blue');
                    if (r === 'empty') addToast('⚠️ Bibliothek leer – keine Karte gezogen', 'red');
                }).catch(() => { drawDoneRef.current = null; });
            }, [phase?.step, turnKey, user.uid, hasMyState, myState?.lastDrawKey]);

            // Manapool leert sich bei jedem Schritt- und Zugwechsel (Regel 500.4) – jeder Client leert seinen eigenen.
            // Dazu eine kurze Hervorhebung der Phasenleiste statt eines Toasts.
            const prevStepKeyRef = useRef(null);
            const [phaseFlash, setPhaseFlash] = useState(false);
            useEffect(() => {
                const prev = prevStepKeyRef.current;
                prevStepKeyRef.current = stepKey;
                if (prev === null || prev === stepKey) return;
                clearMana();
                setPhaseFlash(true);
                const t = setTimeout(() => setPhaseFlash(false), 700);
                return () => clearTimeout(t);
            }, [stepKey]);
            // Lokale Angriffsauswahl gehört zum Zug – beim Zugwechsel verwerfen.
            useEffect(() => { setPendingAttackers([]); setPendingBlocker(null); }, [turnKey]);

            // Trigger-Hinweise (nur Erinnerungen). Gesehene Schritte merken (sessionStorage), damit Neuladen nichts doppelt zeigt.
            const [hints, setHints] = useState([]);
            const seenHintKeysRef = useRef(null);
            const hintSeen = (k) => {
                if (!seenHintKeysRef.current) { try { seenHintKeysRef.current = new Set(JSON.parse(sessionStorage.getItem('arena-hints-' + roomId) || '[]')) } catch { seenHintKeysRef.current = new Set() } }
                if (seenHintKeysRef.current.has(k)) return true;
                seenHintKeysRef.current.add(k);
                try { sessionStorage.setItem('arena-hints-' + roomId, JSON.stringify([...seenHintKeysRef.current].slice(-60))) } catch {}
                return false;
            };
            const pushHints = (list) => {
                if (!list.length) return;
                setHints(prev => {
                    const have = new Set(prev.map(h => h.key));
                    return [...prev, ...list.filter(h => !have.has(h.key)).map(h => ({ ...h, id: generateId(), turnKey }))].slice(-12);
                });
            };
            const myPermanents = () => [...(myState?.battlefieldLower || []), ...(myState?.battlefieldUpper || [])];
            // Blocker-Schritt fertig (alle anwesenden Verteidiger haben gepasst / sind gegangen) → der Client des Angreifers
            // schaltet automatisch in den Schadensschritt (siehe goToStep; Transaktion, nur vorwärts → nie doppelt).
            const autoDamageRef = useRef(null);
            const autoDamageFnRef = useRef(null);
            const autoDamageKey = (() => {
                const cbt = lobbyState?.combat;
                if (!phase || curStep !== 'combat_block' || !cbt || cbt.attackerId !== user.uid || phase.player !== user.uid) return null;
                const pl = lobbyState?.players || [];
                // ohne Verteidiger (Solo-Tisch) bleibt es beim „Weiter“ von Hand
                if (!Object.keys(cbt.priorities || {}).length) return null;
                const pending = Object.entries(cbt.priorities || {}).filter(([id, v]) => v !== 'passed' && pl.includes(id));
                if (cbt.phase !== 'resolving' && pending.length) return null;
                return `${turnKey}:${(cbt.attackers || []).map(a => a.instanceId).join(',')}`;
            })();
            useEffect(() => {
                if (!autoDamageKey || autoDamageRef.current === autoDamageKey) return;
                autoDamageRef.current = autoDamageKey;
                autoDamageFnRef.current?.();
            }, [autoDamageKey]);
            // Lebensverlust je Spieler in diesem Zug (für „if a player lost N or more life this turn“). Jeder Client
            // beobachtet alle Lebenspunkte; den eigenen Verlust merkt er zusätzlich im Spielstand (lifeLost, übersteht Neuladen).
            const lifeTrackRef = useRef({ key: null, last: {}, lost: {} });
            const trackIds = [user.uid, ...opponentIds];
            const lifeOf = (id) => id === user.uid ? myState?.life : opponentStates[id]?.life;
            const lifeSig = trackIds.map(id => `${id}:${lifeOf(id)}`).join('|');
            useEffect(() => {
                const r = lifeTrackRef.current;
                if (r.key !== turnKey) { r.key = turnKey; r.lost = {}; }
                trackIds.forEach(id => {
                    const v = lifeOf(id);
                    if (typeof v !== 'number') return;
                    const prev = r.last[id];
                    if (typeof prev === 'number' && v < prev) r.lost[id] = (r.lost[id] || 0) + (prev - v);
                    r.last[id] = v;
                });
                const mine = r.lost[user.uid] || 0;
                const saved = myState?.lifeLost?.key === turnKey ? (myState.lifeLost.n || 0) : 0;
                if (hasMyState && phase && mine > saved) updateDoc(myStateRef, { lifeLost: { key: turnKey, n: mine } }).catch(() => {});
            }, [lifeSig, turnKey]);
            const lifeLostThisTurn = (id) => {
                const st = id === user.uid ? myState : opponentStates[id];
                const saved = st?.lifeLost?.key === turnKey ? (st.lifeLost.n || 0) : 0;
                return Math.max(saved, lifeTrackRef.current.key === turnKey ? (lifeTrackRef.current.lost[id] || 0) : 0);
            };
            // Schrittbeginn: Versorgung, Ziehphase, Kampfbeginn, Endschritt
            useEffect(() => {
                if (!phase || !hasMyState) return;
                const isMyTurn = phase.player === user.uid;
                // vor Spielbeginn aufgedeckte Karten (Chancellor …): Erinnerung in meiner ersten Hauptphase bzw. ersten Versorgung
                const preDue = (myState?.pregameReveals || []).filter(r => !r.done && ((r.when === 'main1' && curStep === 'main1' && isMyTurn) || (r.when === 'upkeep' && curStep === 'upkeep')));
                if (!STEP_HINT_RULES[curStep] && !preDue.length) return;
                if (hintSeen('step:' + stepKey)) return;
                const found = preDue.map(r => ({ key: `pre:${r.instanceId}`, cardName: r.name, reason: 'Vor Spielbeginn aufgedeckt', sentence: r.sentence, canDraw: false }));
                if (preDue.length) updateDoc(myStateRef, { pregameReveals: (myState.pregameReveals || []).map(r => preDue.some(p => p.instanceId === r.instanceId) ? { ...r, done: true } : r) }).catch(() => {});
                myPermanents().forEach(card => stepHintsFor(card, curStep, isMyTurn).forEach(h => {
                    // Bedingung „if a player lost N or more life this turn“: nur zeigen, wenn erfüllt
                    const cond = lifeLostCondition(h.sentence);
                    let reason = h.reason;
                    if (cond) {
                        const ids = cond.who === 'you' ? [user.uid] : cond.who === 'an opponent' ? opponentIds : trackIds;
                        const who = ids.find(id => lifeLostThisTurn(id) >= cond.n);
                        if (!who) return;
                        reason = `${getPlayerName(who)} hat ${lifeLostThisTurn(who)} Leben verloren${hintCanDraw(h.sentence) ? ' – Karte ziehen' : ''}`;
                    }
                    found.push({ ...h, reason, key: `${stepKey}:${card.instanceId}:${h.sentence}`, cardName: card.name, canDraw: hintCanDraw(h.sentence) });
                }));
                pushHints(found);
            }, [stepKey, hasMyState]);
            // Angreifer erklärt (Kampf wechselt zu „blocking“): „Whenever … attacks“ meiner Angreifer
            const attackSig = combatState && combatState.attackerId === user.uid && combatState.phase !== 'attacking' ? (combatState.attackers || []).map(a => a.instanceId).sort().join(',') : '';
            useEffect(() => {
                if (!attackSig || !hasMyState) return;
                if (hintSeen(`atk:${turnKey}:${attackSig}`)) return;
                const attacking = new Set(attackSig.split(','));
                const found = [];
                myPermanents().forEach(card => {
                    attackHintsFor(card, attacking.has(card.instanceId), attacking.size > 0).forEach(h => found.push({ ...h, key: `atk:${turnKey}:${card.instanceId}:${h.sentence}`, cardName: card.name, canDraw: hintCanDraw(h.sentence) }));
                    if (attacking.has(card.instanceId)) (card.attachments || []).forEach(a => attachmentAttackHintsFor(a.card || a).forEach(h => found.push({ ...h, key: `atk:${turnKey}:${a.instanceId}:${h.sentence}`, cardName: (a.card || a).name, canDraw: hintCanDraw(h.sentence) })));
                });
                pushHints(found);
            }, [attackSig, hasMyState]);
            // Ereignis im Kampf: eine nichtspielstein-Kreatur kommt unter meiner Kontrolle ins Spiel (z. B. The Blue Spirit)
            const myBfIds = myPermanents().map(c => c.instanceId).join(',');
            const prevBfIdsRef = useRef(null);
            useEffect(() => {
                if (!hasMyState) return;
                const prev = prevBfIdsRef.current;
                const cur = myPermanents();
                prevBfIdsRef.current = new Set(cur.map(c => c.instanceId));
                if (!prev || !phase || !isCombatStep(curStep)) return;
                const entered = cur.filter(c => !prev.has(c.instanceId) && isCreatureLike(c) && !c.isToken);
                if (!entered.length) return;
                const found = [];
                entered.forEach(e => cur.forEach(card => combatEnterHintsFor(card).forEach(h => {
                    if (/\bnontoken\b/i.test(h.sentence) && e.isToken) return;
                    found.push({ ...h, key: `etb:${turnKey}:${e.instanceId}:${card.instanceId}:${h.sentence}`, cardName: card.name, reason: `${h.reason} (${e.name})`, canDraw: hintCanDraw(h.sentence) });
                })));
                pushHints(found);
            }, [myBfIds, hasMyState]);
            // Alte Hinweise verschwinden beim Zugwechsel
            useEffect(() => { setHints(prev => prev.filter(h => h.turnKey === turnKey)); }, [turnKey]);

            // Re-snaps every card on my battlefield to its correct zone slot after a window resize,
            // so cards don't drift into wrong zones when switching between fullscreen and windowed mode.
            // Uses updateDoc directly (not updateMyState, which is defined after the early return).
            const snapAllCardsToZones = React.useCallback(() => {
                if (!myState) return;
                const allCards = [
                    ...(myState.battlefieldLower || []),
                    ...(myState.battlefieldUpper || [])
                ];
                if (allCards.length === 0) return;
                const bfRect = playerLowerBattlefieldRef.current?.getBoundingClientRect();
                if (!bfRect) return;
                const bfWidth = bfRect.width, bfHeight = bfRect.height;
                const leftSidebarRect = myLeftSidebarRef.current?.getBoundingClientRect();
                const rightSidebarRect = myRightSidebarRef.current?.getBoundingClientRect();
                if (!leftSidebarRect || !rightSidebarRect) return;
                const leftSidebarRightX = leftSidebarRect.right - bfRect.left;
                const rightSidebarLeftX = rightSidebarRect.left - bfRect.left;
                // Gleiche Reihen-Geometrie wie beim Zeichnen (computeBfGeom/layoutMyCards): Zone nach Kartentyp,
                // Reihenfolge nach bisherigem x. Die Darstellung rechnet die Positionen ohnehin selbst aus; das
                // Speichern hält nur die Reihenfolge und die Prozentwerte für alte Clients stimmig.
                const geom = computeBfGeom(bfWidth, bfHeight, leftSidebarRightX, rightSidebarLeftX);
                const laid = layoutMyCards(allCards, geom);

                // Build a position map: instanceId → {x, y}
                // This ONLY updates positions, never adds or removes cards from the arrays.
                // This prevents dead cards from being resurrected if myState is stale.
                const posMap = {};
                Object.entries(laid).forEach(([id, p]) => {
                    posMap[id] = { x: Math.min(Math.max((p.px / bfWidth) * 100, 0), 96), y: Math.min(Math.max((p.py / bfHeight) * 100, 0), 96) };
                });

                // Apply positions to each array individually using the current Firestore state
                // via a transaction so we don't overwrite concurrent battlefield changes.
                runTx(async (tx) => {
                    const snap = await tx.get(myStateRef);
                    if (!snap.exists()) return;
                    const data = snap.data();
                    const applyPos = (arr) => (arr || []).map(c =>
                        posMap[c.instanceId] ? { ...c, ...posMap[c.instanceId] } : c
                    );
                    tx.update(myStateRef, {
                        battlefieldLower: applyPos(data.battlefieldLower),
                        battlefieldUpper: applyPos(data.battlefieldUpper)
                    });
                }).catch(() => {}); // silent fail — positions are cosmetic
            }, [myState, myStateRef]);

            // Listen for window resize and re-snap all cards to their zones.
            useEffect(() => {
                let t;
                const onResize = () => { clearTimeout(t); t = setTimeout(snapAllCardsToZones, 200); };
                window.addEventListener('resize', onResize);
                return () => { window.removeEventListener('resize', onResize); clearTimeout(t); };
            }, [snapAllCardsToZones]);

            // Watch for battlefield changes (cards dying, being played) and snap cards to zones.
            // Blocked during combat resolution to prevent racing with dead-card transactions.
            const bfLowerLen = myState?.battlefieldLower?.length ?? 0;
            const bfUpperLen = myState?.battlefieldUpper?.length ?? 0;
            const prevBFLen = React.useRef({ lower: bfLowerLen, upper: bfUpperLen });
            useEffect(() => {
                if (isResolvingCombatRef.current) return; // don't snap while combat transaction is in-flight
                const prev = prevBFLen.current;
                if (prev.lower !== bfLowerLen || prev.upper !== bfUpperLen) {
                    prevBFLen.current = { lower: bfLowerLen, upper: bfUpperLen };
                    const t = setTimeout(snapAllCardsToZones, 150);
                    return () => clearTimeout(t);
                }
            }, [bfLowerLen, bfUpperLen, snapAllCardsToZones]);

            // Manapool an den Tisch melden (nur Anzeige für die Gegner, die ihn read-only sehen). Kurz entprellt;
            // ein leerer Pool beim Start wird nicht geschrieben.
            const lastPoolRef = useRef(null);
            useEffect(() => {
                if (!hasMyState) return;
                const json = JSON.stringify(manaPool);
                // Startwert = was im Dokument steht (nach Neuladen/„Zur App“ kann dort noch ein alter Pool liegen,
                // der dann mit dem leeren lokalen Pool überschrieben wird).
                if (lastPoolRef.current === null) {
                    const d = myState?.manaPool || {};
                    lastPoolRef.current = JSON.stringify(Object.fromEntries(Object.keys(manaPool).map(s => [s, d[s] || 0])));
                }
                if (lastPoolRef.current === json) return;
                const t = setTimeout(() => { lastPoolRef.current = json; updateDoc(myStateRef, { manaPool }).catch(() => {}); }, 250);
                return () => clearTimeout(t);
            }, [manaPool, hasMyState, myStateRef]);

            // ── TASTENKÜRZEL ──────────────────────────────────────────────────────
            // Ein globaler keydown-Listener, solange der Spieltisch offen ist. Die eigentlichen Aktionen (mit denselben
            // Sperren wie die Buttons) legt jedes Rendern in kbRef ab, damit der Listener nie veraltete Werte sieht.
            const [showKeys, setShowKeys] = useState(false);
            const kbRef = useRef(null);
            useEffect(() => {
                // Offenes Fenster mit Abdunklung (Modal, Kontextmenü, Schadensverteilung …) → Kürzel aus.
                const overlayOpen = (root) => !!root.querySelector('.fixed.inset-0')
                    || [...root.querySelectorAll('[style*="inset"]')].some(el => el.style.inset === '0px' && getComputedStyle(el).position === 'fixed');
                const onKey = (e) => {
                    const k = kbRef.current;
                    if (!k || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
                    const root = document.querySelector('.arena-root');
                    if (!root || getComputedStyle(root).display === 'none') return;
                    const t = e.target;
                    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || ''))) return;
                    if (e.key === 'Escape') { k.escape(); return; }
                    const isSpace = e.code === 'Space' || e.key === ' ';
                    // Nur e.key (Layout-unabhängig): auf deutscher Tastatur ist „?“ Umschalt+ß (code Minus) und
                    // Umschalt+„-“ (code Slash) ergibt „_“ – ein code-Fallback würde dort falsch auslösen.
                    const isHelp = e.key === '?';
                    if (overlayOpen(root)) return;
                    const key = (e.key || '').toLowerCase();
                    const plus = e.key === '+' || e.key === '=' || e.code === 'NumpadAdd';
                    const minus = e.key === '-' || e.key === '−' || e.code === 'NumpadSubtract';
                    if (plus || minus) { e.preventDefault(); k.life(plus ? 1 : -1); return; }
                    // Gedrückt halten: nur +/− wiederholen; Leertaste nur Scrollen verhindern
                    if (e.repeat) { if (isSpace || isHelp) e.preventDefault(); return; }
                    if (isHelp) { e.preventDefault(); k.toggleHelp(); return; }
                    if (isSpace) {
                        e.preventDefault(); // Seite nicht scrollen
                        // Fokussierter Button würde beim Loslassen zusätzlich „geklickt“
                        if (document.activeElement && document.activeElement !== document.body && document.activeElement.tagName === 'BUTTON') document.activeElement.blur();
                        if (!e.repeat) k.space();
                        return;
                    }
                    const map = { d: k.draw, e: k.endTurn, h: k.toggleHand, m: k.shuffle, t: k.token, x: k.hold, l: k.toggleLog };
                    if (map[key]) { e.preventDefault(); map[key](); }
                };
                window.addEventListener('keydown', onKey);
                return () => window.removeEventListener('keydown', onKey);
            }, []);

            if (loading || !myState) {
                return <div className="h-full flex flex-col items-center justify-center text-yellow-400"><div className="loader mb-4"></div><p>Spielstand wird geladen …</p></div>;
            }

            // --- REFACTOR: Simplified updateMyState ---
            const updateMyState = (updates) => {
                // Simply update our own document. No complex dot notation.
                updateDoc(myStateRef, updates);
            };

            const drawCard = () => {
                if (myState.library.length === 0) return;
                const newLib = [...myState.library];
                const card = newLib.shift();
                updateMyState({ library: newLib, hand: [...myState.hand, card] });
                noteDraw(1);
            };

            // Oberste X Karten in den Friedhof (Reihenfolge: zuletzt gemillte Karte liegt oben)
            const millCards = (count) => {
                const n = Math.max(0, Math.min(count, myState.library.length));
                if (!n) { addToast('Bibliothek ist leer', 'yellow'); return; }
                const milled = myState.library.slice(0, n);
                updateMyState({ library: myState.library.slice(n), graveyard: [...[...milled].reverse(), ...(myState.graveyard || [])] });
                const names = milled.map(cardName).join(', ');
                addToast(`🪦 Gemillt: ${names}`, 'purple');
                logEvent(`millt ${n}: ${names}`, milled);
            };

            const shuffleLibrary = () => {
                const newLib = [...myState.library];
                for (let i = newLib.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [newLib[i], newLib[j]] = [newLib[j], newLib[i]];
                }
                updateMyState({ library: newLib });
                addToast('🔀 Bibliothek gemischt', 'purple');
                logEvent('mischt die Bibliothek');
            };

            // Opens the Scry/Surveil/Look overlay for the top N cards of the library.
            const openLibraryAction = (mode, count) => {
                const n = Math.max(1, Math.min(count, myState.library.length));
                const cards = myState.library.slice(0, n);
                setLibraryActionModal({ mode, cards });
            };

            // Applies the per-card decisions from the Scry/Surveil/Look overlay back to the library.
            const resolveLibraryAction = (decisions) => {
                if (!libraryActionModal) return;
                const { mode, cards } = libraryActionModal;
                const affected = new Set(cards.map(c => c.instanceId));
                const rest = myState.library.filter(c => !affected.has(c.instanceId)); // cards below the looked-at ones

                const toTop = [], toBottom = [], toGY = [], toHand = [], revealed = [], toBF = [];
                const bottomRandom = [];
                cards.forEach(card => {
                    const dest = decisions[card.instanceId] || 'bottom';
                    if (dest === 'top')          toTop.push(card);
                    else if (dest === 'bottom')   toBottom.push(card);
                    else if (dest === 'graveyard') toGY.push(card);
                    else if (dest === 'hand')     toHand.push(card);
                    else if (dest === 'reveal')   { revealed.push(card); toHand.push(card); }
                    else if (dest === 'battlefield') toBF.push(card);
                    else if (dest === 'bottom_random') bottomRandom.push(card);
                });

                // Shuffle the bottom_random group before appending them after toBottom
                for (let i = bottomRandom.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [bottomRandom[i], bottomRandom[j]] = [bottomRandom[j], bottomRandom[i]];
                }

                const newLibrary = [...toTop, ...rest, ...toBottom, ...bottomRandom];
                const newHand = [...myState.hand, ...toHand];
                const newGY = [...toGY, ...(myState.graveyard || [])];
                // Place battlefield cards using spawn positions
                const newBFLower = [...(myState.battlefieldLower || [])];
                toBF.forEach(card => {
                    const spawn = getDefaultSpawnPosition(card);
                    const c = { ...prepEnter(card, isLand(frontFace(card)) ? (detectLandETB(frontFace(card)) === 'tapped' || detectLandETB(frontFace(card)) === 'triome') : undefined), x: spawn.x, y: spawn.y, counters: [] };
                    newBFLower.push(c);
                    setTimeout(() => fireTriggers(isLand(c) ? 'landfall' : 'etb', c), 100);
                });

                updateMyState({ library: newLibrary, hand: newHand, graveyard: newGY, battlefieldLower: newBFLower });
                if (toGY.length) logEvent(`${mode === 'surveil' ? 'Überwachen' : mode === 'scry' ? 'Hellsicht' : 'Bibliothek'}: ${toGY.map(cardName).join(', ')} → Friedhof`, toGY);
                if (toBF.length) logEvent(`${toBF.map(cardName).join(', ')}: Bibliothek → Spielfeld`, toBF);

                // TODO: broadcast revealed cards to opponents (for now just log)
                if (revealed.length > 0) {
                    console.log('Revealed cards:', revealed.map(c => c.name).join(', '));
                }
                setLibraryActionModal(null);
            };

            // --- MULLIGAN / PREGAME FLOW ---
            // lobbyState.mulliganStatus: { [uid]: { count: number, completed: boolean } }
            // lobbyState.pregameAction:  { [uid]: boolean }  (only written once mulligan is completed)
            const myMulliganStatus = lobbyState?.mulliganStatus?.[user.uid];
            const myMulliganCount = myMulliganStatus?.count || 0;
            const myMulliganCompleted = myMulliganStatus?.completed || false;
            const cardsToBottom = Math.max(myMulliganCount - 1, 0); // first mulligan is free

            // Take a mulligan: shuffle hand back into library, draw a fresh 7, increment my own counter.
            const takeMulligan = () => {
                let newLib = [...myState.library, ...myState.hand];
                for (let i = newLib.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [newLib[i], newLib[j]] = [newLib[j], newLib[i]];
                }
                const newHand = newLib.splice(0, 7);
                updateMyState({ library: newLib, hand: newHand });
                updateDoc(roomRef, {
                    [`mulliganStatus.${user.uid}`]: { count: myMulliganCount + 1, completed: false }
                });
            };

            // Keep the current hand. If no cards need bottoming, this completes the mulligan immediately;
            // otherwise the player picks cards to bottom first (see confirmBottomCards below).
            const keepHand = () => {
                if (cardsToBottom === 0) {
                    updateDoc(roomRef, {
                        [`mulliganStatus.${user.uid}`]: { count: myMulliganCount, completed: true }
                    });
                } else {
                    setBottomingCards([]); // enter card-selection mode, see render below
                }
            };

            // Finalize bottoming the chosen cards (used when cardsToBottom > 0).
            const confirmBottomCards = (selectedInstanceIds) => {
                const toBottom = myState.hand.filter(c => selectedInstanceIds.includes(c.instanceId));
                const keptHand = myState.hand.filter(c => !selectedInstanceIds.includes(c.instanceId));
                updateMyState({ hand: keptHand, library: [...myState.library, ...toBottom] });
                updateDoc(roomRef, {
                    [`mulliganStatus.${user.uid}`]: { count: myMulliganCount, completed: true }
                });
                setBottomingCards(null);
            };

            const submitPregameAction = (hasAction) => {
                updateDoc(roomRef, { [`pregameAction.${user.uid}`]: hasAction });
            };
            // Erkannte Aktionen vor Spielbeginn in meiner Starthand
            const pregameCandidates = (myState.hand || []).map(card => ({ card, action: pregameActionOf(card) })).filter(x => x.action);
            const performPregameAction = (card, action) => {
                const fresh = (myState.hand || []).find(c => c.instanceId === card.instanceId);
                if (!fresh) return;
                if (action.type === 'battlefield') {
                    const { x, y } = getDefaultSpawnPosition(frontFace(fresh));
                    const counters = action.counter ? [{ type: COUNTER_DE[action.counter] || action.counter, count: 1 }] : [];
                    const placed = { ...frontFace(fresh), isTapped: false, x, y, counters };
                    runTx(async (tx) => {
                        const snap = await tx.get(myStateRef);
                        if (!snap.exists()) return;
                        const d = snap.data();
                        if (!(d.hand || []).some(c => c.instanceId === fresh.instanceId)) return;
                        tx.update(myStateRef, { hand: d.hand.filter(c => c.instanceId !== fresh.instanceId), battlefieldLower: [...(d.battlefieldLower || []), placed] });
                    }).catch(err => addToast(`❌ ${err.message}`, 'red'));
                    logEvent(`beginnt das Spiel mit ${cardName(placed)} auf dem Spielfeld${counters.length ? ` (${counters[0].type}-Marker)` : ''}`, [placed]);
                    addToast(`✨ ${cardName(placed)} liegt zu Spielbeginn auf dem Spielfeld`, 'purple');
                } else if (action.type === 'reveal') {
                    logEvent(`deckt ${cardName(fresh)} auf (vor Spielbeginn)`, [fresh], 'reveal');
                    addToast(`👁 Du deckst ${cardName(fresh)} auf`, 'purple');
                    const when = /first main phase/i.test(action.sentence) ? 'main1' : /first upkeep/i.test(action.sentence) ? 'upkeep' : null;
                    if (when) updateMyState({ pregameReveals: [...(myState.pregameReveals || []), { instanceId: fresh.instanceId, name: cardName(fresh), sentence: action.sentence, when }] });
                }
            };
            const pregameExileFromHand = (card) => {
                runTx(async (tx) => {
                    const snap = await tx.get(myStateRef);
                    if (!snap.exists()) return;
                    const d = snap.data();
                    if (!(d.hand || []).some(c => c.instanceId === card.instanceId)) return;
                    tx.update(myStateRef, { hand: d.hand.filter(c => c.instanceId !== card.instanceId), exile: [card, ...(d.exile || [])] });
                }).catch(err => addToast(`❌ ${err.message}`, 'red'));
                logEvent(`${cardName(card)}: Hand → Exil (vor Spielbeginn)`, [card]);
            };

            // Whether every seated player has finished the mulligan phase / answered the pregame question.
            const allPlayersSeated = lobbyState?.seatOrder || [];
            const everyoneMulliganDone = allPlayersSeated.length > 0 && allPlayersSeated.every(
                uid => lobbyState?.mulliganStatus?.[uid]?.completed
            );
            const everyonePregameDone = allPlayersSeated.length > 0 && allPlayersSeated.every(
                uid => typeof lobbyState?.pregameAction?.[uid] === 'boolean'
            );
            const mySeatNumber = allPlayersSeated.indexOf(user.uid) + 1; // 1-indexed seat position
            const amIFirstPlayer = allPlayersSeated.length > 0 && allPlayersSeated[0] === user.uid;

            // Default spawn position for a card landing on the battlefield without an explicit drop position
            // (e.g. played via a button, resolved off the stack, etc.) - a random spot near the right side of
            // MY OWN battlefield, expressed as a percentage so it renders consistently for every viewer
            // regardless of their screen size. This is the same spot lands and tokens land in, so a card
            // resolving off the stack ends up somewhere sensible and visible instead of dead-center on top
            // of UI overlays.
            // Picks the next spawn spot for `card` within ONE of 5 "neighborhoods" of my own battlefield,
            // based on its type, so lands/creatures/artifacts/enchantments/planeswalkers don't all pile up in
            // the same spot. This only affects where a card lands when first played - dragging it anywhere
            // else afterward still works exactly as before (e.g. to sort lands by color), nothing is locked
            // into its zone.
            //
            // Each zone is exactly ONE card-height tall (CARD_H), flush against whichever piece of UI chrome
            // borders it (the hand zone's top edge, or a sidebar's inner edge) - measured from the REAL
            // rendered size of that chrome via refs, not a hardcoded guess, so it stays correct even if e.g.
            // the left sidebar grows taller from a big Command Zone. Cards within a zone are placed left-to-
            // right, one card-width apart, in the order they're already on the battlefield - the new card
            // goes into the next free slot after the last one of its type, flush against the zone's left edge.
            //
            // Layout:
            //   ┌──────────────────────────────────────────────────────┐
            //   │                   CREATURES (full width)             │
            //   ├────────┬──────────────────────────────────────┬──────┤
            //   │        │             LANDS                     │      │
            //   │  YOU   ├──────────┬──────────────────┬─────────┤ DECK │
            //   │  ZONE  │Enchantmt │   PLANESWALKER   │Artifact │ ZONE │
            //   │(free!) ├──────────┴──────────────────┴─────────┤      │
            //   │        │                HAND                   │      │
            //   └────────┴───────────────────────────────────────┴──────┘
            // Aktuelle Geometrie meines Spielfelds (gemessen an den echten Seitenleisten), siehe computeBfGeom.
            const measureMyGeom = () => {
                const bfRect = playerLowerBattlefieldRef.current?.getBoundingClientRect();
                const bfWidth = bfRect?.width || window.innerWidth;
                const bfHeight = bfRect?.height || 300;
                const leftSidebarRect = myLeftSidebarRef.current?.getBoundingClientRect();
                const rightSidebarRect = myRightSidebarRef.current?.getBoundingClientRect();
                const leftSidebarRightX = leftSidebarRect && bfRect ? Math.max(leftSidebarRect.right - bfRect.left, 0) : 232;
                const rightSidebarLeftX = rightSidebarRect && bfRect ? Math.min(rightSidebarRect.left - bfRect.left, bfWidth) : (bfWidth - 232);
                return computeBfGeom(bfWidth, bfHeight, leftSidebarRightX, rightSidebarLeftX);
            };
            // Nächster freier Platz in der Reihe des Kartentyps (als Prozentwert). Die endgültige Lage rechnet die
            // Darstellung (layoutMyCards) aus – Kreaturen landen immer in der Kreaturenreihe, Länder in der Länderreihe usw.
            const slotPercent = (card, excludeInstanceId = null) => {
                const geom = measureMyGeom();
                const zoneType = getCardZoneType(card);
                const others = [...(myState.battlefieldLower || []), ...(myState.battlefieldUpper || [])]
                    .filter(c => c.instanceId !== excludeInstanceId && getCardZoneType(c) === zoneType);
                // ans Ende der Reihe: größer als jedes vorhandene x
                const maxX = others.reduce((m, c) => Math.max(m, c.x ?? 0), -1);
                const zone = geom.zones[zoneType] || geom.zones.creature;
                const pxX = fanX(zone, geom, others.length, others.length + 1);
                const x = Math.max(Math.min(Math.max((pxX / geom.bfWidth) * 100, 0), 96), Math.min(maxX + 0.01, 99));
                const y = Math.min(Math.max((zone.top / geom.bfHeight) * 100, 0), 96);
                return { x, y };
            };
            const getDefaultSpawnPosition = (card) => slotPercent(card);

            const ZONE_LABEL = { none: 'Zone eines Mitspielers', battlefield: 'Spielfeld', battlefieldLower: 'Spielfeld', battlefieldUpper: 'Spielfeld', graveyard: 'Friedhof', exile: 'Exil', hand: 'Hand', library: 'Bibliothek', library_top: 'Bibliothek (oben)', library_bottom: 'Bibliothek (unten)', command: 'Commander-Zone', stack: 'Stack' };
            const ZONE_KEY = { hand: 'hand', graveyard: 'graveyard', exile: 'exile', library: 'library', library_top: 'library', library_bottom: 'library', command: 'commandZone', battlefieldLower: 'battlefieldLower', battlefieldUpper: 'battlefieldUpper' };
            // Entfernt die Karte aus ihrer Herkunftszone (in `updates`, damit mehrere Änderungen in EIN Schreiben gehen)
            const removeFrom = (updates, fromZone, id) => {
                const key = ZONE_KEY[fromZone];
                if (!key) return updates;
                updates[key] = (updates[key] || myState[key] || []).filter(c => c.instanceId !== id);
                return updates;
            };
            // Karte betritt mein Spielfeld (nicht als Land): Vorderseite festlegen, „enters tapped“ beachten
            const prepEnter = (card, tapped) => {
                const c = frontFace(card);
                const t = tapped !== undefined ? tapped : (!isLand(c) && entersTappedSelf(c));
                return { ...c, isTapped: !!t, counters: c.counters || [] };
            };

            const playCard = (card, fromZone, targetBattlefield, coords = null) => {
                const fromBf = fromZone === 'battlefieldUpper' || fromZone === 'battlefieldLower';
                // Länder (auch aus Friedhof/Bibliothek/Exil) laufen über die Land-Logik (getappt, Shock, Landfall …)
                if (!fromBf && isLand(frontFace(card))) { enterLand(card, fromZone, coords); return; }
                if (!fromBf && isAuraCard(card)) { startAuraTargeting({ aura: card, source: 'zone', fromZone }); return; }
                let x = coords?.x;
                let y = coords?.y;

                if (x === undefined || y === undefined) {
                    const spawn = getDefaultSpawnPosition(card);
                    x = spawn.x;
                    y = spawn.y;
                }

                const base = fromBf ? { ...card, isTapped: false } : prepEnter(card);
                const newCard = { ...base, x, y, counters: card.counters || [] };
                let updates = {};
                
                if (fromZone === 'battlefieldUpper') updates.battlefieldUpper = (myState.battlefieldUpper || []).filter(c => c.instanceId !== card.instanceId);
                else if (fromZone === 'battlefieldLower') updates.battlefieldLower = (myState.battlefieldLower || []).filter(c => c.instanceId !== card.instanceId);
                if (targetBattlefield === 'upper') {
                    updates.battlefieldUpper = [...(updates.battlefieldUpper || myState.battlefieldUpper || []), newCard];
                } else {
                    updates.battlefieldLower = [...(updates.battlefieldLower || myState.battlefieldLower || []), newCard];
                }
                
                if (fromZone === 'hand') updates.hand = myState.hand.filter(c => c.instanceId !== card.instanceId);
                else if (fromZone === 'command') {
                    setTimeout(() => pushCastTriggers(card), 0); // Commander wirken = Zauber wirken
                    updates.commandZone = myState.commandZone.filter(c => c.instanceId !== card.instanceId);
                    // Each commander (e.g. each half of a Partner pair) taxes independently - only the one
                    // actually being cast gets its own counter bumped, the other Partner's stays untouched.
                    updates.cmdTax = { ...(myState.cmdTax || {}), [card.instanceId]: ((myState.cmdTax || {})[card.instanceId] || 0) + 2 };
                }
                else if (fromZone === 'graveyard') updates.graveyard = myState.graveyard.filter(c => c.instanceId !== card.instanceId);
                else if (fromZone === 'exile') updates.exile = myState.exile.filter(c => c.instanceId !== card.instanceId);
                else if (fromZone === 'library_top' || fromZone === 'library') updates.library = myState.library.filter(c => c.instanceId !== card.instanceId);

                updateMyState(updates);
                if (!fromBf) {
                    const n = cardName(newCard);
                    logEvent(fromZone === 'hand' ? `bringt ${n} direkt ins Spiel${newCard.isTapped ? ' (getappt)' : ''}` : `${n}: ${ZONE_LABEL[fromZone] || fromZone} → Spielfeld${newCard.isTapped ? ' (getappt)' : ''}`, [newCard]);
                    if (newCard.isTapped) addToast(`💤 ${n} kommt getappt ins Spiel`, 'blue');
                }
            };

            // --- STACK ZONE (shared, visible to everyone at the table) ---
            // Used for non-land cards played from hand whose effects (extra targets, tokens for OTHER
            // players, destroy effects, etc.) need to be resolved manually by the player before the card
            // actually settles into its final zone. Lives on the shared lobby document (lobbyState.stack)
            // so every player can see what's "on the stack" right now, the same way you'd see an opponent
            // casting a spell at the table. Each player only ever adds/removes their OWN stack entries.
            const myStackCards = (lobbyState?.stack || []).filter(s => s.ownerId === user.uid);
            const allStackCards = lobbyState?.stack || [];

            // Zauber auf den Stack legen (aus Hand, Friedhof, Exil, Bibliothek). `extra.auraTarget` merkt sich das
            // beim Ziehen auf eine Kreatur gewählte Ziel einer Aura.
            const castToStack = (card, fromZone = 'hand', extra = {}) => {
                // The stack is LIFO: whatever goes on last resolves first. New entries go at the FRONT of the
                // array (index 0). Uses a transaction because two players can plausibly cast in quick succession.
                const stackEntry = { instanceId: card.instanceId, card, ownerId: user.uid, ownerName: user.displayName || getDeckCommanderDisplayName(deck) || 'Spieler', timestamp: Date.now(), ...extra };
                // „Whenever you cast …“-Auslöser meiner Permanents kommen in DERSELBEN Transaktion über den Zauber
                const trig = castTriggerEntries(card);
                runTx(async (tx) => {
                    const snap = await tx.get(roomRef);
                    const currentStack = snap.exists() ? (snap.data().stack || []) : [];
                    tx.update(roomRef, { stack: [...trig, stackEntry, ...currentStack] });
                }).catch(err => addToast(`❌ ${err.message}`, 'red'));
                updateMyState(removeFrom({}, fromZone, card.instanceId));
                logEvent(`spielt ${cardName(card)}${fromZone !== 'hand' ? ` (aus ${fromZone === 'graveyard' ? 'dem Friedhof' : fromZone === 'exile' ? 'dem Exil' : fromZone === 'command' ? 'der Commander-Zone' : 'der Bibliothek'})` : ''}`, [card]);
                if (trig.length) { logEvent(`löst aus: ${trig.map(t => t.card.name).join(', ')}`); addToast(`⚡ ${trig.map(t => t.card.name).join(', ')} löst aus`, 'yellow'); }
            };
            // Zauberauslöser („Whenever you cast …“) meiner Permanents für `spell` als Stack-Einträge
            const castTriggerEntries = (spell) => {
                const entries = [];
                myPermanents().forEach(perm => castTriggersFor(perm, spell).forEach(tr => {
                    const eff = tr.effects || [];
                    entries.push({
                        instanceId: generateId(), isTrigger: true,
                        triggerEffect: eff[0]?.effect || 'notify', triggerAmount: eff[0]?.amount || 0, triggerEffects: eff,
                        triggerText: `${cardName(perm)}: ${tr.sentence}`, triggerClause: tr.clause, castOf: spell.instanceId,
                        card: { name: cardName(perm), image_url: perm.image_url || '', instanceId: perm.instanceId, type_line: 'Triggered Ability' },
                        ownerId: user.uid, ownerName: user.displayName || getDeckCommanderDisplayName(deck) || 'Spieler', timestamp: Date.now(),
                    });
                }));
                return entries;
            };
            // Zauber, der nicht über castToStack läuft (Commander direkt aus der Commander-Zone): Auslöser trotzdem auf den Stack
            const pushCastTriggers = (spell) => {
                const trig = castTriggerEntries(spell);
                if (!trig.length) return;
                runTx(async (tx) => {
                    const snap = await tx.get(roomRef);
                    const currentStack = snap.exists() ? (snap.data().stack || []) : [];
                    tx.update(roomRef, { stack: [...trig, ...currentStack] });
                }).catch(err => addToast(`❌ ${err.message}`, 'red'));
                logEvent(`löst aus: ${trig.map(t => t.card.name).join(', ')}`);
            };

            // Entry point for the "Spielen" button on hand cards: lands go straight to the battlefield
            // (with their ETB choice), everything else goes to the shared stack first.
            const playCardFromHand = (card) => {
                if (isLand(card)) { enterLand(card, 'hand'); return; }
                castToStack(card, 'hand');
            };
            // Modale doppelseitige Karte als Land (Rückseite) spielen
            const playLandFace = (card, idx = 1) => enterLand(withFace(card, idx), 'hand');

            // Zentrale Land-Logik für jedes Land, das mein Spielfeld betritt (Hand, Friedhof, Bibliothek, Ziehen aufs Feld):
            // Shock/Check/… → Auswahlfenster; „enters tapped“/Triome → getappt; sonst ungetappt. Danach Landfall.
            const enterLand = (card, fromZone, coords = null) => {
                const c = frontFace(card);
                const etbType = detectLandETB(c, myPermanents(), myState.hand);
                if (etbType && !['pain', 'tapped', 'triome'].includes(etbType)) {
                    setLandETBModal({ card: c, fromZone, type: etbType, coords });
                    return;
                }
                placeLand(c, fromZone, etbType === 'tapped' || etbType === 'triome', {}, coords);
            };
            const placeLand = (card, fromZone, tapped, extra = {}, coords = null) => {
                const spawn = coords && coords.x !== undefined ? coords : getDefaultSpawnPosition(card);
                const newCard = { ...card, isTapped: !!tapped, x: spawn.x, y: spawn.y, counters: [] };
                const updates = removeFrom({}, fromZone, card.instanceId);
                let lower = [...(myState.battlefieldLower || []), newCard];
                // Bounce-Land: ein anderes Land zurück auf die Hand
                if (extra.bounce) {
                    lower = lower.filter(c => c.instanceId !== extra.bounce.instanceId);
                    updates.battlefieldUpper = (myState.battlefieldUpper || []).filter(c => c.instanceId !== extra.bounce.instanceId);
                    updates.hand = [...(updates.hand || myState.hand), cleanLeaving(extra.bounce)];
                }
                updates.battlefieldLower = lower;
                if (extra.life) updates.life = myState.life + extra.life;
                updateMyState(updates);
                const n = cardName(newCard);
                logEvent(fromZone === 'hand' ? `spielt Land ${n}${tapped ? ' (getappt)' : ''}` : `${n}: ${ZONE_LABEL[fromZone] || fromZone} → Spielfeld${tapped ? ' (getappt)' : ''}`, [newCard]);
                if (extra.bounce) logEvent(`${cardName(extra.bounce)} → Hand`, [extra.bounce]);
                setTimeout(() => fireTriggers('landfall', newCard), 100);
                return newCard;
            };

            const resolveLandETB = (tapped, extraUpdates = {}) => {
                if (!landETBModal) return;
                const { card, fromZone, type, coords } = landETBModal;

                // Land liegt schon (getappt) auf dem Feld, z. B. aus einer Fetch-Suche: ungetappt = enttappen (+ Lebenskosten)
                if (landETBModal.onBf || type === 'shock_fetch') {
                    if (!tapped) {
                        const untap = (arr) => (arr || []).map(c =>
                            c.instanceId === card.instanceId ? { ...c, isTapped: false } : c
                        );
                        const upd = { battlefieldLower: untap(myState.battlefieldLower), battlefieldUpper: untap(myState.battlefieldUpper) };
                        if (extraUpdates.life) upd.life = myState.life + extraUpdates.life;
                        updateMyState(upd);
                    }
                    setLandETBModal(null);
                    return;
                }

                placeLand(card, fromZone, tapped, extraUpdates, coords);
                setLandETBModal(null);
                const t = type;
                if (t === 'scry') setTimeout(() => openLibraryAction('scry', 1), 150);
                if (t === 'surveil') setTimeout(() => openLibraryAction('surveil', 1), 150);
            };

            // Removes a card from the shared stack only
            // been resolved to their real destination (battlefield/graveyard/exile/an Aura attachment), so
            // there's nothing left to "give back". Transactional: someone else might be pushing a new
            // response onto the stack at the same moment this card is being resolved off of it.
            const removeFromStack = (instanceId) => {
                runTx(async (tx) => {
                    const snap = await tx.get(roomRef);
                    const currentStack = snap.exists() ? (snap.data().stack || []) : [];
                    tx.update(roomRef, { stack: currentStack.filter(s => s.instanceId !== instanceId) });
                });
            };

            // What the stack's "Remove" button actually does: pulls the card off the stack AND gives it back
            // to its owner's hand, since at this point its effects haven't resolved anywhere yet - it needs
            // to go somewhere, and "back to hand" is the only sensible undo for an unresolved spell.
            const returnStackCardToHand = (stackEntry) => {
                removeFromStack(stackEntry.instanceId);
                // Only I can write to my own hand - the UI only ever shows the Remove button on the caller's
                // own stack entries anyway, so this should always be true when called from the button.
                if (stackEntry.ownerId === user.uid) {
                    updateMyState({ hand: [...myState.hand, stackEntry.card] });
                }
            };

            // Moves a card off the stack and onto MY OWN battlefield (e.g. a permanent spell resolving).
            // Auren: erst ein Ziel wählen (oder das beim Ziehen gemerkte Ziel nehmen); `noTarget` legt sie lose ab.
            const moveStackCardToBattlefield = (stackEntry, targetBattlefield, noTarget = false) => {
                if (!noTarget && isAuraCard(stackEntry.card)) {
                    const t = stackEntry.auraTarget;
                    if (t) {
                        const where = findOnBattlefield(t.cardInstanceId);
                        if (where) { chooseAuraTarget(where.card, where.zone, where.playerId, { aura: stackEntry.card, source: 'stack', stackEntry }); return; }
                    }
                    startAuraTargeting({ aura: stackEntry.card, source: 'stack', stackEntry });
                    return;
                }
                const { x, y } = getDefaultSpawnPosition(stackEntry.card);
                const newCard = { ...prepEnter(stackEntry.card), x, y };
                const updates = {};
                if (targetBattlefield === 'upper') updates.battlefieldUpper = [...(myState.battlefieldUpper || []), newCard];
                else updates.battlefieldLower = [...(myState.battlefieldLower || []), newCard];
                updateMyState(updates);
                removeFromStack(stackEntry.instanceId);
                if (newCard.isTapped) addToast(`💤 ${cardName(newCard)} kommt getappt ins Spiel`, 'blue');
                // Fire ETB triggers after placing on battlefield
                setTimeout(() => fireTriggers('etb', newCard), 50);
            };

            // Wo liegt eine Karte auf einem Spielfeld (meinem oder einem gegnerischen)?
            const findOnBattlefield = (instanceId) => {
                for (const z of ['battlefieldLower', 'battlefieldUpper']) {
                    const c = (myState[z] || []).find(x => x.instanceId === instanceId);
                    if (c) return { card: c, zone: z, playerId: user.uid };
                }
                for (const oid of opponentIds) for (const z of ['battlefieldLower', 'battlefieldUpper']) {
                    const c = (opponentStates[oid]?.[z] || []).find(x => x.instanceId === instanceId);
                    if (c) return { card: c, zone: z, playerId: oid };
                }
                return null;
            };

            // ── AUREN ANLEGEN ─────────────────────────────────────────────────
            const auraTargetOk = (spec, card, isMine) => {
                if (!spec || !card || card.instanceId === spec.aura.instanceId) return false;
                const e = spec.enchant || {};
                if (e.player) return false;
                if (e.ctrl === 'me' && !isMine) return false;
                if (e.ctrl === 'opp' && isMine) return false;
                if (e.nonland && isLand(card)) return false;
                if (e.any || !e.types?.length) return e.any ? true : isCreatureLike(card);
                const tl = curTypeLine(card);
                return e.types.some(t => t === 'creature' ? isCreatureLike(card) : t === 'land' ? isLand(card) : new RegExp(`\\b${t}\\b`, 'i').test(tl));
            };
            const startAuraTargeting = (spec) => {
                const enchant = parseEnchant(spec.aura);
                const full = { ...spec, enchant };
                if (enchant.player) {
                    addToast(`✨ ${cardName(spec.aura)} verzaubert einen Spieler – liegt in deiner Verzauberungsreihe`, 'purple');
                    placeAuraLoose(full);
                    return;
                }
                setCardMenu(null); setViewingZone(null);
                setAuraTarget(full);
            };
            // Aura ohne Ziel ins Spiel (Verzauberungsreihe) – „Ohne Ziel ablegen“ / Esc
            const placeAuraLoose = (spec = auraTarget) => {
                setAuraTarget(null);
                if (!spec) return;
                if (spec.source === 'stack') { moveStackCardToBattlefield(spec.stackEntry, 'lower', true); return; }
                if (spec.source === 'bf') return; // liegt schon lose
                const { x, y } = getDefaultSpawnPosition(spec.aura);
                const newCard = { ...prepEnter(spec.aura), x, y };
                const updates = removeFrom({}, spec.fromZone, spec.aura.instanceId);
                updates.battlefieldLower = [...(updates.battlefieldLower || myState.battlefieldLower || []), newCard];
                updateMyState(updates);
                logEvent(`${cardName(newCard)}: ${ZONE_LABEL[spec.fromZone] || spec.fromZone} → Spielfeld`, [newCard]);
            };
            // Aura an `targetCard` anlegen. Eigene Karte: direkt; fremde Karte: Anfrage an deren Besitzer (attachRequests).
            const chooseAuraTarget = (targetCard, targetZone, targetPlayerId, spec = auraTarget) => {
                if (!spec) return;
                setAuraTarget(null);
                const aura = cleanLeaving(spec.aura);
                delete aura.x; delete aura.y;
                const attachment = { instanceId: spec.aura.instanceId, kind: 'aura', name: cardName(aura), image_url: aura.image_url || '', card: aura, ownerId: spec.aura.ownerId || user.uid };
                const updates = {};
                if (spec.source === 'zone') removeFrom(updates, spec.fromZone, spec.aura.instanceId);
                if (spec.source === 'bf') { removeFrom(updates, 'battlefieldLower', spec.aura.instanceId); removeFrom(updates, 'battlefieldUpper', spec.aura.instanceId); }
                if (targetPlayerId === user.uid) {
                    updates[targetZone] = (updates[targetZone] || myState[targetZone] || []).map(c =>
                        c.instanceId === targetCard.instanceId ? { ...c, attachments: [...(c.attachments || []), attachment] } : c);
                } else {
                    pushRoomRequest('attachRequests', { id: generateId(), targetPlayerId, targetCardInstanceId: targetCard.instanceId, attachment, fromPlayerId: user.uid });
                }
                if (Object.keys(updates).length) updateMyState(updates);
                if (spec.source === 'stack') removeFromStack(spec.stackEntry.instanceId);
                logEvent(`${cardName(aura)} verzaubert ${cardName(targetCard)}${targetPlayerId !== user.uid ? ` (${getPlayerName(targetPlayerId)})` : ''}`, [aura, targetCard]);
                addToast(`✨ ${cardName(aura)} → ${cardName(targetCard)}`, 'purple');
            };

            // Resolves a triggered ability from the stack — applies its effect.
            // Mehrere einfache Effekte (triggerEffects) nacheinander; unbekannte Effekte nur als Erinnerung.
            const resolveStackTrigger = (stackEntry) => {
                removeFromStack(stackEntry.instanceId);
                // Only the owner's client executes the effect
                if (stackEntry.ownerId !== user.uid) return;
                const src = stackEntry.card?.name || 'Auslöser';
                const effects = Array.isArray(stackEntry.triggerEffects) ? stackEntry.triggerEffects
                    : (stackEntry.triggerEffect && stackEntry.triggerEffect !== 'notify' ? [{ effect: stackEntry.triggerEffect, amount: stackEntry.triggerAmount }] : []);
                if (!effects.length) {
                    addToast(`✅ ${stackEntry.triggerText || 'Trigger aufgelöst'} – bitte von Hand ausführen`, 'blue');
                    logEvent(`Auslöser aufgelöst (von Hand): ${stackEntry.triggerText || src}`);
                    return;
                }
                const parts = [];
                let lifeDelta = 0;
                const opps = opponentIds.filter(id => (lobbyState?.players || []).includes(id));
                effects.forEach(({ effect, amount }) => {
                    const n = Number(amount) || 0;
                    switch (effect) {
                        case 'draw': {
                            const k = Math.min(n, myState.library.length);
                            if (k > 0) { updateMyState({ hand: [...myState.hand, ...myState.library.slice(0, k)], library: myState.library.slice(k) }); noteDraw(k); }
                            addToast(`📖 ${k} Karte${k !== 1 ? 'n' : ''} gezogen`, 'blue');
                            parts.push(EFFECT_LABEL.draw(n));
                            break;
                        }
                        case 'gain_life':
                            lifeDelta += n;
                            addToast(`💚 ${n} Leben erhalten`, 'green');
                            parts.push(EFFECT_LABEL.gain_life(n));
                            break;
                        case 'damage_each_opp':
                        case 'opp_lose_life':
                            // Fremde Spielstände: nur „life“ darf geändert werden (Regeln), increment vermeidet veraltete Werte
                            opps.forEach(id => updateDoc(doc(db, 'arena_rooms', roomId, 'game_state', id), { life: increment(-n) }).catch(() => {}));
                            addToast(effect === 'damage_each_opp' ? `⚡ ${n} Schaden an jeden Gegner` : `🩸 Jeder Gegner verliert ${n} Leben`, 'red');
                            parts.push(EFFECT_LABEL[effect](n));
                            break;
                        case 'token': {
                            const specs = parseTokensFromOracleText({ oracle_text: stackEntry.triggerClause || '' });
                            if (specs.length) specs.forEach(sp => (sp.isAura ? setAuraAttachPrompt(sp) : createTokens(sp)));
                            else { addToast(`🪙 ${src}: Token bitte über „Token“ erstellen`, 'yellow'); setTokenModalOpen(true); }
                            parts.push('Token');
                            break;
                        }
                        default:
                            addToast(`✅ ${stackEntry.triggerText || 'Trigger aufgelöst'}`, 'blue');
                    }
                });
                if (lifeDelta) updateMyState({ life: increment(lifeDelta) });
                logEvent(`Auslöser ${src}: ${parts.length ? parts.join(', ') : (stackEntry.triggerText || 'aufgelöst')}`);
            };

            // --- ATTACHMENTS (Aura/Equipment cards, not tokens) ---
            // An attached card lives inside the host's `attachments` array (with its own image/name/instanceId
            // and a `kind` of 'aura' or 'equipment'), not as a separate battlefield entry. This is what keeps
            // movement coupled (the attachment isn't drawn or dragged independently) while tap state stays
            // per-card (toggleTap operates on the host or the attachment by instanceId, see below).

            // Drag an Aura off the stack onto ANY creature, even one belonging to another player. Since I
            // can only write to my own game_state, attaching to MY OWN creature is direct; attaching to
            // someone else's goes through the same cross-player request queue used for token gifts.
            const attachAuraCardFromStack = (stackEntry, targetCard, targetZone, targetPlayerId) => {
                chooseAuraTarget(targetCard, targetZone, targetPlayerId, { aura: stackEntry.card, source: 'stack', stackEntry });
            };

            // Equip an Equipment artifact already on MY OWN battlefield onto one of MY OWN creatures (per the
            // real rule that you can only equip creatures you control). Unattaching from wherever it currently
            // sits (if anywhere) happens first, since an Equipment can only be on one creature at a time.
            const equipCardOnField = (equipmentCard, equipmentZone, targetCard, targetZone) => {
                const stripFromAllHosts = (arr) => (arr || []).map(c => ({ ...c, attachments: (c.attachments || []).filter(a => a.instanceId !== equipmentCard.instanceId) }));
                let nd = {
                    battlefieldLower: stripFromAllHosts(myState.battlefieldLower).filter(c => c.instanceId !== equipmentCard.instanceId),
                    battlefieldUpper: stripFromAllHosts(myState.battlefieldUpper).filter(c => c.instanceId !== equipmentCard.instanceId)
                };
                const attachment = { instanceId: equipmentCard.instanceId, kind: 'equipment', name: equipmentCard.name, image_url: equipmentCard.image_url, card: equipmentCard, ownerId: user.uid };
                const attach = (arr) => arr.map(c => c.instanceId === targetCard.instanceId ? { ...c, attachments: [...(c.attachments || []), attachment] } : c);
                nd.battlefieldLower = attach(nd.battlefieldLower);
                nd.battlefieldUpper = attach(nd.battlefieldUpper);
                updateMyState(nd);
            };

            // Detaches an Equipment and drops it back onto the battlefield as its own loose card (per the
            // real rule that unequipping just leaves the Equipment sitting there, not destroyed).
            const unequipToField = (hostCard, hostZone, attachment) => {
                const bf = (myState[hostZone] || []).map(c => 
                    c.instanceId === hostCard.instanceId ? { ...c, attachments: (c.attachments || []).filter(a => a.instanceId !== attachment.instanceId) } : c
                );
                const freedCard = { ...attachment.card, isTapped: false, x: hostCard.x, y: hostCard.y };
                updateMyState({ [hostZone]: [...bf, freedCard] });
            };

            // Moves a card off the stack and into MY graveyard/exile (e.g. an instant/sorcery finishing
            // resolution, or a permanent that got countered/etc.).
            const moveStackCardToMyZone = (stackEntry, zone) => {
                const updates = {};
                if (zone === 'graveyard') updates.graveyard = [stackEntry.card, ...myState.graveyard];
                else if (zone === 'exile') updates.exile = [stackEntry.card, ...myState.exile];
                const c = stackEntry.card;
                if (c?.isCommander && !foreignOwner(c)) updates.cmdPending = [...(myState.cmdPending || []).filter(p => p.instanceId !== c.instanceId), { instanceId: c.instanceId, name: cardName(c), zone }];
                updateMyState(updates);
                removeFromStack(stackEntry.instanceId);
            };

            // Searches Scryfall's token card type for a real token image matching this spec. Tries the most
            // specific query first (name + power/toughness + color), then falls back to name-only if that
            // comes up empty (covers reprints with slightly different P/T due to errata, alternate-art
            // tokens, etc.). Returns null on no match or any network failure - callers should keep using the
            // placeholder image in that case, never block on this.
            const findScryfallTokenImage = async (name, stats, colors) => {
                try {
                    const colorQuery = (colors && colors.length && colors[0] !== 'C') ? ` c:${colors.join('').toLowerCase()}` : '';
                    const statsQuery = stats ? ` pow=${stats.split('/')[0]} tou=${stats.split('/')[1]}` : '';
                    const firstWord = name.split(' ')[0];

                    // Try queries from most to least specific, stopping at the first one with a result.
                    // The full name (e.g. "Merfolk Wizard") is tried before falling back to just the first
                    // word, since some token names in oracle text are multi-word but Scryfall's own token
                    // database may file them under either the full name or just the creature type.
                    const queries = [
                        `t:token name:"${name}"${statsQuery}${colorQuery}`,
                        `t:token name:"${name}"${colorQuery}`,
                        `t:token name:"${firstWord}"${statsQuery}${colorQuery}`,
                        `t:token name:"${firstWord}"${colorQuery}`
                    ];

                    for (const query of queries) {
                        const data = await fetchWithRetry(`${SCRYFALL_API_BASE}/cards/search?q=${encodeURIComponent(query)}&order=released&unique=art`);
                        const match = data.data && data.data[0];
                        if (match) return match.image_uris?.normal || match.card_faces?.[0]?.image_uris?.normal || null;
                    }
                    return null;
                } catch (e) {
                    console.warn('Scryfall token image lookup failed, using placeholder:', e);
                    return null;
                }
            };

            const createTokens = ({ name, stats, quantity, colors, ability }) => {
                // Build a minimal pseudo-card so getCardZoneType can classify the token the same way it does
                // real cards: tokens with stats (p_t) read as creatures, named artifact tokens like Treasure
                // fall back to the artifact zone since they have no type_line of their own.
                const pseudoCard = stats 
                    ? { isToken: true, p_t: stats } 
                    : { type_line: 'Artifact' };

                const newTokens = [];
                for (let i = 0; i < quantity; i++) {
                    const { x, y } = getDefaultSpawnPosition(pseudoCard);
                    const labelLine2 = stats ? stats : (ability || '');
                    const placeholderUrl = `https://placehold.co/200x280/444/FFF?text=${encodeURIComponent(name)}\n${encodeURIComponent(labelLine2)}`;
                    
                    const token = {
                        instanceId: generateId(),
                        name: name,
                        p_t: stats || null,
                        colors: colors,
                        ability: ability || null,
                        image_url: placeholderUrl,
                        isTokenPlaceholder: true, // marks this image as "not yet confirmed real" for the async patch below
                        isTapped: false,
                        isToken: true,
                        counters: [],
                        x: x,
                        y: y
                    };
                    newTokens.push(token);
                }
                
                updateMyState({
                    battlefieldLower: [...(myState.battlefieldLower || []), ...newTokens]
                });
                logEvent(`erstellt ${quantity > 1 ? quantity + '× ' : ''}${name}${stats ? ' ' + stats : ''}-Token`);

                // Place tokens immediately with the placeholder image so the game never stalls waiting on a
                // network request - then look up the real Scryfall art in the background and patch each
                // token's image_url in place once (if) it's found, by matching on instanceId.
                findScryfallTokenImage(name, stats, colors).then(async (realImageUrl) => {
                    if (!realImageUrl) return;
                    // Read a FRESH snapshot of my own state before patching - myState in this closure may be
                    // stale by the time this network request resolves (the player could have taken other
                    // actions in the meantime), and writing based on stale data would silently undo them.
                    const freshSnap = await getDoc(myStateRef);
                    if (!freshSnap.exists()) return;
                    const freshState = freshSnap.data();
                    const idsToPatch = new Set(newTokens.map(t => t.instanceId));
                    const patchZone = (arr) => (arr || []).map(c => idsToPatch.has(c.instanceId) ? { ...c, image_url: realImageUrl, isTokenPlaceholder: false } : c);
                    updateDoc(myStateRef, {
                        battlefieldLower: patchZone(freshState.battlefieldLower),
                        battlefieldUpper: patchZone(freshState.battlefieldUpper)
                    });
                });
            };

            // Asks a DIFFERENT player's client to create a token under their own control. We can never write
            // to another player's game_state document directly (each client only writes its own), so instead
            // we drop a request onto the shared lobby document; the target player's own client is watching for
            // requests addressed to them (see the effect below) and creates the token on their own battlefield
            // automatically. This is what makes "its controller creates a token" effects (Beast Within, Into
            // the Flood Maw's gift, etc.) resolve onto the correct player's side instead of always landing on
            // whoever right-clicked the card.
            const requestTokenForPlayer = (targetPlayerId, tokenSpec) => {
                if (targetPlayerId === user.uid) {
                    if (tokenSpec.isAura) { setAuraAttachPrompt(tokenSpec); return; } // I need to pick my own creature to enchant
                    createTokens(tokenSpec);
                    return;
                }
                const request = { id: generateId(), targetPlayerId, tokenSpec, fromPlayerId: user.uid };
                pushRoomRequest('tokenRequests', request);
                logEvent(`gibt ${getPlayerName(targetPlayerId)} ${tokenSpec.quantity > 1 ? tokenSpec.quantity + '× ' : ''}${tokenSpec.name}${tokenSpec.stats ? ' ' + tokenSpec.stats : ''}-Token`);
            };

            // Creates an Aura token (e.g. a Role) already attached to a specific creature on MY battlefield,
            // by stamping its image/name onto the chosen creature's `auras` list rather than placing it as a
            // separate free-floating card. Keeps it simple: Roles/Auras ride along with their host creature
            // instead of needing their own x/y position and drag logic.
            const attachAuraToken = (tokenSpec, targetCard, targetZone) => {
                const auraEntry = { instanceId: generateId(), name: tokenSpec.name, ability: tokenSpec.ability };
                const bf = (myState[targetZone] || []).map(c => 
                    c.instanceId === targetCard.instanceId ? { ...c, auras: [...(c.auras || []), auraEntry] } : c
                );
                updateMyState({ [targetZone]: bf });
                setAuraAttachPrompt(null);
                logEvent(`erstellt ${tokenSpec.name}-Token an ${cardName(targetCard)}`, [targetCard]);
            };

            // --- EMBLEMS (The Ring, Max Speed, Planeswalker emblems, freeform) ---
            // myState.emblems: [{ instanceId, name, stage, maxStage, stageText, ringBearerInstanceId? }]
            const myEmblems = myState.emblems || [];

            // Creates a new emblem if I don't already have one with this name (mirrors the real rule that
            // a player can only ever have one emblem named "The Ring"). For predefined emblems (Ring, Max
            // Speed) this starts at stage 0/no abilities yet; advancing happens via advanceEmblem below.
            const createEmblem = (name, customText) => {
                if (myEmblems.some(e => e.name === name)) return; // Already have one - "tempting" advances it instead
                const def = EMBLEM_DEFINITIONS[name];
                const emblem = def
                    ? { instanceId: generateId(), name, stage: 0, maxStage: def.maxStage, stageText: def.stageText, requiresBearer: def.requiresBearer }
                    : { instanceId: generateId(), name, stage: 1, maxStage: 1, stageText: [customText || name], requiresBearer: false };
                updateMyState({ emblems: [...myEmblems, emblem] });
            };

            // Advances an emblem to its next stage (e.g. "the Ring tempts you" again). No-ops once maxStage
            // is reached, matching the real rule that the Ring stops gaining new abilities after stage 4.
            const advanceEmblem = (instanceId) => {
                const updated = myEmblems.map(e => 
                    e.instanceId === instanceId ? { ...e, stage: Math.min(e.stage + 1, e.maxStage) } : e
                );
                updateMyState({ emblems: updated });
            };

            // Sets/changes which creature is the Ring-bearer for a given Ring emblem.
            const setRingBearer = (emblemInstanceId, creatureInstanceId) => {
                const updated = myEmblems.map(e => 
                    e.instanceId === emblemInstanceId ? { ...e, ringBearerInstanceId: creatureInstanceId } : e
                );
                updateMyState({ emblems: updated });
            };

            // Combined "the Ring tempts you" step: advances the stage AND lets you (re)pick a Ring-bearer in
            // one action, matching the real rule that both things happen together each time you're tempted.
            // The Ring still advances even if you have no creatures to choose - you simply skip that part.
            const advanceRingWithBearer = (emblemInstanceId, creatureInstanceId) => {
                const updated = myEmblems.map(e => {
                    if (e.instanceId !== emblemInstanceId) return e;
                    const next = { ...e, stage: Math.min(e.stage + 1, e.maxStage) };
                    if (creatureInstanceId) next.ringBearerInstanceId = creatureInstanceId;
                    return next;
                });
                updateMyState({ emblems: updated });
                setRingAdvancePrompt(null);
            };

            const addCounterToCard = (card, zone, counterType, amount = 1) => {
                const currentCounters = card.counters || [];
                const existingCounter = currentCounters.find(c => c.type === counterType);
                let newCounters;

                if (existingCounter) {
                    const newCount = existingCounter.count + amount;
                    if (newCount > 0) {
                        newCounters = currentCounters.map(c => 
                            c.type === counterType ? { ...c, count: newCount } : c
                        );
                    } else {
                        newCounters = currentCounters.filter(c => c.type !== counterType);
                    }
                } else if (amount > 0) {
                    newCounters = [...currentCounters, { type: counterType, count: amount }];
                } else {
                    return;
                }
                
                const updatedCard = { ...card, counters: newCounters };
                const bf = (myState[zone] || []).map(c => 
                    c.instanceId === card.instanceId ? updatedCard : c
                );
                
                updateMyState({ [zone]: bf });
            };

            // ── FETCH LAND SYSTEM ────────────────────────────────────────────────────
            // Parses any "sacrifice this land: search your library" ability from oracle_text
            // and returns a structured description of what the fetch can find.
            const CAP = s => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
            // BASIC_SUBTYPES is defined at module level (used by FetchModal too)

            const parseFetchAbility = (oracleText) => {
                if (!oracleText) return null;
                const t = oracleText.toLowerCase();
                // Must contain both sacrifice AND a library search for lands.
                // Works with both modern text ("sacrifice this land:") and old text ("sacrifice [name]:").
                if (!t.includes('sacrifice')) return null;
                if (!t.includes('search your library')) return null;
                // Must be searching for a land (not a creature, spell, etc.)
                if (!t.match(/search your library for.{0,60}(land|plains|island|swamp|mountain|forest)/)) return null;

                // "up to two basic land cards that share a land type" — Myriad Landscape
                if (t.includes('share a land type') || t.match(/up to two basic land/))
                    return { type: 'basic_pair', subtypes: BASIC_SUBTYPES, count: 2, mustShareType: true };

                // "a Forest card and a Plains card" — Krosan Verge (fetch exactly those two types)
                const andMatch = t.match(/search your library for an? (\w+) card and an? (\w+) card/);
                if (andMatch)
                    return { type: 'specific_two', subtypes: [CAP(andMatch[1]), CAP(andMatch[2])], count: 2 };

                // "a Mountain or Plains card" — classic fetchlands
                // Also handles old wording "a plains or island card"
                const orMatch = t.match(/search your library for an? ([\w ]+?) or ([\w ]+?) card/);
                if (orMatch)
                    return { type: 'subtype_or', subtypes: [CAP(orMatch[1].trim()), CAP(orMatch[2].trim())], count: 1 };

                // "a basic land card" — Evolving Wilds, Terramorphic, Prismatic Vista
                if (t.match(/search your library for (?:up to \w+ )?(?:a )?basic land card/))
                    return { type: 'basic', subtypes: BASIC_SUBTYPES, count: 1 };

                // "a land card" (no basic restriction) — Ghost Quarter, Field of Ruin
                if (t.match(/search your library for a (?:basic |)?land card/))
                    return { type: 'any_land', subtypes: null, count: 1 };

                return null;
            };

            const filterFetchTargets = (library, ability) => {
                return library.filter(card => {
                    const typeLine = card.type_line || '';
                    if (!typeLine.toLowerCase().includes('land')) return false;
                    switch (ability.type) {
                        case 'basic':
                        case 'basic_pair':
                            return /\bBasic\b/i.test(typeLine);
                        case 'subtype_or':
                            return ability.subtypes.some(s => new RegExp(`\\b${s}\\b`, 'i').test(typeLine));
                        case 'specific_two':
                            // Each target just needs one of the two subtypes (player picks one of each)
                            return ability.subtypes.some(s => new RegExp(`\\b${s}\\b`, 'i').test(typeLine));
                        case 'any_land':
                            return true;
                        default: return false;
                    }
                });
            };

            // ── CREW SYSTEM ───────────────────────────────────────────────────────
            const parseCrew = (oracleText) => {
                const m = (oracleText || '').match(/\bcrew\s+(\d+)/i);
                return m ? parseInt(m[1]) : null;
            };

            const activateCrew = (vehicle, zone) => {
                setCrewModal({ vehicle, zone });
                setCardMenu(null);
            };

            const resolveCrew = (vehicle, vehicleZone, crewers) => {
                // 1. Tap all selected crewer creatures
                const tapCrewers = (arr) => (arr || []).map(c =>
                    crewers.find(cr => cr.instanceId === c.instanceId) ? { ...c, isTapped: true } : c
                );
                // 2. Mark vehicle as crewed (becomes artifact creature until end of turn)
                const crewVehicle = (arr) => (arr || []).map(c =>
                    c.instanceId === vehicle.instanceId ? { ...c, isCrewed: true } : c
                );
                const updates = {
                    battlefieldLower: crewVehicle(tapCrewers(myState.battlefieldLower || [])),
                    battlefieldUpper: crewVehicle(tapCrewers(myState.battlefieldUpper || [])),
                };
                updateMyState(updates);
                setCrewModal(null);
                addToast(`🚗 ${vehicle.name} ist bemannt – bis Zugende eine Artefaktkreatur`, 'blue');
            };

            const activateFetch = (card, zone) => {
                const ability = parseFetchAbility(card.oracle_text);
                if (!ability) return;
                const targets = filterFetchTargets(myState.library, ability);
                setFetchModal({ card, zone, ability, targets, selected: [] });
                setCardMenu(null);
            };

            const resolveFetch = (fetchCard, fetchZone, ability, selectedCards) => {
                let newLibrary = [...myState.library];
                let newBattlefield = [...(myState.battlefieldLower || [])];
                let newGY = [...(myState.graveyard || [])];
                let newLife = myState.life;

                // Costs: deduct 1 life if oracle_text says "pay 1 life"
                if (fetchCard.oracle_text?.toLowerCase().includes('pay 1 life')) newLife -= 1;

                // Remove the fetch land from wherever it is
                const removeFromZone = (arr) => arr.filter(c => c.instanceId !== fetchCard.instanceId);
                if (fetchZone === 'battlefieldLower') newBattlefield = removeFromZone(newBattlefield);
                else if (fetchZone === 'battlefieldUpper') {
                    const newUpper = (myState.battlefieldUpper || []).filter(c => c.instanceId !== fetchCard.instanceId);
                    updateMyState({ battlefieldUpper: newUpper }); // handle separately for upper
                }

                // Move fetch land to GY
                newGY = [cleanLeaving(fetchCard), ...newGY];

                // Getappt oder nicht entscheidet die FETCH-Karte („onto the battlefield tapped“ → getappt). Danach gilt die
                // eigene ETB-Logik des gesuchten Landes (Shock → 2 Leben zahlen, Check-Land prüfen, Triome getappt …).
                // Ist die Fetch-Karte schon „getappt“, ist jede Wahl hinfällig → einfach getappt.
                const fetchTapped = /onto the battlefield tapped/i.test(fetchCard.oracle_text || '');
                const placedCards = [];
                selectedCards.forEach(target => {
                    newLibrary = newLibrary.filter(c => c.instanceId !== target.instanceId);
                    const t0 = frontFace(target);
                    const pos = getDefaultSpawnPosition(t0);
                    const etbType = detectLandETB(t0);
                    const ownTapped = ['tapped', 'triome', 'scry', 'surveil', 'bounce'].includes(etbType);
                    const askType = !fetchTapped && ['shock', 'check', 'fast', 'slow', 'reveal'].includes(etbType) ? etbType : null;
                    // mit Auswahl: erst getappt hinlegen, das Fenster enttappt bei „ungetappt“
                    const placedCard = { ...t0, isTapped: fetchTapped || ownTapped || !!askType, x: pos.x, y: pos.y, counters: [] };
                    newBattlefield = [...newBattlefield, placedCard];
                    placedCards.push(placedCard);
                    setTimeout(() => {
                        fireTriggers('landfall', placedCard);
                        if (askType) setLandETBModal({ card: placedCard, fromZone: 'battlefieldLower', type: askType, onBf: true });
                        else if (etbType === 'scry') openLibraryAction('scry', 1);
                        else if (etbType === 'surveil') openLibraryAction('surveil', 1);
                    }, 200);
                });
                const anyAsk = placedCards.some(c => { const t = detectLandETB(c); return !fetchTapped && ['shock', 'check', 'fast', 'slow', 'reveal'].includes(t); });
                logEvent(`opfert ${cardName(fetchCard)} und sucht ${placedCards.map(cardName).join(', ') || 'nichts'}${!anyAsk && placedCards.some(c => c.isTapped) ? ' (getappt)' : ''}`, [fetchCard, ...placedCards]);

                // Shuffle library
                for (let i = newLibrary.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [newLibrary[i], newLibrary[j]] = [newLibrary[j], newLibrary[i]];
                }

                updateMyState({ library: newLibrary, battlefieldLower: newBattlefield, graveyard: newGY, life: newLife });
                setFetchModal(null);
            };

            // ── TRIGGER STACK SYSTEM ──────────────────────────────────────────────
            const pushTriggersOntoStack = (triggers) => {
                if (!triggers.length) return;
                const stackEntries = triggers.map(tr => ({
                    instanceId: generateId(),
                    isTrigger: true,
                    triggerEffect: tr.effect,
                    triggerAmount: tr.amount,
                    triggerText: tr.text || `${tr.source}: ${tr.effect}`,
                    card: { name: tr.source, image_url: tr.sourceCard?.image_url || null, instanceId: tr.sourceInstanceId || generateId(), type_line: 'Triggered Ability' },
                    ownerId: user.uid,
                    ownerName: user.displayName || 'Du',
                    timestamp: Date.now()
                }));
                runTx(async (tx) => {
                    const snap = await tx.get(roomRef);
                    const current = snap.exists() ? (snap.data().stack || []) : [];
                    tx.update(roomRef, { stack: [...stackEntries.reverse(), ...current] });
                }).catch(err => addToast(`Stack konnte nicht gespeichert werden: ${err.message}`, 'red'));
            };

            const fireTriggers = (event, eventCard = null) => {
                const allBF = [...(myState.battlefieldLower || []), ...(myState.battlefieldUpper || [])];
                // For ETB: also check the entering card itself as a watcher for "whenever a creature enters"
                // (e.g. Impact Tremors on battlefield watching a new creature enter)
                // The entering card may not yet be in myState (stale closure), so we include it explicitly
                // when checking watchers, but exclude it from self-ETB counter checks.
                // For ETB/landfall: existing cards are watchers, the entering card is checked separately
                const watcherBF = (event === 'etb' || event === 'landfall') && eventCard
                    ? allBF.filter(c => c.instanceId !== eventCard.instanceId)
                    : allBF;
                const collected = [];

                // 1. Check existing cards for watcher-style ETB triggers (Impact Tremors, Soul Warden etc.)
                for (const bfCard of watcherBF) {
                    for (const trigger of parseTriggers(bfCard)) {
                        if (trigger.event !== event) continue;
                        if (trigger.effect === 'notify') { addToast(`⚠️ ${trigger.source}: ${trigger.text}`, 'yellow'); continue; }
                        collected.push({ ...trigger, sourceCard: bfCard, sourceInstanceId: bfCard.instanceId });
                    }
                }

                // 2. Check the entering/triggering card's own "when this enters/dies" self-triggers
                if (eventCard) {
                    for (const trigger of parseTriggers(eventCard)) {
                        if (trigger.event !== event) continue;
                        if (trigger.effect === 'add_counter') {
                            // Self-ETB counter — apply immediately without stack
                            ['battlefieldLower','battlefieldUpper'].forEach(z => {
                                const arr = myState[z] || [];
                                if (arr.find(c => c.instanceId === eventCard.instanceId)) {
                                    updateMyState({ [z]: arr.map(c => c.instanceId === eventCard.instanceId ? { ...c, counters: [...(c.counters||[]), { type:'+1/+1', count: trigger.amount }] } : c) });
                                }
                            });
                            continue;
                        }
                        if (trigger.effect === 'notify') { addToast(`⚠️ ${trigger.source}: ${trigger.text}`, 'yellow'); continue; }
                        collected.push({ ...trigger, sourceCard: eventCard, sourceInstanceId: eventCard.instanceId });
                    }
                }

                if (!collected.length) return;
                if (collected.length === 1) {
                    pushTriggersOntoStack(collected);
                } else {
                    setPendingTriggers(collected);
                }
            };


            // ── MANA TAP ─────────────────────────────────────────────────────────
            const tapLandForMana = (card, clickEvent) => {
                if (!isLand(card)) return;
                const result = parseManaProduction(card.oracle_text);
                // Check for self-damage on tap (Ancient Tomb, City of Brass etc.)
                const oracle = (card.oracle_text || '').toLowerCase();
                const selfDmgMatch = oracle.match(/(?:deals?|you take) (\d+) damage to you|(\d+) damage to its controller/);
                const selfDmg = selfDmgMatch ? parseInt(selfDmgMatch[1] || selfDmgMatch[2]) : 0;
                if (selfDmg > 0) {
                    updateMyState({ life: myState.life - selfDmg });
                    addToast(`💔 ${card.name} fügt dir ${selfDmg} Schaden zu`, 'red');
                }
                if (!result) {
                    addMana('C');
                    addToast(`🔶 ${card.name} → {C} (bitte prüfen)`, 'orange');
                    return;
                }
                if (result.type === 'choice') {
                    const rect = clickEvent?.currentTarget?.getBoundingClientRect?.() ||
                                 clickEvent?.target?.getBoundingClientRect?.() || { left: 200, top: 200, width: 90 };
                    setManaChoice({ card, options: result.options, pos: { x: rect.left + rect.width / 2, y: rect.top - 8 } });
                    return;
                }
                result.symbols.forEach(sym => addMana(sym));
                const str = result.symbols.map(s => `{${s}}`).join('');
                addToast(`🔷 ${card.name} → ${str}`, 'blue');
            };

            const resolveManaChoice = (sym) => {
                if (!manaChoice) return;
                addMana(sym);
                addToast(`🔷 ${manaChoice.card.name} → {${sym}}`, 'blue');
                setManaChoice(null);
            };

            // ── COMBAT ───────────────────────────────────────────────────────────
            // ── PHASEN-STEUERUNG ────────────────────────────────────────────────
            // Springt (nur vorwärts) zu `target`. Eine Transaktion auf dem Raum: liest die aktuelle Phase, damit
            // zwei schnelle Klicks nicht doppelt weiterschalten, und erledigt die Kampf-Nebenwirkungen:
            //  - Eintritt in „Angreifer“: Kampf im Modus 'attacking' anlegen (wie bisher startCombat)
            //  - Sprung zu/über Kampfende: laufenden Kampf sauber beenden (combat = null)
            //  - „Schaden“ ohne offene Prioritäten (z. B. Verteidiger hat den Tisch verlassen): 'resolving'
            // Die Haltebitte („Moment!“) wird bei jedem Schrittwechsel aufgehoben.
            const goToStep = (target) => runTx(async (tx) => {
                const snap = await tx.get(roomRef);
                if (!snap.exists()) return false;
                const r = snap.data();
                const ph = r.phase && r.phase.player === r.activePlayer && PHASE_STEPS.includes(r.phase.step) ? r.phase : { step: 'main1', turn: r.phase?.turn || 0, player: r.activePlayer };
                if (stepIdx(target) <= stepIdx(ph.step)) return false;
                const upd = { phase: { ...ph, step: target, at: Date.now() }, hold: null };
                const ti = stepIdx(target);
                if (ti >= stepIdx('combat_end') || ti < stepIdx('combat_begin')) {
                    if (r.combat) upd.combat = null;
                } else if (target === 'combat_attack') {
                    if (!r.combat) upd.combat = { phase: 'attacking', attackerId: r.activePlayer, attackers: [], blockerMap: {}, priorities: {} };
                } else if (target === 'combat_damage' && r.combat?.phase === 'blocking') {
                    upd.combat = { ...r.combat, phase: 'resolving' };
                }
                tx.update(roomRef, upd);
                return upd;
            }).catch(err => { addToast(`❌ Phase konnte nicht gewechselt werden: ${err.message}`, 'red'); return false; });

            const startCombat = () => {
                setPendingAttackers([]);
                setPendingBlocker(null);
                goToStep('combat_attack').then(ok => ok && addToast('⚔️ Kampf – Kreaturen anklicken, dann Ziel wählen', 'red'));
            };

            // Firestore rejects any field with value `undefined` — this recursively strips them out.
            const sanitize = (obj) => {
                if (Array.isArray(obj)) return obj.map(sanitize);
                if (obj && typeof obj === 'object') {
                    return Object.fromEntries(
                        Object.entries(obj)
                            .filter(([, v]) => v !== undefined)
                            .map(([k, v]) => [k, sanitize(v)])
                    );
                }
                return obj;
            };

            const declareAttackers = (attackers) => {
                if (!attackers.length) return;
                const newBF = (myState.battlefieldLower || []).map(c => {
                    const atk = attackers.find(a => a.card.instanceId === c.instanceId);
                    return atk && !c.oracle_text?.toLowerCase().includes('vigilance') ? { ...c, isTapped: true } : c;
                });
                updateMyState({ battlefieldLower: newBF });
                const serialized = attackers.map(a => {
                    // effektive Werte inkl. +1/+1-/-1/-1-Marker (beim Schaden wird zusätzlich der aktuelle Stand gelesen)
                    const [p, t] = effectivePT(a.card);
                    return sanitize({
                        instanceId: a.card.instanceId,
                        name: a.card.name || '',
                        p_t: p || t || a.card.p_t ? `${p}/${t}` : null,
                        power: String(p),
                        toughness: String(t),
                        image_url: a.card.image_url || '',
                        oracle_text: a.card.oracle_text || null,
                        targetPlayerId: a.targetPlayerId || null
                    });
                });
                const priorities = {};
                opponentIds.forEach(id => { priorities[id] = 'pending'; });
                const newCombat = sanitize({ phase: 'blocking', attackerId: user.uid, attackers: serialized, blockerMap: {}, priorities });
                // Transaction guarantees atomic read-then-write — plain updateDoc can silently fail
                // Zugleich Phase → „Blocker“ (Haltebitte aufheben).
                runTx(async (tx) => {
                    const snap = await tx.get(roomRef);
                    if (!snap.exists()) throw new Error('Room not found');
                    const r = snap.data();
                    const ph = r.phase && r.phase.player === r.activePlayer && PHASE_STEPS.includes(r.phase.step) ? r.phase : { step: 'main1', turn: r.phase?.turn || 0, player: r.activePlayer };
                    tx.update(roomRef, { combat: newCombat, phase: { ...ph, step: 'combat_block', at: Date.now() }, hold: null });
                })
                .then(() => {
                    addToast('⚔️ Angreifer erklärt – Gegner kann blocken', 'red');
                    const byTarget = {};
                    attackers.forEach(a => { const t = a.targetPlayerId || ''; (byTarget[t] = byTarget[t] || []).push(a.card); });
                    Object.entries(byTarget).forEach(([t, cards]) => {
                        const tn = !t ? '' : t.startsWith('pw_') ? ` → ${cardName(findOnBattlefield(t.split('_')[1])?.card) || 'Planeswalker'}` : ` → ${getPlayerName(t)}`;
                        logEvent(`greift an${tn}: ${cards.map(cardName).join(', ')}`, cards);
                    });
                })
                .catch(err => addToast(`❌ Angriff fehlgeschlagen: ${err.message}`, 'red'));
                setPendingAttackers([]);
            };

            // Verteidiger bestätigt seine Blocker. Als Transaktion auf dem frischen Raum (gleichzeitiges Passen mehrerer
            // Verteidiger überschreibt sich nicht). Hat damit jeder anwesende Verteidiger gepasst, geht es im selben
            // Schreibvorgang direkt in den Schadensschritt – der Angreifer muss nicht mehr „Weiter“ klicken.
            const passPriority = () => {
                if (!lobbyState?.combat) { addToast('Kein Kampf aktiv', 'yellow'); return; }
                runTx(async (tx) => {
                    const snap = await tx.get(roomRef);
                    if (!snap.exists()) return null;
                    const r = snap.data();
                    const current = r.combat;
                    if (!current || current.phase !== 'blocking') return null;
                    const priorities = sanitize({ ...(current.priorities || {}), [user.uid]: 'passed' });
                    // Wer den Tisch verlassen hat, gilt als „gepasst“
                    const holders = Object.keys(priorities);
                    const allPassed = holders.length > 0 && holders.every(id => priorities[id] === 'passed' || !(r.players || []).includes(id));
                    const upd = { combat: sanitize({ ...current, priorities, phase: allPassed ? 'resolving' : 'blocking' }) };
                    const ph = r.phase;
                    if (allPassed && ph && ph.player === r.activePlayer && ph.step === 'combat_block') { upd.phase = { ...ph, step: 'combat_damage', at: Date.now() }; upd.hold = null; }
                    tx.update(roomRef, upd);
                    return allPassed ? 'all' : 'one';
                })
                    .then((res) => { if (res === 'all') addToast('⚔️ Alle haben gepasst – Angreifer verteilt den Schaden', 'yellow'); else if (res === 'one') addToast('Priorität abgegeben ✓', 'blue'); })
                    .catch(err => addToast(`❌ Priorität fehlgeschlagen: ${err.message}`, 'red'));
            };

            const declareBlockers = (newBlockerEntries) => {
                const current = lobbyState?.combat;
                if (!current) return;
                const blockerMap = sanitize({ ...(current.blockerMap || {}), ...newBlockerEntries });
                updateDoc(roomRef, { combat: sanitize({ ...current, blockerMap }) });
                addToast('🛡️ Blocker erklärt', 'yellow');
            };

            const resolveCombat = (damageAssign = {}, firstStrikeOnly = false) => {
                const combat = lobbyState?.combat;
                if (!combat) return;
                isResolvingCombatRef.current = true; // block auto-snap during resolution
                let myDmg = 0;
                const oppDamage = {};
                const myDeadIds = new Set(); // my creatures that die
                const oppDeadIds = {}; // oppId → Set of instanceIds

                const pwDamage = {}; // "pw_<instanceId>_<oppId>" → dmg
                let myLifeGained = 0; // from lifelink
                // Erstschlag (Regel 510.4): Gibt es Erst-/Doppelschlag im Kampf, teilen im Erstschlag-Schritt nur
                // Kreaturen mit Erst-/Doppelschlag Schaden aus, im normalen Schritt nur die ohne Erstschlag plus
                // Doppelschlag. Im Erstschlag-Schritt gestorbene Kreaturen teilen danach keinen Schaden mehr aus.
                // Stärke/Widerstand zum Zeitpunkt des Schadens: Karte auf dem Spielfeld ihres Beherrschers (mit Markern),
                // sonst die beim Erklären gespeicherten Werte
                const livePT = (c, ownerId) => {
                    const st = ownerId === user.uid ? myState : opponentStates[ownerId];
                    const live = [...(st?.battlefieldLower || []), ...(st?.battlefieldUpper || [])].find(x => x.instanceId === c.instanceId);
                    return live && hasPTData(live) ? effectivePT(live) : getPT(c);
                };
                const anyFS = (combat.attackers||[]).some(a => hasFirstStrike(a)) || Object.values(combat.blockerMap||{}).some(b => hasFirstStrike(b));
                const dealsNow = (c) => !anyFS || (firstStrikeOnly ? hasFirstStrike(c) : (!hasFirstStrike(c) || hasDoubleStrike(c)));
                const myFieldIds = new Set([...(myState.battlefieldLower||[]), ...(myState.battlefieldUpper||[])].map(c => c.instanceId));
                const stillThere = (c, ownerId) => {
                    if (!anyFS || firstStrikeOnly) return true;
                    if (ownerId === user.uid) return myFieldIds.has(c.instanceId);
                    const os = opponentStates[ownerId];
                    return !os || [...(os.battlefieldLower||[]), ...(os.battlefieldUpper||[])].some(x => x.instanceId === c.instanceId);
                };
                const attackersThisStep = (combat.attackers||[]).filter(atk => {
                    if (!stillThere(atk, combat.attackerId)) return false;
                    if (!firstStrikeOnly) return true;
                    // First strike step: only attackers WITH first/double strike deal damage
                    const blocker = combat.blockerMap?.[atk.instanceId];
                    return hasFirstStrike(atk) || (blocker && hasFirstStrike(blocker));
                });
                attackersThisStep.forEach(atk => {
                    const [atkP, atkT] = livePT(atk, combat.attackerId);
                    const blocker = combat.blockerMap?.[atk.instanceId];
                    const deathtouch = kw(atk, 'deathtouch');
                    const trample = kw(atk, 'trample');
                    const indestructible = kw(atk, 'indestructible');
                    const lifelink = kw(atk, 'lifelink');
                    const target = atk.targetPlayerId;
                    const isPWTarget = target?.startsWith('pw_');
                    const atkDeals = dealsNow(atk);
                    const blockerAlive = !!blocker && stillThere(blocker, blocker.blockerOwnerId);
                    // In first-strike step: blocker only deals damage if IT has first strike
                    const blockerDealsDmgThisStep = blockerAlive && dealsNow(blocker);
                    const applyDmgToTarget = (dmg) => {
                        if (!dmg || dmg <= 0) return;
                        if (lifelink) myLifeGained += dmg;
                        if (isPWTarget) {
                            pwDamage[target] = (pwDamage[target]||0) + dmg;
                        } else if (target && target !== user.uid) {
                            oppDamage[target] = (oppDamage[target]||0) + dmg;
                        } else if (target === user.uid) {
                            myDmg += dmg;
                        } else {
                            opponentIds.forEach(id => { oppDamage[id] = (oppDamage[id]||0) + dmg; });
                        }
                    };

                    if (blocker) {
                        const [blkP, blkT] = livePT(blocker, blocker.blockerOwnerId);
                        const blkIndestructible = blocker.oracle_text?.toLowerCase().includes('indestructible');
                        const assignedToBlocker = !atkDeals || !blockerAlive ? 0 : ((damageAssign[atk.instanceId]?.[blocker.instanceId]) ?? atkP);

                        // Phyrexian Vindicator: damage to it is prevented and redirected
                        // "If damage would be dealt to this creature, prevent that damage.
                        //  When damage is prevented this way, deals that much damage to any other target."
                        const vindicatorText = 'if damage would be dealt to this creature, prevent that damage';
                        const atkIsVindicator = atk.oracle_text?.toLowerCase().includes(vindicatorText);
                        const blkIsVindicator = blocker.oracle_text?.toLowerCase().includes(vindicatorText);

                        // Effective damage to blocker (considering Vindicator on attacker side)
                        const dmgToBlocker = atkIsVindicator ? 0 : assignedToBlocker; // attacker prevents damage to itself, but blocker still hits it
                        // Effective damage to attacker
                        const dmgToAttacker = blkIsVindicator ? 0 : blkP; // if blocker is vindicator, its damage goes elsewhere

                        if (atkIsVindicator && assignedToBlocker > 0) {
                            addToast(`🔄 ${atk.name} lenkt ${assignedToBlocker} Schaden um – neues Ziel bitte selbst wählen`, 'purple');
                        }
                        if (blkIsVindicator && blkP > 0) {
                            addToast(`🔄 ${blocker.name} lenkt ${blkP} Schaden um – neues Ziel bitte selbst wählen`, 'purple');
                        }

                        // Does blocker die?
                        const blockerLethal = blockerAlive && (deathtouch ? dmgToBlocker >= 1 : dmgToBlocker >= blkT);
                        if (blockerLethal && !blkIndestructible) {
                            const blockerOwner = blocker.blockerOwnerId;
                            if (blockerOwner === user.uid) {
                                myDeadIds.add(blocker.instanceId);
                            } else if (blockerOwner) {
                                if (!oppDeadIds[blockerOwner]) oppDeadIds[blockerOwner] = new Set();
                                oppDeadIds[blockerOwner].add(blocker.instanceId);
                            }
                            addToast(`💀 ${blocker.name} wird zerstört`, 'red');
                        }

                        // Does attacker die? Only if blocker's effective power >= attacker's toughness
                        const attackerOnMyField = [...(myState.battlefieldLower||[]), ...(myState.battlefieldUpper||[])]
                            .some(c => c.instanceId === atk.instanceId);
                        if (blockerDealsDmgThisStep && dmgToAttacker >= atkT && atkT > 0 && !indestructible) {
                            if (combat.attackerId === user.uid && attackerOnMyField) {
                                myDeadIds.add(atk.instanceId);
                            } else if (combat.attackerId !== user.uid) {
                                if (!oppDeadIds[combat.attackerId]) oppDeadIds[combat.attackerId] = new Set();
                                oppDeadIds[combat.attackerId].add(atk.instanceId);
                            }
                            addToast(`💀 ${atk.name} wird zerstört`, 'red');
                        }

                        // Trample excess
                        if (trample && atkDeals && assignedToBlocker < atkP) {
                            const excess = atkP - assignedToBlocker;
                            applyDmgToTarget(excess);
                            addToast(`⚡ ${atk.name} trampelt ${excess} durch`, 'orange');
                        }
                    } else if (atkDeals) {
                        applyDmgToTarget(atkP);
                        addToast(`⚔️ ${atk.name} — ${atkP} ungeblockter Schaden`, 'red');
                    }
                });

                // Apply planeswalker damage — subtract loyalty counters, kill if ≤ 0
                if (Object.keys(pwDamage).length > 0) {
                    const pwDeathReqs = [];
                    Object.entries(pwDamage).forEach(([pwKey, dmg]) => {
                        // pwKey format: "pw_<instanceId>_<oppId>"
                        const parts = pwKey.split('_');
                        const pwInstanceId = parts[1];
                        const oppId = parts.slice(2).join('_');
                        // Find the PW in opponentStates to get current loyalty
                        const oppState = opponentStates[oppId];
                        if (!oppState) return;
                        const allBF = [...(oppState.battlefieldLower||[]), ...(oppState.battlefieldUpper||[])];
                        const pw = allBF.find(c => c.instanceId === pwInstanceId);
                        if (!pw) return;
                        // Loyalty is stored in counters as { type: 'Loyalität', count: N }
                        const loyaltyCounter = (pw.counters||[]).find(c => c.type === 'Loyalität');
                        const currentLoyalty = loyaltyCounter ? loyaltyCounter.count : (parseInt(pw.loyalty) || 0);
                        const newLoyalty = currentLoyalty - dmg;
                        addToast(`🌟 ${pw.name} erleidet ${dmg} Schaden → ${newLoyalty} Loyalität`, newLoyalty <= 0 ? 'red' : 'orange');
                        if (newLoyalty <= 0) {
                            // PW dies — request opponent to remove it
                            pwDeathReqs.push({ id: generateId(), targetPlayerId: oppId, instanceIds: [pwInstanceId] });
                            addToast(`💀 ${pw.name} wird zerstört`, 'red');
                        } else {
                            // Update loyalty counter on PW — post as deathRequest-style request
                            // We post a loyaltyRequest instead since we can't write oppState directly
                            pushRoomRequest('loyaltyRequests', { id: generateId(), targetPlayerId: oppId, instanceId: pwInstanceId, newLoyalty });
                        }
                    });
                    if (pwDeathReqs.length > 0) {
                        pushRoomRequest('deathRequests', pwDeathReqs);
                    }
                }

                // Apply life damage
                const myUpdates = {};
                if (myDmg > 0) {
                    myUpdates.life = myState.life - myDmg;
                    addToast(`💔 Du erleidest ${myDmg} Schaden`, 'red');
                }
                if (myLifeGained > 0) {
                    myUpdates.life = (myUpdates.life ?? myState.life) + myLifeGained;
                    addToast(`💚 Lebensverknüpfung: +${myLifeGained} Leben`, 'green');
                }
                Object.entries(oppDamage).forEach(([oppId, dmg]) => {
                    if (dmg <= 0) return;
                    addToast(`⚔️ ${getPlayerName(oppId)} erleidet ${dmg} Schaden`, 'red');
                });
                // Post damage requests — Security Rules prevent writing to opponent game_state directly.
                // Their client reads these and applies the life loss themselves.
                const dmgReqsToAdd = Object.entries(oppDamage)
                    .filter(([, dmg]) => dmg > 0)
                    .map(([oppId, dmg]) => ({ id: generateId(), targetPlayerId: oppId, amount: dmg }));
                if (dmgReqsToAdd.length > 0) {
                    pushRoomRequest('damageRequests', dmgReqsToAdd);
                }

                // Move my dead creatures + apply life changes in ONE transaction
                if (myDeadIds.size > 0 || Object.keys(myUpdates).length > 0) {
                    runTx(async (tx) => {
                        const snap = await tx.get(myStateRef);
                        if (!snap.exists()) return;
                        const data = snap.data();
                        const bfLower = data.battlefieldLower || [];
                        const bfUpper = data.battlefieldUpper || [];
                        const allDead = [
                            ...bfLower.filter(c => myDeadIds.has(c.instanceId)),
                            ...bfUpper.filter(c => myDeadIds.has(c.instanceId)),
                        ];
                        const cmdDead = allDead.filter(c => c.isCommander && !foreignOwner(c));
                        const foreignDead = allDead.filter(c => !c.isToken && foreignOwner(c));
                        const deadCards = allDead.filter(c => !c.isToken && !c.isCommander && !foreignOwner(c));
                        const shedGy = [], shedEquip = [], shedFalls = [];
                        allDead.forEach(c => { const r = shedAttachments(c, false); shedGy.push(...r.ownGy); shedEquip.push(...r.looseEquip); shedFalls.push(...r.falls); });
                        const enduringCards = deadCards.filter(hasEnduringAbility);
                        const undyingCards = deadCards.filter(c => !hasEnduringAbility(c) && hasUndying(c) && !(c.counters||[]).some(x => x.type==='+1/+1'));
                        const persistCards = deadCards.filter(c => !hasEnduringAbility(c) && !hasUndying(c) && hasPersist(c) && !(c.counters||[]).some(x => x.type==='-1/-1'));
                        const normalDead = deadCards.filter(c => !hasEnduringAbility(c) && !undyingCards.includes(c) && !persistCards.includes(c));
                        const returned = [
                            ...enduringCards.map(c => ({ ...c, isTapped:false, type_line: c.type_line?.replace(/Enchantment Creature/i,'Enchantment').replace(/\bCreature\b/i,'').trim()||'Enchantment', x:50, y:50 })),
                            ...undyingCards.map(c => ({ ...c, isTapped:false, counters:[...(c.counters||[]).filter(x=>x.type!=='+1/+1'), {type:'+1/+1',count:1}], x:50, y:50 })),
                            ...persistCards.map(c => ({ ...c, isTapped:false, counters:[...(c.counters||[]).filter(x=>x.type!=='-1/-1'), {type:'-1/-1',count:1}], x:50, y:50 })),
                        ];
                        tx.update(myStateRef, {
                            battlefieldLower: [...bfLower.filter(c => !myDeadIds.has(c.instanceId)), ...returned, ...shedEquip],
                            battlefieldUpper: bfUpper.filter(c => !myDeadIds.has(c.instanceId)),
                            graveyard: [...normalDead.map(cleanLeaving), ...cmdDead.map(cleanLeaving), ...shedGy, ...(data.graveyard || [])],
                            ...(cmdDead.length ? { cmdPending: [...(data.cmdPending || []), ...cmdDead.map(c => ({ instanceId: c.instanceId, name: cardName(c), zone: 'graveyard' }))] } : {}),
                            ...myUpdates
                        });
                        return { normalDead, enduringCards, undyingCards, persistCards, foreignDead, shedFalls };
                    }).then(result => {
                        (result?.shedFalls || []).forEach(f => pushRoomRequest('auraFallRequests', f));
                        (result?.foreignDead || []).forEach(c => returnToOwner(c, 'graveyard'));
                        if (result?.normalDead?.length) {
                            addToast(`💀 ${result.normalDead.map(c => c.name).join(', ')} → Friedhof`, 'red');
                            result.normalDead.forEach(dead => { fireTriggers('dies', dead); fireTriggers('creature_dies', dead); });
                        }
                        if (result?.undyingCards?.length) addToast(`♻️ ${result.undyingCards.map(c=>c.name).join(', ')} kehrt zurück (Unsterblichkeit, +1/+1)`, 'blue');
                        if (result?.persistCards?.length) addToast(`♻️ ${result.persistCards.map(c=>c.name).join(', ')} kehrt zurück (Beharrlichkeit, -1/-1)`, 'purple');
                        if (result?.enduringCards?.length) addToast(`♾️ ${result.enduringCards.map(c => c.name).join(', ')} kehrt als Verzauberung zurück`, 'purple');
                        isResolvingCombatRef.current = false;
                        setTimeout(snapAllCardsToZones, 300);
                    }).catch(err => {
                        isResolvingCombatRef.current = false;
                        addToast(`Fehler im Kampf: ${err.message}`, 'yellow');
                    });
                } else {
                    isResolvingCombatRef.current = false;
                }

                // Move opponent dead creatures to their graveyard — use a transaction so we read
                // the freshest state and don't overwrite concurrent changes.
                // Post deathRequests for opponent creatures — we can't write their game_state directly.
                // Their client's useEffect picks this up and applies it to their own state.
                const pendingDeathReqs = Object.entries(oppDeadIds)
                    .filter(([, deadSet]) => deadSet.size > 0)
                    .map(([oppId, deadSet]) => ({ id: generateId(), targetPlayerId: oppId, instanceIds: [...deadSet] }));
                if (pendingDeathReqs.length > 0) {
                    pushRoomRequest('deathRequests', pendingDeathReqs);
                }

                {
                    const parts = [];
                    Object.entries(oppDamage).forEach(([oppId, dmg]) => { if (dmg > 0) parts.push(`${getPlayerName(oppId)} erleidet ${dmg}`); });
                    if (myDmg > 0) parts.push(`${getPlayerName(user.uid)} erleidet ${myDmg}`);
                    if (myLifeGained > 0) parts.push(`+${myLifeGained} Leben (Lebensverknüpfung)`);
                    const allField = [...(myState.battlefieldLower || []), ...(myState.battlefieldUpper || []), ...opponentIds.flatMap(id => [...(opponentStates[id]?.battlefieldLower || []), ...(opponentStates[id]?.battlefieldUpper || [])])];
                    const deadIds = new Set([...myDeadIds, ...Object.values(oppDeadIds).flatMap(x => [...x])]);
                    const dead = allField.filter(c => deadIds.has(c.instanceId));
                    if (dead.length) parts.push(`stirbt: ${dead.map(cardName).join(', ')}`);
                    logEvent(`Kampfschaden${firstStrikeOnly ? ' (Erstschlag)' : ''}: ${parts.length ? parts.join(' · ') : 'kein Schaden'}`, dead);
                }
                if (!firstStrikeOnly) {
                    finishCombat();
                    addToast('✅ Kampf abgeschlossen', 'green');
                } else {
                    addToast('⚡ Erstschlag erledigt – jetzt normalen Schaden verteilen', 'yellow');
                }
            };

            // Kampf beenden (Schaden aufgelöst, „Abbrechen“, „Kampf beenden“): combat = null und – falls die Phase
            // noch in einem Kampfschritt davor steht – weiter zu „Kampfende“.
            const finishCombat = () => runTx(async (tx) => {
                const snap = await tx.get(roomRef);
                if (!snap.exists()) return;
                const r = snap.data();
                const upd = { combat: null };
                const ph = r.phase;
                if (ph && ph.player === r.activePlayer && isCombatStep(ph.step) && stepIdx(ph.step) < stepIdx('combat_end')) {
                    upd.phase = { ...ph, step: 'combat_end', at: Date.now() };
                    upd.hold = null;
                }
                tx.update(roomRef, upd);
            }).catch(err => addToast(`❌ Kampf konnte nicht beendet werden: ${err.message}`, 'red'));
            const endCombat = () => { finishCombat(); setPendingAttackers([]); setPendingBlocker(null); };

            const assignBlock = (blockerCard, attackerCard) => {
                const current = lobbyState?.combat;
                if (!current) return;
                const [bp, bt] = effectivePT(blockerCard);
                const entry = sanitize({
                    instanceId: blockerCard.instanceId, name: blockerCard.name,
                    p_t: bp || bt || blockerCard.p_t ? `${bp}/${bt}` : null,
                    power: String(bp),
                    toughness: String(bt),
                    oracle_text: blockerCard.oracle_text || null,
                    image_url: blockerCard.image_url || null,
                    blockerOwnerId: user.uid
                });
                const blockerMap = sanitize({ ...(current.blockerMap || {}), [attackerCard.instanceId]: entry });
                updateDoc(roomRef, { combat: sanitize({ ...current, blockerMap }) });
                setPendingBlocker(null);
                addToast(`🛡️ ${blockerCard.name} blockt ${attackerCard.name}`, 'yellow');
            };

            const generateCardOptions = (card, zone) => {
                const keywords = ['Flying', 'Trampelschaden', 'Todesberührung', 'Lifelink', 'Haste', 'Vigilance', 'First Strike', 'Double Strike', 'Indestructible', 'Hexproof', 'Menace'];
                const numericCounters = ['+1/+1', '-1/-1', 'Gift', 'Energie', 'Ladung', 'Loyalität'];
                const allCounterTypes = [...keywords, ...numericCounters];

                const numericCounterTypes = ['+1/+1', '-1/-1', 'Gift', 'Energie', 'Ladung', 'Loyalität'];

                const placeCounterSubmenu = allCounterTypes.map(type => ({
                    label: type,
                    // Keyword counters: always add exactly 1 (they're boolean — you either have the counter or not).
                    // Numeric counters: _amountAction is set so the menu can show the amount picker first.
                    action: () => addCounterToCard(card, zone, type, 1),
                    ...(numericCounterTypes.includes(type) ? {
                        _amountAction: (n) => addCounterToCard(card, zone, type, n),
                        _mode: 'add'
                    } : {})
                }));

                const hasCounters = card.counters && card.counters.length > 0;
                const removeCounterSubmenu = hasCounters
                    ? card.counters.map(c => ({
                        label: `${c.type} (${c.count})`,
                        action: () => addCounterToCard(card, zone, c.type, -1),
                        ...(numericCounterTypes.includes(c.type) ? {
                            _amountAction: (n) => addCounterToCard(card, zone, c.type, -n),
                            _mode: 'remove'
                        } : {})
                    }))
                    : [];

                const parsedTokens = parseTokensFromOracleText(card);
                const canMakeTokens = cardCreatesTokensDirectly(card);

                // Builds "Player 1", "Player 2", ... entries (using each seat's actual display name) for a
                // given token spec, so the caster can send the token to whichever player the card's effect
                // actually targets (e.g. "its controller", an opponent who was gifted something, etc.)
                // instead of it always landing on their own battlefield.
                const buildPlayerChoiceSubmenu = (tokenSpec) => {
                    const seats = allPlayersSeated.length > 0 ? allPlayersSeated : [user.uid, ...opponentIds];
                    return seats.map((uid, i) => ({
                        label: uid === user.uid ? `Spieler ${i + 1} (du)` : `Spieler ${i + 1} – ${getPlayerName(uid)}`,
                        action: () => requestTokenForPlayer(uid, tokenSpec)
                    }));
                };

                const tokenSubmenu = parsedTokens.length > 0
                    ? [
                        ...parsedTokens.map(t => ({
                            label: t.stats 
                                ? `${t.quantity > 1 ? t.quantity + 'x ' : ''}${t.stats} ${t.name}${t.ability ? ` (${t.ability})` : ''}`
                                : `${t.quantity > 1 ? t.quantity + 'x ' : ''}${t.name} Token`,
                            submenu: buildPlayerChoiceSubmenu({ name: t.name, stats: t.stats, quantity: t.quantity, colors: t.colors, ability: t.ability, isAura: t.isAura, isRole: t.isRole })
                        })),
                        { label: '--- Weitere ---', action: () => {} },
                        { label: 'Eigener Token …', action: () => setTokenModalOpen(true) }
                    ]
                    : [
                        { label: 'Eigener Token …', action: () => setTokenModalOpen(true) }
                    ];

                let options = [];
                if (zone !== 'stack') {
                    options.push({ label: 'Marker legen', submenu: placeCounterSubmenu });
                    if (hasCounters) {
                        options.push({ label: 'Marker entfernen', submenu: removeCounterSubmenu });
                    }
                }
                if (canMakeTokens) {
                    options.push({ label: 'Token erstellen', submenu: tokenSubmenu });
                }

                // Fetch land ability — only show when the card is on MY battlefield and has a parseable fetch ability
                if ((zone === 'battlefieldLower' || zone === 'battlefieldUpper') && isLand(card)) {
                    const fetchAbility = parseFetchAbility(card.oracle_text);
                    if (fetchAbility) {
                        const label = fetchAbility.type === 'basic' || fetchAbility.type === 'basic_pair'
                            ? `🔍 Standardland suchen${fetchAbility.count > 1 ? ' (2)' : ''}`
                            : fetchAbility.type === 'specific_two'
                            ? `🔍 ${fetchAbility.subtypes.join(' + ')} suchen`
                            : fetchAbility.type === 'subtype_or'
                            ? `🔍 ${fetchAbility.subtypes.join(' oder ')} suchen`
                            : '🔍 Fetch Land';
                        options.push({ label, action: () => activateFetch(card, zone) });
                    }
                }

                // Crew option — only for Vehicles owned by me on the battlefield
                if ((zone === 'battlefieldLower' || zone === 'battlefieldUpper') && /\bVehicle\b/i.test(card.type_line||'')) {
                    const crewCost = parseCrew(card.oracle_text);
                    if (crewCost !== null) {
                        const label = card.isCrewed ? `🚗 Schon bemannt (Bemannen ${crewCost})` : `🚗 Bemannen ${crewCost}`;
                        options.push({ label, action: () => !card.isCrewed && activateCrew(card, zone), disabled: card.isCrewed });
                    }
                }
                const isCreature = zone !== 'stack' && (/\bCreature\b/i.test(card.type_line || '') || (card.isToken && card.p_t));
                const ringEmblem = myEmblems.find(e => e.name === 'The Ring');
                if (isCreature && ringEmblem) {
                    const isCurrentBearer = ringEmblem.ringBearerInstanceId === card.instanceId;
                    options.push({
                        label: isCurrentBearer ? 'Ringträger (aktuell)' : 'Zum Ringträger machen',
                        disabled: isCurrentBearer,
                        action: () => setRingBearer(ringEmblem.instanceId, card.instanceId)
                    });
                }

                // Return to Hand — available from battlefield and graveyard
                const isOnBattlefield = zone === 'battlefieldLower' || zone === 'battlefieldUpper';
                const isInGraveyard = zone === 'graveyard';
                if (isOnBattlefield && !cardMenu?.isAttachment) {
                    options.push({ label: card.isTapped ? '⤴ Enttappen' : '⤵ Tappen', action: () => toggleTap(card.instanceId, zone) });
                    if (hasFaces(card)) options.push({ label: '🔄 Umdrehen', action: () => flipCard(card, zone) });
                    if (isAuraCard(card)) options.push({ label: '✨ An Karte anlegen', action: () => startAuraTargeting({ aura: card, source: 'bf', fromZone: zone }) });
                }
                if ((isOnBattlefield && !cardMenu?.isAttachment) || isInGraveyard) {
                    options.push({ label: '↩ Auf die Hand', action: () => moveCardToZone(card, 'hand') });
                }
                if (isOnBattlefield && !cardMenu?.isAttachment) {
                    options.push({ label: '💀 In den Friedhof', action: () => moveCardToZone(card, 'graveyard') });
                    options.push({ label: '🚫 Ins Exil', action: () => moveCardToZone(card, 'exile') });
                }

                return options;
            };

            // Transformierende Karte umdrehen (Vorder-/Rückseite); beim Verlassen des Spielfelds wieder Vorderseite
            const flipCard = (card, zone) => {
                if (!hasFaces(card)) return;
                const idx = card.faceIndex === 1 ? 0 : 1;
                const flipped = withFace(card, idx);
                updateMyState({ [zone]: (myState[zone] || []).map(c => c.instanceId === card.instanceId ? { ...flipped, isTapped: c.isTapped, x: c.x, y: c.y, counters: c.counters || [], attachments: c.attachments } : c) });
                logEvent(`dreht ${cardName(card)} um → ${cardName(flipped)}`, [card, flipped]);
                setHoveredCard(null);
            };

            const moveCardToZone = (card, toZone) => {
                const filter = c => c.instanceId !== card.instanceId;
                const has = (arr) => (arr || []).some(c => c.instanceId === card.instanceId);
                const fromZone = has(myState.battlefieldLower) || has(myState.battlefieldUpper) ? 'battlefield'
                    : has(myState.hand) ? 'hand' : has(myState.graveyard) ? 'graveyard' : has(myState.exile) ? 'exile'
                    : has(myState.commandZone) ? 'command' : has(myState.library) ? 'library' : null;
                let updates = {
                    battlefieldUpper: (myState.battlefieldUpper || []).filter(filter),
                    battlefieldLower: (myState.battlefieldLower || []).filter(filter),
                    hand: myState.hand.filter(filter),
                    graveyard: myState.graveyard.filter(filter),
                    exile: myState.exile.filter(filter),
                    commandZone: myState.commandZone.filter(filter),
                    library: myState.library.filter(filter)
                };

                // Attachment lifecycle: a card leaving the battlefield (to anywhere) sheds its attachments.
                // Auras go to THEIR OWNER's graveyard (rule 704.5n) - possibly a different player than whoever
                // controlled the host creature, handled via the same cross-player request queue as gifting a
                // token. Equipment simply unattaches and stays loose on MY OWN battlefield (rule 704.5q).
                const wasOnBattlefield = fromZone === 'battlefield';
                const leavingBattlefield = wasOnBattlefield && toZone !== 'battlefieldUpper' && toZone !== 'battlefieldLower';
                const original = card;
                if (leavingBattlefield) {
                    const { ownGy, looseEquip } = shedAttachments(card);
                    if (ownGy.length) updates.graveyard = [...ownGy, ...updates.graveyard];
                    if (looseEquip.length) updates.battlefieldLower = [...updates.battlefieldLower, ...looseEquip];
                    // Counters are removed when a card leaves the battlefield (rule 704.5), Loyalität bleibt;
                    // doppelseitige Karten zeigen wieder die Vorderseite.
                    card = cleanLeaving(card);
                }

                const n = cardName(card);
                const nBf = cardName(original); // Name der Seite, die auf dem Spielfeld lag
                const tokenGone = card.isToken && leavingBattlefield;
                const toForeign = foreignOwner(card) && ['graveyard', 'exile', 'hand', 'library_top', 'library_bottom', 'command'].includes(toZone);
                // Commander (Regel 903.9): erst in die Zielzone, dann fragt das Fenster „Commander-Zone oder …?“
                const cmdAsk = card.isCommander && !toForeign && CMD_ASK_ZONES[toZone] && fromZone !== toZone && !(fromZone === 'library' && toZone.startsWith('library'));
                if (cmdAsk) updates.cmdPending = [...(myState.cmdPending || []).filter(p => p.instanceId !== card.instanceId), { instanceId: card.instanceId, name: cardName(card), zone: CMD_ASK_ZONES[toZone] }];
                if (tokenGone) { addToast(`✨ Token ${card.name} verschwindet`, 'blue'); }
                else if (toForeign) { returnToOwner(card, toZone); }
                else if (toZone === 'graveyard') updates.graveyard = [card, ...updates.graveyard];
                else if (toZone === 'exile') updates.exile = [card, ...updates.exile];
                else if (toZone === 'hand') updates.hand = [...updates.hand, card];
                else if (toZone === 'command') updates.commandZone = [card, ...updates.commandZone];
                else if (toZone === 'library_top') updates.library = [card, ...updates.library];
                else if (toZone === 'library_bottom') updates.library = [...updates.library, card];

                updateMyState(updates);

                // Protokoll (öffentliche Zonen mit Namen; Hand/Bibliothek ohne Namen)
                const dest = toZone;
                const destLabel = ZONE_LABEL[dest] || dest;
                const ownerNote = toForeign ? ` (an ${getPlayerName(original.ownerId)})` : '';
                if (fromZone === 'battlefield') {
                    if (tokenGone) logEvent(`Token ${n} verlässt das Spielfeld`);
                    else if (toZone === 'graveyard' && isCreatureLike(original)) logEvent(`${nBf} stirbt${ownerNote}`, [original]);
                    else logEvent(`${nBf} → ${destLabel}${ownerNote}`, [original]);
                } else if (fromZone === 'graveyard' || fromZone === 'exile') {
                    logEvent(`${n}: ${ZONE_LABEL[fromZone]} → ${destLabel}${ownerNote}`, [card]);
                } else if (fromZone === 'hand') {
                    if (toZone === 'graveyard') logEvent(`wirft ${n} ab`, [card]);
                    else if (toZone === 'exile' || toZone === 'command') logEvent(`${n}: Hand → ${destLabel}`, [card]);
                    else if (toZone.startsWith('library')) logEvent(`legt eine Handkarte in die ${destLabel}`);
                } else if (fromZone === 'library') {
                    if (toZone === 'graveyard' || toZone === 'exile') logEvent(`${n}: Bibliothek → ${destLabel}`, [card]);
                    else if (toZone === 'library_bottom') logEvent('legt die oberste Karte unter die Bibliothek');
                    else if (toZone === 'hand') logEvent('nimmt eine Karte aus der Bibliothek auf die Hand');
                } else if (fromZone === 'command' && toZone !== 'command') {
                    logEvent(`${n}: Commander-Zone → ${destLabel}`, [card]);
                }

                // Fire dies triggers when a creature goes to GY from battlefield
                if (toZone === 'graveyard' && wasOnBattlefield && isCreatureLike(frontFace(card))) {
                    setTimeout(() => {
                        fireTriggers('dies', card);
                        fireTriggers('creature_dies', card);
                    }, 50);
                }
            };

            // ── COMMANDER: Commander-Zone oder Zielzone? (Regel 903.9a/b) ─────────────
            // Jeder Weg (Kampf, Anfragen, Kontextmenü, Ziehen, Stack) legt den Commander zuerst in die Zielzone und
            // vermerkt ihn in myState.cmdPending; das Fenster fragt den Besitzer. Übersteht Neuladen.
            const cmdPendingShown = (myState.cmdPending || []).filter(p => (myState[p.zone] || []).some(c => c.instanceId === p.instanceId));
            const resolveCmdChoice = (entry, toCommand) => runTx(async (tx) => {
                const snap = await tx.get(myStateRef);
                if (!snap.exists()) return null;
                const d = snap.data();
                const arr = d[entry.zone] || [];
                const card = arr.find(c => c.instanceId === entry.instanceId);
                // erledigte und veraltete Einträge (Karte nicht mehr in der Zone) entfernen
                const upd = { cmdPending: (d.cmdPending || []).filter(p => p.instanceId !== entry.instanceId && (d[p.zone] || []).some(c => c.instanceId === p.instanceId)) };
                if (toCommand && card) {
                    upd[entry.zone] = arr.filter(c => c.instanceId !== entry.instanceId);
                    upd.commandZone = [{ ...cleanLeaving(card), counters: [] }, ...(d.commandZone || []).filter(c => c.instanceId !== card.instanceId)];
                }
                tx.update(myStateRef, upd);
                return card ? (toCommand ? 'cmd' : 'stay') : null;
            }).then(r => {
                if (r === 'cmd') { logEvent(`${entry.name}: ${CMD_ZONE_LABEL[entry.zone]} → Commander-Zone (Commander-Regel)`); addToast(`👑 ${entry.name} → Commander-Zone`, 'blue'); }
                if (r === 'stay') logEvent(`${entry.name} bleibt ${CMD_ZONE_IN[entry.zone]} (statt Commander-Zone)`);
            }).catch(err => addToast(`❌ ${err.message}`, 'red'));

            // Direkt aufs Spielfeld (ohne Stack) aus Friedhof/Exil/Bibliothek – Reihe nach Kartentyp, Länder mit ETB-Logik,
            // Auren mit Zielwahl
            const putOntoBattlefield = (card, fromZone) => playCard(card, fromZone, 'lower');
            // Zauber aus einer Zone wirken (Rückblende, Flucht …): Länder werden gespielt, alles andere auf den Stack
            const playFromZone = (card, fromZone) => { if (isLand(frontFace(card))) enterLand(card, fromZone); else castToStack(card, fromZone); };

            // Reanimieren aus dem Friedhof/Exil eines Mitspielers: Karte kommt unter MEINE Kontrolle (ownerId = Besitzer),
            // der Besitzer entfernt sie per reanimateRequests aus seiner Zone. Verlässt sie mein Feld, geht sie zurück zu ihm.
            const reanimateFrom = (card, ownerUid, fromZone) => {
                // schon auf meinem Feld (Doppelklick, veraltete Ansicht) → nicht verdoppeln
                if (myPermanents().some(c => c.instanceId === card.instanceId)) { addToast(`${cardName(card)} liegt schon auf deinem Spielfeld`, 'yellow'); return; }
                const ownerPresent = (lobbyState?.players || []).includes(ownerUid);
                const c = { ...prepEnter(card), instanceId: card.instanceId, ownerId: ownerUid };
                // Besitzer noch am Tisch: er entfernt die Karte selbst aus seiner Zone. Hat er den Tisch verlassen, gibt es
                // niemanden, der seinen Spielstand ändern darf – keine Anfrage (sie bliebe sonst ewig in der Warteschlange).
                if (ownerPresent) pushRoomRequest('reanimateRequests', { id: generateId(), targetPlayerId: ownerUid, instanceId: card.instanceId, fromZone, fromPlayerId: user.uid });
                const n = cardName(c);
                logEvent(`holt ${n} aus dem ${fromZone === 'exile' ? 'Exil' : 'Friedhof'} von ${getPlayerName(ownerUid)} auf das eigene Spielfeld${ownerPresent ? '' : ' (Besitzer hat den Tisch verlassen)'}`, [c]);
                // Länder: volle Land-Logik (Shock-Fenster, getappt, Landfall …)
                if (isLand(c)) { enterLand(c, 'none'); return; }
                if (isAuraCard(c)) { startAuraTargeting({ aura: c, source: 'zone', fromZone: 'none' }); return; }
                const { x, y } = getDefaultSpawnPosition(c);
                const placed = { ...c, x, y };
                updateMyState({ battlefieldLower: [...(myState.battlefieldLower || []), placed] });
                setTimeout(() => fireTriggers('etb', placed), 50);
            };

            // Taps/untaps either the host card itself, or one of its attachments independently - Auras and
            // Equipment tap on their own regardless of what they're attached to (rule: attachments aren't
            // automatically tapped/untapped along with their host).
            const toggleTap = (id, battlefield, clickEvent) => {
                const isUpper = battlefield === 'upper' || battlefield === 'battlefieldUpper';
                const allBF = isUpper ? (myState.battlefieldUpper || []) : (myState.battlefieldLower || []);
                const card = allBF.find(c => c.instanceId === id);
                const toggleInList = (arr) => (arr || []).map(c => {
                    if (c.instanceId === id) return { ...c, isTapped: !c.isTapped };
                    if (c.attachments?.some(a => a.instanceId === id)) {
                        return { ...c, attachments: c.attachments.map(a => a.instanceId === id ? { ...a, isTapped: !a.isTapped } : a) };
                    }
                    return c;
                });
                // If tapping (not untapping) a land, add its mana to the pool
                if (card && !card.isTapped && isLand(card)) tapLandForMana(card, clickEvent);
                if (isUpper) {
                    updateMyState({ battlefieldUpper: toggleInList(myState.battlefieldUpper) });
                } else {
                    updateMyState({ battlefieldLower: toggleInList(myState.battlefieldLower) });
                }
            };

            // Advances the active-player marker to whoever sits next in the table's seat order (wrapping
            // around back to the first seat after the last). Only the currently active player can call this -
            // the button itself is disabled for everyone else, see the render below.
            const endTurn = () => {
                // Commander hand-size rule: must discard down to 7 before passing the turn.
                if (myState.hand.length > 7) { setDiscardModal(true); return; }
                doEndTurn();
            };

            const doEndTurn = () => {
                clearMana();
                // Reset crew status on all vehicles — they stop being creatures at end of turn
                const uncrewVehicles = (arr) => (arr || []).map(c =>
                    c.isCrewed ? { ...c, isCrewed: false } : c
                );
                const bfUpdates = {};
                if ((myState.battlefieldLower||[]).some(c => c.isCrewed))
                    bfUpdates.battlefieldLower = uncrewVehicles(myState.battlefieldLower);
                if ((myState.battlefieldUpper||[]).some(c => c.isCrewed))
                    bfUpdates.battlefieldUpper = uncrewVehicles(myState.battlefieldUpper);
                if (Object.keys(bfUpdates).length) updateMyState(bfUpdates);
                const seatOrder = lobbyState?.seatOrder;
                if (!seatOrder || seatOrder.length === 0) return;
                const present = seatOrder.filter((p) => (lobbyState?.players || []).includes(p));
                const order = present.length ? present : seatOrder;
                const myIndex = Math.max(0, seatOrder.indexOf(activePlayerId));
                // nächster Spieler in Sitzreihenfolge, der noch am Tisch ist
                let nextPlayer = order[0];
                for (let i = 1; i <= seatOrder.length; i++) { const c = seatOrder[(myIndex + i) % seatOrder.length]; if (order.includes(c)) { nextPlayer = c; break; } }
                // Zugwechsel (auch allein am Tisch): Phase → Enttappen des nächsten Spielers. Dessen Client enttappt,
                // schaltet in die Versorgung und zieht in der Ziehphase automatisch. Laufender Kampf und Haltebitte enden.
                setPendingAttackers([]); setPendingBlocker(null);
                // Transaktion: nur wenn der Zug noch derselbe ist – zwei gleichzeitige Klicks (z. B. zwei Spieler,
                // nachdem der aktive gegangen ist) schalten so nicht zwei Züge weiter.
                const expectActive = activePlayerId, expectTurn = lobbyState?.phase?.turn || 0;
                runTx(async (tx) => {
                    const snap = await tx.get(roomRef);
                    if (!snap.exists()) return;
                    const r = snap.data();
                    if (r.activePlayer !== expectActive || (r.phase?.turn || 0) !== expectTurn) return;
                    tx.update(roomRef, {
                        activePlayer: nextPlayer,
                        phase: { step: 'untap', turn: expectTurn + 1, player: nextPlayer, at: Date.now() },
                        hold: null,
                        ...(r.combat ? { combat: null } : {})
                    });
                }).catch(err => addToast(`❌ Zug konnte nicht beendet werden: ${err.message}`, 'red'));
            };

            // Zug beenden darf der aktive Spieler – oder jeder, wenn der aktive Spieler den Tisch verlassen hat
            const mayControlTurn = activePlayerId === user.uid || (!!activePlayerId && !(lobbyState?.players || []).includes(activePlayerId));

            // „Moment!“: ein nicht aktiver Spieler bittet ums Anhalten (hold = { uid, name, at } im Raum). Solange
            // sie gilt, sind Weiter/Zug beenden/Leiste des aktiven Spielers gesperrt. Verlässt der Haltende den
            // Tisch, gilt sie nicht mehr.
            const holdRaw = lobbyState?.hold || null;
            const hold = holdRaw && holdRaw.uid && holdRaw.uid !== activePlayerId && (lobbyState?.players || []).includes(holdRaw.uid) ? holdRaw : null;
            const iHold = hold?.uid === user.uid;
            const holdBlocksMe = !!hold && !iHold;
            const holdTitle = hold ? `${hold.name || getPlayerName(hold.uid)} möchte reagieren` : '';
            const requestHold = () => updateDoc(roomRef, { hold: { uid: user.uid, name: getPlayerName(user.uid), at: Date.now() } }).then(() => logEvent('ruft „Moment!“')).catch(err => addToast(`❌ ${err.message}`, 'red'));
            const releaseHold = () => updateDoc(roomRef, { hold: null }).catch(err => addToast(`❌ ${err.message}`, 'red'));

            const canEndTurn = mayControlTurn && !holdBlocksMe;
            const canControlPhase = canEndTurn;

            // Kampf-Zustand für „Weiter“
            const presentPlayers = lobbyState?.players || [];
            const pendingDefenders = combatState ? Object.entries(combatState.priorities || {}).filter(([id, v]) => v !== 'passed' && presentPlayers.includes(id)).map(([id]) => id) : [];
            const blockersDone = !combatState || combatState.phase === 'resolving' || pendingDefenders.length === 0;
            const amDefending = !!combatState && combatState.phase === 'blocking' && combatState.attackerId !== user.uid && (combatState.priorities || {})[user.uid] !== undefined;
            const myPriorityPending = amDefending && (combatState.priorities || {})[user.uid] !== 'passed';

            // „Weiter“ des aktiven Spielers: ein Schritt vor; im Angriffsschritt = Angreifer bestätigen
            // (ohne Angreifer direkt zum Kampfende), im Blockerschritt erst wenn alle Verteidiger gepasst haben,
            // im Aufräumschritt = Zug beenden.
            const nextStep = () => {
                if (!canControlPhase) return;
                const s = curStep;
                if (s === 'cleanup') { endTurn(); return; }
                if (s === 'combat_begin') { startCombat(); return; }
                if (s === 'combat_attack') {
                    if (combatState?.phase === 'attacking' && combatState.attackerId === user.uid && pendingAttackers.length > 0) {
                        let atks = pendingAttackers;
                        if (atks.some(a => !a.targetPlayerId)) {
                            const opps = seatedOpponentIds.filter(id => presentPlayers.includes(id));
                            if (opps.length === 1) atks = atks.map(a => a.targetPlayerId ? a : { ...a, targetPlayerId: opps[0] });
                            else if (opps.length > 1) { addToast('🎯 Erst für jeden Angreifer ein Ziel wählen', 'yellow'); return; }
                        }
                        declareAttackers(atks);
                        return;
                    }
                    // keine Angreifer → kein Blocken, kein Schaden
                    setPendingAttackers([]);
                    goToStep('combat_end');
                    return;
                }
                if (s === 'combat_block') { if (!blockersDone) return; goToStep('combat_damage'); return; }
                if (s === 'combat_damage' && combatState) { addToast('Erst den Kampfschaden verteilen', 'yellow'); return; }
                goToStep(PHASE_STEPS[stepIdx(s) + 1]);
            };
            const jumpToStep = (target) => {
                if (!canControlPhase || stepIdx(target) <= stepIdx(curStep) || !isJumpTarget(target)) return;
                if (target === 'combat_attack') { startCombat(); return; }
                // Erklärte Angreifer, Schaden noch nicht verteilt: Sprung über den Kampf nur nach Rückfrage
                if (stepIdx(target) > stepIdx('combat_damage') && combatState && (combatState.attackers || []).length > 0 && combatState.phase !== 'attacking'
                    && !window.confirm('Kampf abbrechen? Der Kampfschaden wurde noch nicht verteilt.')) return;
                if (stepIdx(target) >= stepIdx('combat_end')) { setPendingAttackers([]); setPendingBlocker(null); }
                goToStep(target);
            };
            // Blocker-Schritt: haben alle anwesenden Verteidiger gepasst (oder den Tisch verlassen), schaltet der Client des
            // Angreifers selbst in den Schadensschritt. goToStep ist eine Transaktion und schaltet nur vorwärts – passiert
            // das gleichzeitig beim letzten Verteidiger (passPriority), bleibt es bei einem Schritt.
            autoDamageFnRef.current = () => goToStep('combat_damage');
            const activeName = getPlayerName(activePlayerId);
            const nextInfo = (() => {
                if (!mayControlTurn) return { label: 'Weiter ▸', disabled: true, title: `Nur ${activeName} kann weiterschalten` };
                if (holdBlocksMe) return { label: 'Weiter ▸', disabled: true, title: holdTitle };
                if (curStep === 'combat_attack' && pendingAttackers.length > 0) return { label: 'Angriff ▸', disabled: false, title: `${pendingAttackers.length} Angreifer bestätigen` };
                if (curStep === 'combat_attack') return { label: 'Weiter ▸', disabled: false, title: 'Ohne Angreifer weiter zum Kampfende' };
                if (curStep === 'combat_block' && !blockersDone) return { label: '⏳ Warte…', disabled: true, title: `Warte auf Blocker… (${pendingDefenders.map(getPlayerName).join(', ')})` };
                if (curStep === 'combat_damage' && combatState) return { label: 'Weiter ▸', disabled: true, title: 'Erst den Kampfschaden verteilen' };
                if (curStep === 'cleanup') return { label: 'Weiter ▸', disabled: false, title: 'Zug beenden' };
                return { label: 'Weiter ▸', disabled: false, title: `Weiter: ${PHASE_LABEL[PHASE_STEPS[stepIdx(curStep) + 1]]}` };
            })();

            // ⋯ menu of the left console, anchored to the right of its button and kept inside the viewport.
            const MY_MENU_H = 122;
            const toggleMyMenu = () => {
                if (myMenuPos) { setMyMenuPos(null); return; }
                const r = myMenuBtnRef.current?.getBoundingClientRect();
                if (!r) return;
                setMyMenuPos({ left: r.right + 6, top: Math.max(8, Math.min(r.top, window.innerHeight - MY_MENU_H - 8)) });
            };
            // Commander damage popover: right of the left sidebar, top at the ⋯ button, but never below the
            // viewport (its maxHeight is 45vh, so it is pulled up as far as needed).
            const openCmdDmg = () => {
                const sb = myLeftSidebarRef.current?.getBoundingClientRect();
                const btn = myMenuBtnRef.current?.getBoundingClientRect();
                const maxH = window.innerHeight * 0.45;
                const top = btn ? Math.max(8, Math.min(btn.top, window.innerHeight - maxH - 8)) : 8;
                setCmdDmgPos({ left: (sb ? sb.right : 232) + 8, top });
                setCmdDmgOpen(true);
                setMyMenuPos(null);
            };

            const handleLeaveGame = () => {
                if ((lobbyState?.players || []).length <= 1) { onLeave(); return; } // Solo-Tisch: ohne Wertung raus
                setLeaveGameModal(true);
            };

            const submitGameResult = async (winner) => {
                // This still writes to the main room doc, which is correct
                await updateDoc(roomRef, {
                    gameResult: {
                        winner,
                        submittedBy: user.uid,
                        confirmed: false,
                        timestamp: Date.now(),
                        participants: Object.fromEntries((lobbyState?.players || []).map((p) => [p, lobbyState?.playerInfo?.[p] || {}]))
                    }
                });
            };

            const extractDeckColors = (deckData) => {
                const commanders = Array.isArray(deckData?.commanders) ? deckData.commanders : (deckData?.commander ? [deckData.commander] : []);
                if (commanders.length === 0) return [];
                const colorMap = { 'W': 'W', 'U': 'U', 'B': 'B', 'R': 'R', 'G': 'G' };
                const colors = new Set();
                commanders.forEach(c => (c.color_identity || []).forEach(col => { if (colorMap[col]) colors.add(col); }));
                return Array.from(colors);
            };

            // This logic is unchanged, but now reads from lobbyState.playerInfo.
            // NOTE: 1v1 Win/Loss tracking only makes sense for 2-player games - with 3-4 players this is skipped
            // (the result is still shown/recorded in the room, just not auto-logged to either tracker).
            // MTG-Sammlung: jeder Spieler speichert das Ergebnis in SEINEM Deck (Bilanz), nicht beim Gegner
            const saveMatchToTrackers = async (winnerId) => {
                try {
                    const info = lobbyState?.playerInfo || {}
                    const opponents = (lobbyState?.players || []).filter((p) => p !== user.uid).map((p) => ({ uid: p, name: info[p]?.name || '?', deck: info[p]?.deckName || '?', commander: info[p]?.commanderName || '' }))
                    await arenaHooks.onResult?.({ result: winnerId == null ? 'draw' : winnerId === user.uid ? 'win' : 'loss', winnerName: winnerId ? (info[winnerId]?.name || '?') : null, opponents, players: (lobbyState?.players || []).length })
                } catch (error) { console.error('Ergebnis speichern fehlgeschlagen:', error) }
            };

            const confirmGameResult = async () => {
                await updateDoc(roomRef, {
                    'gameResult.confirmed': true
                });
                reportResult(roomId, user.uid, lobbyState?.gameResult || gameResult, lobbyState?.playerInfo, lobbyState?.players);
                setLeaveGameModal(false);
                onLeave(); // This prop will handle cleanup
            };

            const handleDragStart = (e, card, fromZone, hostInfo = null) => setDraggedCard({ card, fromZone, hostInfo });
            
            // Zielplatz einer verschobenen/gelegten Karte: immer die Reihe ihres Kartentyps (Ende der Reihe).
            const snapCardToZone = (card, excludeInstanceId = null) => (playerLowerBattlefieldRef.current ? slotPercent(card, excludeInstanceId) : null);

            // Re-snaps ALL cards currently on my battlefield to their correct zone slots based on their type.
            // Called on window resize so cards stay in their zones even after the layout changes size.
            const handleDropOnBattlefield = (e, targetBattlefield, battlefieldRef) => {
                e.preventDefault();
                if (!draggedCard) return;
                const rect = battlefieldRef.current.getBoundingClientRect();

                // Store position as a PERCENTAGE of the battlefield's own size, not absolute pixels.
                // Absolute pixel coordinates were computed against the dragging player's screen width/height;
                // when rendered on a different player's (differently sized) screen, cards placed near the far
                // edge of a wide screen could end up positioned far outside a narrower viewer's visible area -
                // effectively invisible. Percentages always map 0-100% of MY container to 0-100% of THEIRS.
                const rawX = e.clientX - rect.left - (CARD_W / 2);
                const rawY = e.clientY - rect.top - (CARD_H / 2);
                const maxX = Math.max(rect.width - CARD_W, 0);
                const maxY = Math.max(rect.height - CARD_H, 0);
                const clampedX = Math.min(Math.max(rawX, 0), maxX);
                const clampedY = Math.min(Math.max(rawY, 0), maxY);
                const x = rect.width > 0 ? (clampedX / rect.width) * 100 : 0;
                const y = rect.height > 0 ? (clampedY / rect.height) * 100 : 0;

                if (draggedCard.fromZone === 'battlefieldUpper' || draggedCard.fromZone === 'battlefieldLower') {
                    const updates = {};
                    updates.battlefieldUpper = (myState.battlefieldUpper || []).filter(c => c.instanceId !== draggedCard.card.instanceId);
                    updates.battlefieldLower = (myState.battlefieldLower || []).filter(c => c.instanceId !== draggedCard.card.instanceId);

                    // Die Reihe ergibt sich aus dem Kartentyp; das x der Drop-Position bestimmt nur die
                    // Reihenfolge innerhalb der Reihe (so lassen sich Karten umsortieren).
                    const snapped = snapCardToZone(draggedCard.card, draggedCard.card.instanceId);
                    const finalX = x;
                    const finalY = snapped ? snapped.y : y;
                    const movedCard = { ...draggedCard.card, x: finalX, y: finalY };
                    if (targetBattlefield === 'upper') {
                        updates.battlefieldUpper = [...updates.battlefieldUpper, movedCard];
                    } else {
                        updates.battlefieldLower = [...updates.battlefieldLower, movedCard];
                    }
                    updateMyState(updates);
                } else if (draggedCard.fromZone === 'stack' && isAuraCard(draggedCard.card)) {
                    // Auras always need a creature target - dropping one onto empty battlefield space (missing
                    // the card underneath) does nothing, rather than letting it sit there with no host.
                } else if (draggedCard.hostInfo && isEquipmentCard(draggedCard.card)) {
                    // Dragging an already-equipped Equipment off its host and onto empty battlefield space:
                    // detach it and drop it there loose, at the new position.
                    const { hostCard, hostZone } = draggedCard.hostInfo;
                    const stripped = (myState[hostZone] || []).map(c => 
                        c.instanceId === hostCard.instanceId ? { ...c, attachments: (c.attachments || []).filter(a => a.instanceId !== draggedCard.card.instanceId) } : c
                    );
                    const freedCard = { ...draggedCard.card, isTapped: false, x, y };
                    const updates = { [hostZone]: stripped };
                    const targetKey = targetBattlefield === 'upper' ? 'battlefieldUpper' : 'battlefieldLower';
                    updates[targetKey] = [...(updates[targetKey] || myState[targetKey] || []), freedCard];
                    updateMyState(updates);
                } else if (draggedCard.fromZone === 'hand' && landBackIdx(draggedCard.card) != null && !isLand(draggedCard.card)) {
                    // Modale Karte mit Land-Rückseite: auf die Länderreihe gezogen → als Land, sonst wie gewohnt
                    const g = measureMyGeom(), z = g.zones.land, py = e.clientY - rect.top, px = e.clientX - rect.left;
                    if (py >= z.top - 6 && py <= z.top + g.ch + 6 && px >= z.left - 6 && px <= z.right + 6) playLandFace(draggedCard.card, 1);
                    else playCard(draggedCard.card, draggedCard.fromZone, targetBattlefield, { x, y });
                } else {
                    playCard(draggedCard.card, draggedCard.fromZone, targetBattlefield, { x, y });
                }
                setDraggedCard(null);
            };

            // Drop handler for dropping a dragged card directly onto another card (rather than empty
            // battlefield space). Decides between attaching an Aura (dragged from the stack, can target any
            // creature) and equipping an Equipment (dragged from my own battlefield, only onto my own
            // creatures) based on what's actually being dragged and where it came from.
            const handleDropOnCard = (targetCard, targetZone) => {
                if (!draggedCard) return;
                const { card: sourceCard, fromZone } = draggedCard;
                if (!isCreatureLike(targetCard)) { setDraggedCard(null); return; } // Can only attach to creatures

                if (fromZone === 'stack' && isAuraCard(sourceCard)) {
                    const stackEntry = allStackCards.find(s => s.instanceId === sourceCard.instanceId);
                    if (!stackEntry) { setDraggedCard(null); return; }
                    // The Aura can only resolve while it's on top of the stack (index 0) - this is the same
                    // LIFO rule enforced in the stack UI's resolve buttons, applied here too since dragging
                    // is an alternate way to resolve an Aura spell.
                    if (allStackCards[0]?.instanceId !== stackEntry.instanceId) { setDraggedCard(null); return; }
                    // Figure out which player currently controls the target creature, so a cross-player
                    // request gets sent if it's not mine.
                    const isMyOwnCreature = (myState.battlefieldLower || []).some(c => c.instanceId === targetCard.instanceId)
                        || (myState.battlefieldUpper || []).some(c => c.instanceId === targetCard.instanceId);
                    let targetOwnerId = isMyOwnCreature ? user.uid : opponentIds.find(oid => 
                        (opponentStates[oid]?.battlefieldLower || []).some(c => c.instanceId === targetCard.instanceId) ||
                        (opponentStates[oid]?.battlefieldUpper || []).some(c => c.instanceId === targetCard.instanceId)
                    );
                    if (!targetOwnerId) { setDraggedCard(null); return; }
                    attachAuraCardFromStack(stackEntry, targetCard, targetZone, targetOwnerId);
                } else if ((fromZone === 'battlefieldUpper' || fromZone === 'battlefieldLower') && isEquipmentCard(sourceCard)) {
                    // Equipment can only be equipped onto MY OWN creatures, dragged from MY OWN battlefield.
                    equipCardOnField(sourceCard, fromZone, targetCard, targetZone);
                } else if (fromZone && fromZone.endsWith('_attachment') && isEquipmentCard(sourceCard)) {
                    // Re-equipping: the Equipment was already attached to a different creature - move it
                    // straight to the new one. equipCardOnField already strips it from every host first.
                    equipCardOnField(sourceCard, draggedCard.hostInfo?.hostZone || fromZone.replace('_attachment', ''), targetCard, targetZone);
                }
                setDraggedCard(null);
            };

            const handleDropOnZone = (e, zone) => {
                e.preventDefault();
                if (!draggedCard) return;
                const target = zone === 'library' ? 'library_top' : zone;
                if (draggedCard.fromZone === target) { setDraggedCard(null); return; }
                moveCardToZone(draggedCard.card, target);
                setDraggedCard(null);
            };

            const renderBattlefieldCard = (card, zone, isMine = false, pos = null, geom = null) => {
                const zoneName = isMine ? zone : `opponent_${zone}`;
                // card.x / card.y are stored as percentages (0-100) of the battlefield container's own size,
                // not absolute pixels. This way a card's position always maps correctly onto every viewer's
                // battlefield regardless of their screen/window size - no more cards landing outside a
                // narrower viewport just because they were placed on a wider one.
                const leftStyle = `${card.x}%`;
                const topStyle = `${card.y}%`;
                const auraAttachments = (card.attachments || []).filter(a => a.kind === 'aura');
                const equipmentAttachments = (card.attachments || []).filter(a => a.kind === 'equipment');
                // Offset so the host's name/top portion stays visible above an Aura stacked underneath it,
                // and the host's bottom portion stays visible below an Equipment stacked on top of it.
                const ATTACH_OFFSET = 28;
                const auraValid = !!auraTarget && auraTargetOk(auraTarget, card, isMine);
                const handAuraDrag = draggedCard?.fromZone === 'hand' && isAuraCard(draggedCard.card);
                // Klick während der Aura-Zielwahl (auch auf Anhänge der Karte) → diese Karte als Ziel
                const auraClick = (e) => {
                    if (!auraTarget) return false;
                    e.stopPropagation();
                    if (!auraValid) { addToast(`Kein gültiges Ziel für ${cardName(auraTarget.aura)}`, 'yellow'); return true; }
                    const owner = isMine ? user.uid : findOnBattlefield(card.instanceId)?.playerId;
                    if (owner) chooseAuraTarget(card, zone, owner);
                    return true;
                };
                return (
                    <div 
                        key={card.instanceId} 
                        data-aura-target={auraValid ? '1' : undefined}
                        className="absolute cursor-pointer"
                        style={pos && geom
                            // eigenes Feld: Reihe/Platz aus layoutMyCards, Größe über scale (kleine Fenster)
                            ? { left: pos.px, top: pos.py, transform: geom.scale !== 1 ? `scale(${geom.scale})` : undefined, transformOrigin: 'top left', zIndex: 10 + pos.rank }
                            : { left: leftStyle, top: isMine ? topStyle : (zone === 'battlefieldLower' ? undefined : topStyle), bottom: isMine ? undefined : (zone === 'battlefieldLower' ? topStyle : undefined) }}
                        draggable={isMine}
                        onDragStart={(e) => isMine && handleDragStart(e, card, zone)}
                        onDragOver={(e) => (isMine || (draggedCard?.fromZone === 'stack' && isAuraCard(draggedCard.card)) || handAuraDrag) && e.preventDefault()}
                        onDrop={(e) => {
                            if (!draggedCard) return;
                            // Aura aus der Hand auf eine Karte: auf den Stack, Ziel merken (beim Auflösen automatisch anlegen)
                            if (handAuraDrag) {
                                e.preventDefault(); e.stopPropagation();
                                const owner = isMine ? user.uid : findOnBattlefield(card.instanceId)?.playerId;
                                const src = draggedCard.card;
                                setDraggedCard(null);
                                if (!owner || !auraTargetOk({ aura: src, enchant: parseEnchant(src) }, card, isMine)) { addToast(`${cardName(src)} kann ${cardName(card)} nicht verzaubern`, 'yellow'); return; }
                                castToStack(src, 'hand', { auraTarget: { cardInstanceId: card.instanceId, playerId: owner } });
                                addToast(`✨ ${cardName(src)} auf dem Stack – Ziel: ${cardName(card)}`, 'purple');
                                return;
                            }
                            // Gegnerkarten: nur eine Aura vom Stack darf darauf abgelegt werden
                            if (!isMine && !(draggedCard.fromZone === 'stack' && isAuraCard(draggedCard.card))) return;
                            // Nur Anlegen (Aura vom Stack, Ausrüstung) wird auf der Karte behandelt; alles andere
                            // (z. B. ein Land aus der Hand auf eine Kreatur im vollen Fächer) geht ans Spielfeld weiter.
                            const { card: src, fromZone: fz } = draggedCard;
                            const attachDrag = (fz === 'stack' && isAuraCard(src)) || ((fz === 'battlefieldUpper' || fz === 'battlefieldLower' || (fz || '').endsWith('_attachment')) && isEquipmentCard(src));
                            if (!attachDrag) return;
                            e.preventDefault();
                            e.stopPropagation(); // Don't let the battlefield's own onDrop also fire for this same drop
                            handleDropOnCard(card, zone);
                        }}
                        onContextMenu={(e) => {
                            if (isMine) {
                                e.preventDefault();
                                setCardMenu({ x: e.clientX, y: e.clientY, card, zone });
                            }
                        }}
                    >
                        {/* Equipment stacked above the host - offset up so the host's bottom edge still peeks out */}
                        {equipmentAttachments.map((a, i) => (
                            <div 
                                key={a.instanceId}
                                className="absolute cursor-pointer"
                                style={{ top: -ATTACH_OFFSET * (equipmentAttachments.length - i), left: 0, zIndex: 5 + i }}
                                draggable={isMine}
                                onDragStart={(e) => { if (isMine) { e.stopPropagation(); handleDragStart(e, a.card, `${zone}_attachment`, { hostCard: card, hostZone: zone, attachment: a }); } }}
                                onContextMenu={(e) => {
                                    if (isMine) { e.preventDefault(); e.stopPropagation(); setCardMenu({ x: e.clientX, y: e.clientY, card: { ...a.card, instanceId: a.instanceId }, zone, isAttachment: true, hostCard: card, hostZone: zone }); }
                                }}
                            >
                                <CardImage 
                                    src={a.image_url} 
                                    className={`w-[90px] h-[120px] card-shadow ${a.isTapped ? 'tapped' : 'untapped'}`}
                                    onClick={(e) => { if (auraClick(e)) return; if (isMine) { e.stopPropagation(); toggleTap(a.instanceId, zone); } }}
                                    onMouseEnter={() => setHoveredCard(a.image_url)}
                                    onMouseLeave={() => setHoveredCard(null)}
                                />
                            </div>
                        ))}
                        {card.counters && card.counters.length > 0 && (
                            <div className="counter-badge-container">
                                {card.counters.map(c => (
                                    <span key={c.type} className="counter-badge" title={`${c.type}: ${c.count}`}>
                                        {c.type} ({c.count})
                                    </span>
                                ))}
                            </div>
                        )}
                        {card.auras && card.auras.length > 0 && (
                            <div className="counter-badge-container" style={{ top: card.counters?.length ? '22px' : '2px' }}>
                                {card.auras.map(a => (
                                    <span key={a.instanceId} className="counter-badge bg-purple-700/90" title={a.ability}>
                                        {a.name}
                                    </span>
                                ))}
                            </div>
                        )}
                        {isMine && myEmblems.some(e => e.name === 'The Ring' && e.ringBearerInstanceId === card.instanceId) && (
                            <div className="absolute -top-2 -left-2 z-10 bg-yellow-500 text-yellow-900 text-[9px] font-bold px-1.5 py-0.5 rounded-full shadow-lg border border-yellow-300" title="Dein Ringträger">
                                👑
                            </div>
                        )}
                        <div className="relative group/bfcard">
                            <CardImage 
                                src={card.image_url} 
                                className={`w-[90px] h-[120px] card-shadow ${card.isTapped ? 'tapped' : 'untapped'}
                                    ${isMine && pendingAttackers.find(a=>a.card.instanceId===card.instanceId) ? 'border-4 border-red-500 brightness-110' : ''}
                                    ${isMine && combatState?.phase==='blocking' && pendingBlocker?.instanceId===card.instanceId ? 'border-4 border-yellow-400 brightness-110' : ''}
                                `}
                                style={{ zIndex: 4 }}
                                onClick={(e) => {
                                    if (auraClick(e)) return;
                                    if (!isMine) return;
                                    if (combatState?.phase === 'attacking' && combatState.attackerId === user.uid && isCreatureLike(card) && !card.isTapped) {
                                        toggleAttacker(card);
                                    } else if (combatState?.phase === 'blocking' && combatState.attackerId !== user.uid && isCreatureLike(card)) {
                                        // Toggle as pending blocker
                                        setPendingBlocker(prev => prev?.instanceId === card.instanceId ? null : card);
                                    } else {
                                        toggleTap(card.instanceId, zone, e);
                                    }
                                }}
                                onMouseEnter={() => setHoveredCard(previewOf(card))}
                                onMouseLeave={() => setHoveredCard(null)}
                            />
                            {auraValid && (
                                <div className="absolute inset-0 rounded-lg pointer-events-none" style={{ zIndex: 6, border: '2px solid #facc15', boxShadow: '0 0 14px 4px rgba(250,204,21,0.75)' }} />
                            )}
                            {/* Fetch button — shown on hover for lands with a fetch ability */}
                            {isMine && isLand(card) && parseFetchAbility(card.oracle_text) && (
                                <button
                                    onClick={(e) => { e.stopPropagation(); activateFetch(card, zone); }}
                                    className="absolute bottom-1 inset-x-1 bg-green-700 hover:bg-green-500 text-white text-[10px] font-bold py-1 rounded opacity-0 group-hover/bfcard:opacity-100 touch-show transition-opacity shadow-lg z-10"
                                    title="Fetch-Fähigkeit aktivieren"
                                >🔍 Suchen</button>
                            )}
                        </div>
                        {/* P/T badge — shown on all creatures, tokens, and Vehicles (only when crewed) */}
                        {(() => {
                            const isVehicle = /\bVehicle\b/i.test(card.type_line || '');
                            const isCreature = isCreatureLike(card);
                            const showPT = isCreature || (isVehicle && card.isCrewed);
                            if (!showPT) return null;
                            const [p, t] = getPT(card);
                            if (p === 0 && t === 0 && !card.power && !card.toughness && !card.p_t) return null; // skip if truly no PT data
                            // Add +1/+1 counters and subtract -1/-1 counters
                            const plus = (card.counters || []).filter(c => c.type === '+1/+1').reduce((s, c) => s + c.count, 0);
                            const minus = (card.counters || []).filter(c => c.type === '-1/-1').reduce((s, c) => s + c.count, 0);
                            const dispP = p + plus - minus;
                            const dispT = t + plus - minus;
                            const isDamaged = dispT <= 0;
                            return (
                                <div style={{
                                    position: 'absolute', bottom: 3, right: 4,
                                    background: isDamaged ? '#7f1d1d' : 'rgba(0,0,0,0.82)',
                                    border: `1px solid ${isDamaged ? '#ef4444' : 'rgba(255,255,255,0.25)'}`,
                                    borderRadius: 4, padding: '1px 5px',
                                    color: isDamaged ? '#fca5a5' : 'white',
                                    fontSize: 11, fontWeight: 'bold', lineHeight: 1.3,
                                    pointerEvents: 'none', zIndex: 5,
                                    textShadow: '0 1px 3px rgba(0,0,0,0.9)',
                                }}>
                                    {dispP}/{dispT}
                                </div>
                            );
                        })()}
                        {/* Auras stacked below the host - offset down so the host's top edge/name stays visible.
                            Not draggable: an attached Aura stays put until its host leaves the battlefield -
                            it only taps independently and offers a right-click menu (e.g. for its own counters). */}
                        {auraAttachments.map((a, i) => (
                            <div 
                                key={a.instanceId}
                                className="absolute cursor-pointer"
                                style={{ top: ATTACH_OFFSET * (i + 1), left: 0, zIndex: 3 - i }}
                                onContextMenu={(e) => {
                                    if (isMine && a.ownerId === user.uid) { e.preventDefault(); e.stopPropagation(); setCardMenu({ x: e.clientX, y: e.clientY, card: { ...a.card, instanceId: a.instanceId }, zone, isAttachment: true, hostCard: card, hostZone: zone }); }
                                }}
                            >
                                <CardImage 
                                    src={a.image_url} 
                                    className={`w-[90px] h-[120px] card-shadow ${a.isTapped ? 'tapped' : 'untapped'}`}
                                    onClick={(e) => { if (auraClick(e)) return; if (isMine && a.ownerId === user.uid) { e.stopPropagation(); toggleTap(a.instanceId, zone); } }}
                                    onMouseEnter={() => setHoveredCard(a.image_url)}
                                    onMouseLeave={() => setHoveredCard(null)}
                                />
                            </div>
                        ))}
                    </div>
                );
            };

            // Reihen-Layout meiner Hälfte (bei jedem Rendern aus der gemessenen Größe berechnet – alte, frei
            // gespeicherte Positionen landen so automatisch in der richtigen Reihe).
            const myGeom = zoneBounds ? computeBfGeom(zoneBounds.bfWidth, zoneBounds.bfHeight, zoneBounds.leftSidebarRightX, zoneBounds.rightSidebarLeftX) : null;
            const myLayout = myGeom ? layoutMyCards(myPermanents(), myGeom) : {};
            const oppGeom = myGeom ? mirrorBfGeom(myGeom) : null;

            // Aktionen für die Tastenkürzel – exakt dieselben Wege und Sperren wie die Buttons.
            kbRef.current = {
                toggleLog: () => setLogOpen(v => !v),
                escape: () => { if (auraTarget) placeAuraLoose(); setShowKeys(false); setMyMenuPos(null); setCardMenu(null); setLibraryMenu(null); setCmdDmgOpen(false); setManaChoice(null); setViewingZone(null); setTopCardView(null); },
                toggleHelp: () => setShowKeys(v => !v),
                space: () => {
                    // Während der Aura-Zielwahl nichts weiterschalten (Esc legt die Aura ohne Ziel ab)
                    if (auraTarget) { addToast(`Erst ein Ziel für ${cardName(auraTarget.aura)} wählen (Esc: ohne Ziel)`, 'yellow'); return; }
                    if (myPriorityPending) { passPriority(); return; }
                    if (amDefending) return;
                    if (nextInfo.disabled) return;
                    // Per Taste nicht versehentlich an offenen Zaubern/Fähigkeiten vorbeischalten (Button geht weiterhin)
                    if (allStackCards.length) { addToast('Erst den Stack auflösen', 'yellow'); return; }
                    nextStep();
                },
                draw: () => { if (!myState.library.length) { addToast('Bibliothek ist leer', 'yellow'); return; } drawCard(); },
                endTurn: () => {
                    if (!canEndTurn) return;
                    if (auraTarget) { addToast(`Erst ein Ziel für ${cardName(auraTarget.aura)} wählen (Esc: ohne Ziel)`, 'yellow'); return; }
                    if (allStackCards.length) { addToast('Erst den Stack auflösen', 'yellow'); return; }
                    endTurn();
                },
                toggleHand: () => setMyHandMinimized(v => !v),
                shuffle: shuffleLibrary,
                token: () => setTokenModalOpen(true),
                // increment statt myState.life + d: beim Gedrückthalten (Auto-Repeat) kommen Tasten schneller als
                // der Snapshot zurück – mit dem lokalen Wert gingen Schritte verloren.
                life: (d) => updateMyState({ life: increment(d) }),
                hold: () => {
                    if (hold) { if (iHold || mayControlTurn) releaseHold(); return; }
                    if (!mayControlTurn && activePlayerId) requestHold();
                },
            };
            const KEY_LIST = [
                ['Leertaste', 'Weiter (als Verteidiger: Kein Blocker)'],
                ['E', 'Zug beenden'],
                ['D', 'Karte ziehen'],
                ['H', 'Hand ein/aus'],
                ['M', 'Bibliothek mischen'],
                ['T', 'Token erstellen'],
                ['+ / −', 'Leben +1 / −1'],
                ['X', 'Moment! / Weiter geben'],
                ['L', 'Spielprotokoll ein/aus'],
                ['Esc', 'Menüs und Fenster schließen'],
                ['?', 'Diese Übersicht ein/aus'],
            ];

            return (
                <div className="h-full w-full relative bg-gray-900 overflow-hidden flex flex-col">
                    {/* Global notification toasts */}
                    <NotificationToasts />
                    <HintStack hints={hints}
                        onDraw={(h) => { drawCard(); addToast(`📖 ${h.cardName}: Karte gezogen`, 'blue'); setHints(p => p.filter(x => x.id !== h.id)); }}
                        onDismiss={(h) => setHints(p => p.filter(x => x.id !== h.id))} />

                    {/* Aura-Zielwahl: Banner oben in der Mitte, gültige Ziele leuchten golden */}
                    {auraTarget && ReactDOM.createPortal(
                        <div data-testid="aura-banner" className="bg-gray-950/95 border-solid border border-yellow-500 rounded-xl shadow-2xl flex items-center gap-3"
                            style={{ position: 'fixed', left: '50%', top: 10, transform: 'translateX(-50%)', zIndex: 9500, padding: '8px 14px', color: '#ece4cf', fontSize: 13 }}>
                            <span>✨ Wähle, was <b className="text-yellow-300">{cardName(auraTarget.aura)}</b> verzaubert <span className="text-gray-400" style={{ fontSize: 11 }}>({auraTarget.enchant?.label || 'creature'})</span></span>
                            <button onClick={() => placeAuraLoose()} title="Ohne Ziel ablegen (Esc)" className="bg-gray-700 hover:bg-gray-600 text-white text-xs font-bold px-3 py-1 rounded border-0 cursor-pointer">Ohne Ziel ablegen</button>
                        </div>,
                        (document.getElementById('arena-portal') || document.body)
                    )}

                    {/* Spielprotokoll: Knopf am rechten Rand auf der Mittellinie, Panel rechts über der Seitenleiste */}
                    {(() => {
                        const unread = logOpen ? 0 : logEntries.filter(e => e.at > logSeenAt && e.uid !== user.uid).length;
                        const seats = (lobbyState?.seatOrder && lobbyState.seatOrder.length ? lobbyState.seatOrder : [...(lobbyState?.players || [])].sort());
                        const PCOL = ['#f2b45a', '#7cc4ff', '#8fdc8a', '#d6a2ff', '#ff8f7a', '#f5e17a'];
                        const colorOf = (uid) => { const i = seats.indexOf(uid); if (i >= 0) return PCOL[i % PCOL.length]; let h = 0; for (const ch of String(uid)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return PCOL[h % PCOL.length]; };
                        const hhmm = (t) => { const d = new Date(t || 0); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
                        const renderText = (e) => {
                            let parts = [String(e.text || '')];
                            (e.cards || []).forEach((c, ci) => {
                                if (!c.name) return;
                                parts = parts.flatMap((p) => {
                                    if (typeof p !== 'string' || !p.includes(c.name)) return [p];
                                    const seg = p.split(c.name);
                                    return seg.flatMap((x, i) => i === 0 ? [x] : [
                                        <span key={`${ci}-${i}-${x.length}`} data-log-card={c.name} className="text-yellow-200 underline cursor-help" style={{ textDecorationStyle: 'dotted' }}
                                            onMouseEnter={() => c.image_url && setHoveredCard(c.image_url)} onMouseLeave={() => setHoveredCard(null)}>{c.name}</span>, x]);
                                });
                            });
                            return parts;
                        };
                        return ReactDOM.createPortal(
                            <>
                                <button data-testid="log-toggle" onClick={() => setLogOpen(v => !v)} title="Spielprotokoll (L)" aria-label="Spielprotokoll"
                                    className={`border-solid border rounded-l-lg shadow-lg font-bold cursor-pointer ${logOpen ? 'bg-yellow-600 text-gray-950 border-yellow-400' : 'bg-gray-900/95 text-yellow-300 border-yellow-700/70 hover:bg-gray-800'}`}
                                    style={{ position: 'fixed', right: logOpen ? 288 : 0, top: '50%', transform: 'translateY(-50%)', zIndex: 8996, fontSize: 11, padding: '3px 8px', lineHeight: '14px' }}>
                                    📜 Log
                                    {unread > 0 && <span data-testid="log-unread" className="bg-red-600 text-white rounded-full font-bold" style={{ position: 'absolute', top: -7, left: -7, minWidth: 16, height: 16, fontSize: 9, lineHeight: '16px', textAlign: 'center', padding: '0 3px' }}>{unread > 99 ? '99+' : unread}</span>}
                                </button>
                                {logOpen && (
                                    <div data-testid="log-panel" className="bg-gray-950/95 border-solid border border-yellow-600/70 rounded-xl shadow-2xl flex flex-col"
                                        style={{ position: 'fixed', right: 8, top: '50%', transform: 'translateY(-50%)', width: 280, maxHeight: '60vh', zIndex: 8995, color: '#ece4cf' }}>
                                        <div className="flex items-center justify-between border-solid border-0 border-b border-yellow-700/50" style={{ padding: '6px 10px' }}>
                                            <span className="font-title text-yellow-400 font-bold tracking-wide" style={{ fontSize: 13 }}>📜 Spielprotokoll</span>
                                            <button onClick={() => setLogOpen(false)} aria-label="Schließen" title="Schließen (L)" className="bg-transparent border-0 text-gray-400 hover:text-yellow-300 cursor-pointer" style={{ fontSize: 14 }}>✕</button>
                                        </div>
                                        <div ref={logScrollRef} className="overflow-y-auto flex flex-col gap-1" style={{ padding: '6px 10px', fontSize: 11.5, lineHeight: 1.35 }}>
                                            {logEntries.length === 0 && <p className="text-gray-500 text-center m-0" style={{ padding: '12px 0' }}>Noch keine Einträge</p>}
                                            {logEntries.map(e => e.kind === 'turn' ? (
                                                <div key={e.id} data-log-entry="turn" className="text-center font-bold text-yellow-400 border-solid border-0 border-t border-yellow-700/40" style={{ marginTop: 4, paddingTop: 3, fontSize: 11 }}>
                                                    — {e.text} — <span className="text-gray-500 font-normal">{hhmm(e.at)}</span>
                                                </div>
                                            ) : (
                                                <div key={e.id} data-log-entry="1">
                                                    <span className="text-gray-500" style={{ fontSize: 10 }}>{hhmm(e.at)}</span>{' '}
                                                    <b style={{ color: colorOf(e.uid) }}>{e.name || getPlayerName(e.uid)}</b>{' '}
                                                    <span className="text-gray-200">{renderText(e)}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </>,
                            (document.getElementById('arena-portal') || document.body)
                        );
                    })()}

                    {/* Kürzel-Übersicht (? / ⋯-Menü) – kein Modal, das Spiel bleibt bedienbar */}
                    {showKeys && ReactDOM.createPortal(
                        <div data-testid="kbd-help" className="bg-gray-950/95 border-solid border border-yellow-600/70 rounded-xl shadow-2xl"
                            style={{ position: 'fixed', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', zIndex: 9000, width: 340, padding: '12px 14px', color: '#ece4cf' }}
                        >
                            <div className="flex items-center justify-between mb-2">
                                <span className="font-title text-yellow-400 font-bold tracking-wide" style={{ fontSize: 14 }}>Tastenkürzel</span>
                                <button onClick={() => setShowKeys(false)} aria-label="Schließen" title="Schließen (Esc)" className="bg-transparent border-0 text-gray-400 hover:text-yellow-300" style={{ fontSize: 14 }}>✕</button>
                            </div>
                            <div className="flex flex-col gap-1">
                                {KEY_LIST.map(([k, d]) => (
                                    <div key={k} className="flex items-center gap-3" style={{ fontSize: 12 }}>
                                        <kbd className="inline-block text-center font-bold text-yellow-300 bg-gray-800 border-solid border border-yellow-700/60 rounded" style={{ minWidth: 74, padding: '1px 6px', fontFamily: 'inherit', fontSize: 11 }}>{k}</kbd>
                                        <span className="text-gray-200">{d}</span>
                                    </div>
                                ))}
                            </div>
                            <p className="text-gray-500 mt-2 mb-0" style={{ fontSize: 10.5 }}>Nicht aktiv beim Tippen in Feldern und bei offenen Fenstern.</p>
                        </div>,
                        (document.getElementById('arena-portal') || document.body)
                    )}

                    {/* Mana color choice popup for dual lands */}
                    {manaChoice && ReactDOM.createPortal(
                        <div style={{ position:'fixed', zIndex:9999, left: manaChoice.pos.x - 80, top: manaChoice.pos.y - 80, background:'#1f2937', border:'2px solid #6b7280', borderRadius:10, padding:12, boxShadow:'0 8px 30px rgba(0,0,0,0.8)' }}>
                            <div style={{ color:'#9ca3af', fontSize:11, marginBottom:8, textAlign:'center' }}>Choose mana from {manaChoice.card.name}</div>
                            <div style={{ display:'flex', gap:8, justifyContent:'center' }}>
                                {manaChoice.options.map(sym => {
                                    const c = MANA_COLORS[sym] || { bg:'#374151', text:'white', label: sym };
                                    return (
                                        <button key={sym} onClick={() => resolveManaChoice(sym)}
                                            style={{ width:36, height:36, borderRadius:'50%', background:c.bg, color:c.text, border:'2px solid rgba(255,255,255,0.3)', fontWeight:'bold', fontSize:14, cursor:'pointer' }}>
                                            {c.label}
                                        </button>
                                    );
                                })}
                                <button onClick={() => setManaChoice(null)} style={{ width:36, height:36, borderRadius:'50%', background:'#374151', color:'#9ca3af', border:'1px solid #4b5563', cursor:'pointer', fontSize:12 }}>✕</button>
                            </div>
                        </div>,
                        (document.getElementById('arena-portal') || document.body)
                    )}

                    {/* Combat overlays */}
                    {combatState?.phase === 'attacking' && combatState.attackerId === user.uid && (
                        <CombatOverlay mode="attacking"
                            attackers={pendingAttackers}
                            pendingAttackers={pendingAttackers}
                            onToggleAttacker={toggleAttacker}
                            onSetTarget={setAttackerTarget}
                            onDeclareAttackers={declareAttackers}
                            onEndCombat={endCombat}
                            opponentNames={Object.fromEntries([
                                ...seatedOpponentIds.map(id => [id, `⚔️ ${getPlayerName(id)}`]),
                                ...seatedOpponentIds.flatMap(id =>
                                    [...(opponentStates[id]?.battlefieldLower||[]),...(opponentStates[id]?.battlefieldUpper||[])]
                                        .filter(c => getCardZoneType(c) === 'planeswalker')
                                        .map(pw => [`pw_${pw.instanceId}_${id}`, `🌟 ${pw.name}`])
                                )
                            ])}
                            blockerMap={combatState?.blockerMap}
                            combatState={combatState}
                            getPlayerName={getPlayerName}
                            onToast={addToast}
                        />
                    )}
                    {combatState?.phase === 'blocking' && combatState.attackerId !== user.uid && (
                        <CombatOverlay mode="blocking"
                            attackers={combatState.attackers||[]}
                            myCreatures={[...(myState.battlefieldLower||[]),...(myState.battlefieldUpper||[])].filter(c=>isCreatureLike(c))}
                            pendingBlocker={pendingBlocker}
                            onToggleBlocker={(c) => setPendingBlocker(prev => prev?.instanceId === c.instanceId ? null : c)}
                            onAssignBlock={assignBlock}
                            onPassPriority={passPriority}
                            onEndCombat={endCombat}
                            opponentNames={{}}
                            blockerMap={combatState?.blockerMap}
                            combatState={{ ...combatState, myUid: user.uid }}
                            onToast={addToast}
                        />
                    )}
                    {combatState?.phase === 'resolving' && combatState.attackerId === user.uid && (!phase || curStep === 'combat_damage') && (
                        <CombatOverlay mode="resolving"
                            attackers={combatState.attackers||[]}
                            onResolveCombat={resolveCombat}
                            onEndCombat={endCombat}
                            opponentNames={Object.fromEntries(seatedOpponentIds.map(id => [id, getPlayerName(id)]))}
                            blockerMap={combatState?.blockerMap}
                            combatState={{ ...combatState, myUid: user.uid }}
                            getPlayerName={getPlayerName}
                        />
                    )}
                    
                    {/* --- MULLIGAN / PREGAME / START-GAME FLOW --- */}
                    {/* The mulligan step only begins once seating has been assigned (table is full). */}
                    {lobbyState?.seatOrder && !myMulliganCompleted && (
                        <MulliganModal 
                            hand={myState.hand}
                            seatNumber={mySeatNumber}
                            cardsToBottom={cardsToBottom}
                            isBottoming={bottomingCards !== null}
                            bottomingSelection={bottomingCards || []}
                            onToggleBottomSelection={(id) => setBottomingCards(prev => 
                                prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
                            )}
                            onMulligan={takeMulligan}
                            onKeep={keepHand}
                            onConfirmBottom={() => confirmBottomCards(bottomingCards)}
                            onHoverCard={(url) => setHoveredCard(url)}
                            onLeaveCard={() => setHoveredCard(null)}
                        />
                    )}
                    {myMulliganCompleted && everyoneMulliganDone && typeof lobbyState?.pregameAction?.[user.uid] !== 'boolean' && (
                        <PregameActionModal onAnswer={submitPregameAction} candidates={pregameCandidates} hand={myState.hand || []}
                            onPerform={performPregameAction} onExileFromHand={pregameExileFromHand} isStartingPlayer={lobbyState?.activePlayer === user.uid} />
                    )}
                    {amIFirstPlayer && everyoneMulliganDone && everyonePregameDone && !startGameModalDismissed && (
                        <StartGameModal 
                            pregameAnswers={allPlayersSeated.map(uid => ({ uid, hasAction: lobbyState.pregameAction[uid] }))}
                            getPlayerName={getPlayerName}
                            onDismiss={() => setStartGameModalDismissed(true)}
                        />
                    )}
                    {cmdPendingShown.length > 0 && (() => {
                        const entry = cmdPendingShown[0];
                        const card = (myState[entry.zone] || []).find(c => c.instanceId === entry.instanceId);
                        return <CommanderChoiceModal key={entry.instanceId} entry={entry} card={card} onChoose={(toCmd) => resolveCmdChoice(entry, toCmd)} />;
                    })()}
                    {(() => {
                        const myCreatures = [
                            ...(myState.battlefieldLower || []).filter(c => /\bCreature\b/i.test(c.type_line || '') || (c.isToken && c.p_t)).map(card => ({ card, zone: 'battlefieldLower' })),
                            ...(myState.battlefieldUpper || []).filter(c => /\bCreature\b/i.test(c.type_line || '') || (c.isToken && c.p_t)).map(card => ({ card, zone: 'battlefieldUpper' }))
                        ];
                        return (
                            <>
                                {auraAttachPrompt && (
                                    <AuraAttachModal 
                                        tokenSpec={auraAttachPrompt}
                                        myCreatures={myCreatures}
                                        onAttach={(card, zone) => attachAuraToken(auraAttachPrompt, card, zone)}
                                        onCancel={() => setAuraAttachPrompt(null)}
                                    />
                                )}
                                <EmblemModal 
                                    isOpen={emblemModalOpen}
                                    onClose={() => setEmblemModalOpen(false)}
                                    emblems={myEmblems}
                                    onCreate={(name, customText) => createEmblem(name, customText)}
                                    onAdvance={advanceEmblem}
                                    onRingAdvance={(emblem) => { setEmblemModalOpen(false); setRingAdvancePrompt(emblem); }}
                                />
                                {ringAdvancePrompt && (
                                    <RingBearerModal 
                                        myCreatures={myCreatures}
                                        currentBearerId={ringAdvancePrompt.ringBearerInstanceId}
                                        onChoose={(creatureInstanceId) => advanceRingWithBearer(ringAdvancePrompt.instanceId, creatureInstanceId)}
                                        onSkip={() => advanceRingWithBearer(ringAdvancePrompt.instanceId, null)}
                                    />
                                )}
                                {discardModal && myState.hand.length > 7 && (
                                    <DiscardModal
                                        hand={myState.hand}
                                        onDiscard={(ids) => {
                                            const discarded = myState.hand.filter(c => ids.includes(c.instanceId));
                                            const remaining = myState.hand.filter(c => !ids.includes(c.instanceId));
                                            if (discarded.length) logEvent(`wirft ${discarded.map(cardName).join(', ')} ab`, discarded);
                                            updateMyState({
                                                hand: remaining,
                                                graveyard: [...discarded, ...(myState.graveyard || [])]
                                            });
                                            setDiscardModal(false);
                                            doEndTurn();
                                        }}
                                    />
                                )}
                                {libraryActionModal && (
                                    <LibraryActionModal
                                        mode={libraryActionModal.mode}
                                        cards={libraryActionModal.cards}
                                        onResolve={resolveLibraryAction}
                                        onCancel={() => setLibraryActionModal(null)}
                                    />
                                )}
                                {crewModal && (
                                    <CrewModal
                                        modal={crewModal}
                                        myBattlefield={[...(myState.battlefieldLower||[]),...(myState.battlefieldUpper||[])]}
                                        onCrew={resolveCrew}
                                        onCancel={() => setCrewModal(null)}
                                    />
                                )}
                                {landETBModal && (
                                    <LandETBModal
                                        modal={landETBModal}
                                        myBattlefield={[...(myState.battlefieldLower||[]),...(myState.battlefieldUpper||[])]}
                                        myHand={myState.hand}
                                        myLandCount={[...(myState.battlefieldLower||[]),...(myState.battlefieldUpper||[])].filter(isLand).length}
                                        myBasicCount={[...(myState.battlefieldLower||[]),...(myState.battlefieldUpper||[])].filter(c => /\bBasic\b/i.test(c.type_line||'')).length}
                                        onResolve={(tapped, extra={}) => resolveLandETB(tapped, extra)}
                                        onCancel={() => setLandETBModal(null)}
                                    />
                                )}
                                {fetchModal && (
                                    <FetchModal
                                        fetchCard={fetchModal.card}
                                        ability={fetchModal.ability}
                                        targets={fetchModal.targets}
                                        onResolve={(selected) => resolveFetch(fetchModal.card, fetchModal.zone, fetchModal.ability, selected)}
                                        onCancel={() => setFetchModal(null)}
                                    />
                                )}
                                {/* Trigger ordering modal — shown when multiple triggers fire simultaneously */}
                                {pendingTriggers.length > 0 && ReactDOM.createPortal(
                                    <div className="fixed inset-0 z-[500] flex items-center justify-center bg-black/85 backdrop-blur-sm p-4">
                                        <div className="bg-gray-900 border-2 border-yellow-500 rounded-xl shadow-2xl p-5 max-w-lg w-full">
                                            <h3 className="text-yellow-400 font-bold text-lg mb-1">⚡ Mehrere Trigger</h3>
                                            <p className="text-gray-400 text-sm mb-4">Reihenfolge ziehen, dann bestätigen. Sie kommen von oben nach unten auf den Stack.</p>
                                            <div className="flex flex-col gap-2 mb-4">
                                                {pendingTriggers.map((tr, i) => (
                                                    <div key={i} className="flex items-center gap-3 bg-gray-800 rounded-lg p-3 border border-gray-700">
                                                        <span className="text-yellow-400 font-bold text-sm w-5">{i + 1}</span>
                                                        {tr.sourceCard?.image_url && <img src={tr.sourceCard.image_url} className="w-8 h-11 rounded" alt={tr.source} />}
                                                        <div>
                                                            <div className="text-white text-sm font-bold">{tr.source}</div>
                                                            <div className="text-gray-400 text-xs">{tr.effect === 'draw' ? `Draw ${tr.amount}` : tr.effect === 'gain_life' ? `+${tr.amount} life` : tr.effect === 'damage_each_opp' ? `${tr.amount} dmg to each opp` : tr.text || tr.effect}</div>
                                                        </div>
                                                        <div className="ml-auto flex gap-1">
                                                            {i > 0 && <button onClick={() => setPendingTriggers(p => { const n=[...p]; [n[i-1],n[i]]=[n[i],n[i-1]]; return n; })} className="text-gray-400 hover:text-white text-xs px-2 py-1 bg-gray-700 rounded">↑</button>}
                                                            {i < pendingTriggers.length-1 && <button onClick={() => setPendingTriggers(p => { const n=[...p]; [n[i],n[i+1]]=[n[i+1],n[i]]; return n; })} className="text-gray-400 hover:text-white text-xs px-2 py-1 bg-gray-700 rounded">↓</button>}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                            <div className="flex justify-end gap-2">
                                                <button onClick={() => setPendingTriggers([])} className="bg-gray-700 hover:bg-gray-600 text-white px-4 py-2 rounded text-sm">Abbrechen</button>
                                                <button onClick={() => { pushTriggersOntoStack(pendingTriggers); setPendingTriggers([]); }} className="bg-yellow-600 hover:bg-yellow-500 text-white font-bold px-4 py-2 rounded text-sm">Auf den Stack →</button>
                                            </div>
                                        </div>
                                    </div>,
                                    (document.getElementById('arena-portal') || document.body)
                                )}
                            </>
                        );
                    })()}

                    {/* --- SHARED STACK ZONE --- */}
                    {/* Non-land cards played from hand land here first (visible to everyone, like a spell
                        on the stack at a real table) until the owner manually resolves them onto a
                        battlefield/graveyard/exile. This is what lets effects like "its controller creates a
                        token" or "they create a token" be resolved correctly by hand, instead of the tool
                        guessing who a token's controller should be.
                        The stack is LIFO: allStackCards[0] is the most recently added card and sits on TOP -
                        it's the only one that can be resolved right now. Anything underneath (a reactive
                        response was cast in response to it, or it's simply older) has to wait its turn,
                        exactly like a real Magic stack. */}
                    {allStackCards.length > 0 && (
                        <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[90] bg-gray-900/95 border-2 border-purple-500/60 rounded-xl shadow-2xl p-4 max-w-[95vw] max-h-[85vh] overflow-y-auto">
                            <h4 className="text-purple-300 text-xs font-bold uppercase tracking-wide mb-3 text-center">
                                Stack {allStackCards.length > 1 ? `(${allStackCards.length} - resolve top first)` : ''}
                            </h4>
                            <div className="flex flex-col items-center gap-2">
                                {allStackCards.map((entry, index) => {
                                    const isTopOfStack = index === 0;
                                    return (
                                        <div 
                                            key={entry.instanceId} 
                                            className={`flex flex-col items-center gap-1 p-2 rounded-lg transition-all ${
                                                isTopOfStack
                                                    ? entry.isTrigger
                                                        ? 'bg-yellow-900/40 border-2 border-yellow-400 scale-105'
                                                        : 'bg-purple-900/40 border-2 border-purple-400 scale-105'
                                                    : 'bg-gray-800/40 border border-gray-600 opacity-60'
                                            }`}
                                        >
                                            <div className="flex items-center gap-3">
                                                <span className="text-purple-300 text-xs font-bold w-6 text-center">
                                                    {isTopOfStack ? '\u25B2' : index + 1}
                                                </span>
                                                <img 
                                                    src={entry.card.image_url} 
                                                    alt={entry.card.name}
                                                    className="w-20 rounded shadow-lg border border-purple-400 cursor-pointer"
                                                    draggable={isTopOfStack && entry.ownerId === user.uid && isAuraCard(entry.card)}
                                                    onDragStart={(e) => { if (isTopOfStack && entry.ownerId === user.uid && isAuraCard(entry.card)) handleDragStart(e, entry.card, 'stack'); }}
                                                    onMouseEnter={() => setHoveredCard(entry.card.image_url)}
                                                    onMouseLeave={() => setHoveredCard(null)}
                                                    onContextMenu={(e) => {
                                                        if (!isTopOfStack || entry.ownerId !== user.uid) return; // Only the top card, and only your own entries
                                                        e.preventDefault();
                                                        setCardMenu({ x: e.clientX, y: e.clientY, card: entry.card, zone: 'stack' });
                                                    }}
                                                />
                                                <div className="flex flex-col gap-1">
                                                    <span className="text-[10px] text-gray-400">{entry.ownerName}</span>
                                                    {entry.isTrigger && entry.triggerText && (
                                                        <p data-testid="stack-trigger-text" className="text-[10px] text-yellow-200 max-w-[260px] leading-snug">⚡ {entry.triggerText}</p>
                                                    )}
                                                    {!isTopOfStack && (
                                                        <span className="text-[9px] text-yellow-500 font-bold uppercase">Warte …</span>
                                                    )}
                                                    {isTopOfStack && isAuraCard(entry.card) && entry.ownerId === user.uid && (
                                                        <p className="text-[9px] text-purple-300">Auf eine Kreatur ziehen</p>
                                                    )}
                                                    {isTopOfStack && entry.ownerId === user.uid && (
                                                        <div className="flex flex-wrap gap-1">
                                                            {entry.isTrigger ? (
                                                                // Triggered ability — just a Resolve button
                                                                <button onClick={() => resolveStackTrigger(entry)} className="bg-green-700 hover:bg-green-600 text-white text-[9px] font-bold py-0.5 px-1.5 rounded">⚡ Trigger auflösen</button>
                                                            ) : (
                                                                <>
                                                                    {!isLand(entry.card) && (
                                                                        <>
                                                                            {!/\b(Instant|Sorcery)\b/i.test((entry.card?.type_line || '').split(' // ')[0]) && <button onClick={() => moveStackCardToBattlefield(entry, 'lower')} className="bg-blue-600 hover:bg-blue-500 text-white text-[9px] font-bold py-0.5 px-1.5 rounded">Aufs Spielfeld</button>}
                                                                            <button onClick={() => moveStackCardToMyZone(entry, 'graveyard')} className="bg-gray-600 hover:bg-gray-500 text-white text-[9px] font-bold py-0.5 px-1.5 rounded">In den Friedhof</button>
                                                                            <button onClick={() => moveStackCardToMyZone(entry, 'exile')} className="bg-gray-700 hover:bg-gray-600 text-white text-[9px] font-bold py-0.5 px-1.5 rounded">Ins Exil</button>
                                                                        </>
                                                                    )}
                                                                    <button onClick={() => returnStackCardToHand(entry)} className="bg-red-700 hover:bg-red-600 text-white text-[9px] font-bold py-0.5 px-1.5 rounded" title="Diese Karte auf die Hand nehmen">Auf die Hand</button>
                                                                </>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {hoveredCard && (() => {
                        const imgs = Array.isArray(hoveredCard) ? hoveredCard : [hoveredCard];
                        const PREVIEW_W = 256 * imgs.length + 8 * (imgs.length - 1); // matches w-64 je Seite
                        const PREVIEW_H = 350; // matches h-[350px]
                        const OFFSET = 20; // gap between cursor and preview
                        // Default: place it up and to the right of the cursor. Clamp so it never runs off-screen.
                        let left = mousePos.x + OFFSET;
                        let top = mousePos.y - PREVIEW_H - OFFSET;
                        if (left + PREVIEW_W > window.innerWidth) left = mousePos.x - PREVIEW_W - OFFSET; // flip to the left of the cursor
                        if (left < 0) left = 8;
                        if (top < 0) top = mousePos.y + OFFSET; // flip below the cursor if there's no room above
                        if (top + PREVIEW_H > window.innerHeight) top = window.innerHeight - PREVIEW_H - 8;
                        return (
                            <div data-testid="card-preview" className="fixed pointer-events-none flex gap-2" style={{ left, top, zIndex: 10050 }}>
                                {imgs.map((src, i) => (
                                    <div key={i} className="w-64 h-[350px] rounded-xl overflow-hidden shadow-2xl border-2 border-solid border-yellow-500 bg-black">
                                        <img src={src} className="w-full h-full object-contain" />
                                    </div>
                                ))}
                            </div>
                        );
                    })()}
                    <TokenModal 
                        isOpen={isTokenModalOpen} 
                        onClose={() => setTokenModalOpen(false)} 
                        onCreate={(targetPlayerId, tokenSpec) => requestTokenForPlayer(targetPlayerId, tokenSpec)}
                        seatedPlayers={allPlayersSeated}
                        getPlayerName={getPlayerName}
                        myUid={user.uid}
                    />
                    {cardMenu && (
                        <ContextMenu 
                            x={cardMenu.x} y={cardMenu.y} 
                            onClose={() => setCardMenu(null)}
                            options={generateCardOptions(cardMenu.card, cardMenu.zone)} 
                        />
                    )}
                    {libraryMenu && (
                        <ContextMenu 
                            x={libraryMenu.x} y={libraryMenu.y} 
                            onClose={() => setLibraryMenu(null)}
                            options={[
                                { label: 'Karte ziehen', action: drawCard },
                                { label: 'Oberste Karte ansehen', action: () => { if(myState.library.length>0) setTopCardView(myState.library[0]); } },
                                { label: 'Hellsicht …', submenu: [1,2,3,4,5,7,10].map(n => ({ label: `Hellsicht ${n}`, action: () => { openLibraryAction('scry', n); setLibraryMenu(null); } })) },
                                { label: 'Überwachen …', submenu: [1,2,3,4,5,7,10].map(n => ({ label: `Überwachen ${n}`, action: () => { openLibraryAction('surveil', n); setLibraryMenu(null); } })) },
                                { label: 'Oberste X ansehen …', submenu: [2,3,4,5,6,7,10,15].map(n => ({ label: `Oberste ${n} ansehen`, action: () => { openLibraryAction('look', n); setLibraryMenu(null); } })) },
                                { label: 'Karten millen …', action: () => { setLibraryMenu(null); setMillPrompt({ n: 1 }); } },
                                { label: 'Bibliothek mischen', action: shuffleLibrary },
                                { label: 'Ganze Bibliothek ansehen', action: () => setViewingZone('library') }
                            ]} 
                        />
                    )}

                    {millPrompt && (
                        <Modal isOpen={true} onClose={() => setMillPrompt(null)} title="Karten millen">
                            <form data-testid="mill-modal" className="flex flex-col items-center gap-4" onSubmit={(e) => { e.preventDefault(); const n = Math.max(1, Math.min(20, parseInt(millPrompt.n) || 1)); setMillPrompt(null); millCards(n); }}>
                                <p className="text-gray-300 text-sm m-0">Wie viele Karten von oben in den Friedhof legen? (1–20)</p>
                                <div className="flex items-center gap-2">
                                    <button type="button" onClick={() => setMillPrompt(p => ({ n: Math.max(1, (parseInt(p.n) || 1) - 1) }))} className="w-8 h-8 rounded-full bg-gray-700 hover:bg-gray-600 text-white font-bold border-0">−</button>
                                    <input autoFocus type="number" min={1} max={20} value={millPrompt.n} onChange={(e) => setMillPrompt({ n: e.target.value })}
                                        className="w-20 text-center text-lg font-bold bg-gray-900 text-yellow-300 border-solid border border-yellow-700/70 rounded px-2 py-1" />
                                    <button type="button" onClick={() => setMillPrompt(p => ({ n: Math.min(20, (parseInt(p.n) || 0) + 1) }))} className="w-8 h-8 rounded-full bg-gray-700 hover:bg-gray-600 text-white font-bold border-0">+</button>
                                </div>
                                <div className="flex gap-3">
                                    <button type="button" onClick={() => setMillPrompt(null)} className="bg-gray-600 hover:bg-gray-500 px-4 py-2 rounded text-white border-0">Abbrechen</button>
                                    <button type="submit" className="bg-yellow-600 hover:bg-yellow-500 px-4 py-2 rounded text-gray-950 font-bold border-0">Millen</button>
                                </div>
                            </form>
                        </Modal>
                    )}

                    {topCardView && (
                        <Modal isOpen={true} onClose={() => setTopCardView(null)} title="Oben auf die Bibliothek">
                            <div className="flex flex-col items-center gap-4">
                                <img src={topCardView.image_url} className="w-48 rounded-xl shadow-lg" />
                                <div className="flex gap-4">
                                    <button onClick={() => { setTopCardView(null); }} className="bg-blue-600 px-4 py-2 rounded text-white">Oben lassen</button>
                                    <button onClick={() => { moveCardToZone(topCardView, 'library_bottom'); setTopCardView(null); }} className="bg-yellow-600 px-4 py-2 rounded text-white">Unter die Bibliothek</button>
                                    <button onClick={() => { playCard(topCardView, 'library_top', 'lower'); setTopCardView(null); }} className="bg-green-600 px-4 py-2 rounded text-white">Spielen</button>
                                </div>
                            </div>
                        </Modal>
                    )}

                    {viewingZone && (() => {
                        const isOpp = viewingZone.playerId && viewingZone.playerId !== user.uid;
                        const zoneName = viewingZone.zone || viewingZone;
                        const oppName = isOpp ? getPlayerName(viewingZone.playerId) : '';
                        const cards = isOpp
                            ? (opponentStates[viewingZone.playerId]?.[zoneName] || [])
                            : (myState[zoneName] || []);
                        const ZT = { graveyard: ['Dein Friedhof', 'Friedhof von'], exile: ['Dein Exil', 'Exil von'], library: ['Bibliothek', 'Bibliothek von'], hand: ['Hand', 'Hand von'] };
                        const title = isOpp ? `${(ZT[zoneName] || [zoneName, zoneName + ' von'])[1]} ${oppName}` : (ZT[zoneName] || [zoneName])[0];
                        const btn = 'w-[88%] px-2 py-0.5 rounded text-[11px] font-bold text-white border-0 cursor-pointer';
                        const pub = zoneName === 'graveyard' || zoneName === 'exile';
                        return (
                            <Modal isOpen={true} onClose={() => setViewingZone(null)} title={`${title} (${cards.length})`}>
                                <div className="grid grid-cols-4 gap-4" data-testid="zone-viewer" data-zone-name={zoneName}>
                                    {cards.map((card, idx) => (
                                        <div key={card.instanceId || idx} className="relative group" data-card-name={cardName(card)}
                                            onMouseEnter={() => setHoveredCard(previewOf(card))} onMouseLeave={() => setHoveredCard(null)}>
                                            <img src={card.image_url} alt={cardName(card)} className="w-full rounded-lg shadow-lg" style={{ minHeight: 60, background: '#1f2937' }} />
                                            {!card.image_url && <div className="absolute inset-x-0 top-2 text-center text-[11px] text-gray-300 px-1">{cardName(card)}</div>}
                                            {!isOpp && (
                                                <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 touch-show flex flex-col items-center justify-center gap-1 transition-opacity">
                                                    <button onClick={() => { setHoveredCard(null); playFromZone(card, zoneName); }} className={`${btn} bg-green-600 hover:bg-green-500`} title={isLand(frontFace(card)) ? 'Als Land spielen' : 'Wirken – auf den Stack'}>Spielen</button>
                                                    <button onClick={() => { setHoveredCard(null); putOntoBattlefield(card, zoneName); }} className={`${btn} bg-blue-600 hover:bg-blue-500`} title="Direkt aufs Spielfeld (ohne Stack)">Aufs Spielfeld</button>
                                                    {zoneName !== 'hand' && <button onClick={() => moveCardToZone(card, 'hand')} className={`${btn} bg-gray-600 hover:bg-gray-500`}>Auf die Hand</button>}
                                                    {zoneName === 'library'
                                                        ? <button onClick={() => { moveCardToZone(card, 'library_top'); setViewingZone(null); }} className={`${btn} bg-yellow-600 hover:bg-yellow-500`}>Oben</button>
                                                        : <>
                                                            <button onClick={() => moveCardToZone(card, 'library_top')} className={`${btn} bg-yellow-700 hover:bg-yellow-600`}>Oben auf die Bibliothek</button>
                                                            <button onClick={() => moveCardToZone(card, 'library_bottom')} className={`${btn} bg-yellow-800 hover:bg-yellow-700`}>Unter die Bibliothek</button>
                                                        </>}
                                                    {zoneName === 'graveyard' && <button onClick={() => moveCardToZone(card, 'exile')} className={`${btn} bg-gray-700 hover:bg-gray-600`}>Ins Exil</button>}
                                                    {zoneName === 'exile' && <button onClick={() => moveCardToZone(card, 'graveyard')} className={`${btn} bg-gray-700 hover:bg-gray-600`}>In den Friedhof</button>}
                                                </div>
                                            )}
                                            {isOpp && pub && (
                                                <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 touch-show flex flex-col items-center justify-center gap-1 transition-opacity">
                                                    <button onClick={() => { setHoveredCard(null); setViewingZone(null); reanimateFrom(card, viewingZone.playerId, zoneName); }} className={`${btn} bg-purple-700 hover:bg-purple-600`} title={`Unter deine Kontrolle; ${oppName} bleibt Besitzer`}>Aufs eigene Spielfeld (reanimieren)</button>
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                    {cards.length === 0 && <p className="col-span-4 text-gray-400 text-center py-8">Leer</p>}
                                </div>
                            </Modal>
                        );
                    })()}

                    {leaveGameModal && (
                        <Modal isOpen={true} onClose={() => setLeaveGameModal(false)} title="Spielergebnis">
                            {/* --- REFACTOR: Read gameResult from lobbyState --- */}
                            {!lobbyState?.gameResult?.submittedBy ? (
                                <div className="flex flex-col items-center gap-4">
                                    <p className="text-white text-lg">Wer hat gewonnen?</p>
                                    <div className="flex flex-wrap justify-center gap-3">
                                        <button onClick={() => { submitGameResult(user.uid); }} className="bg-green-600 hover:bg-green-500 px-6 py-3 rounded text-white font-bold">Ich habe gewonnen</button>
                                        {opponentIds.map(oppId => (
                                            <button key={oppId} onClick={() => { submitGameResult(oppId); }} className="bg-red-600 hover:bg-red-500 px-6 py-3 rounded text-white font-bold">{getPlayerName(oppId)} hat gewonnen</button>
                                        ))}
                                        <button onClick={() => { submitGameResult('draw'); }} className="bg-gray-600 hover:bg-gray-500 px-6 py-3 rounded text-white font-bold">Unentschieden</button>
                                    </div>
                                    <button onClick={() => { setLeaveGameModal(false); onLeave(); }} className="text-gray-400 hover:text-gray-200 text-sm underline">Ohne Wertung verlassen</button>
                                </div>
                            ) : lobbyState.gameResult.submittedBy === user.uid ? (
                                <div className="flex flex-col items-center gap-4">
                                    <p className="text-white text-lg">Warte, bis der Tisch das Ergebnis bestätigt …</p>
                                    <div className="loader"></div>
                                    <button onClick={() => { updateDoc(roomRef, { gameResult: null }).catch(console.error); }} className="text-gray-400 hover:text-gray-200 text-sm underline">Meldung zurückziehen</button>
                                </div>
                            ) : (
                                <div className="flex flex-col items-center gap-4">
                                    <p className="text-white text-lg">
                                        {gameResult.winner === user.uid ? 'Du hast gewonnen!' : 
                                         gameResult.winner === 'draw' ? 'Unentschieden' :
                                         `${getPlayerName(gameResult.winner)} hat gewonnen!`}
                                    </p>
                                    <p className="text-gray-400">Bestätigst du dieses Ergebnis?</p>
                                    <div className="flex gap-4">
                                        <button onClick={confirmGameResult} className="bg-green-600 hover:bg-green-500 px-6 py-3 rounded text-white font-bold">Bestätigen</button>
                                        <button onClick={() => { setLeaveGameModal(false); updateDoc(roomRef, { gameResult: null }).catch(console.error); }} className="bg-red-600 hover:bg-red-500 px-6 py-3 rounded text-white font-bold">Widersprechen</button>
                                    </div>
                                </div>
                            )}
                        </Modal>
                    )}

                    {/* --- BOTTOM ZONE (MY BATTLEFIELD) ---
                        Now a flat 50% of the screen for both the 2-player and 3-4-player layouts - the old
                        shared middle zone is gone, so battlefieldUpper and battlefieldLower both render here
                        together as ONE unified drop zone (cards dropped here always land in battlefieldLower;
                        battlefieldUpper is still rendered for any cards already there from before this change
                        or from other code paths, but there's no separate upper drop target anymore). */}
                    {/* ── MY HALF ─────────────────────────────────────────────────────────
                         This wrapper owns the bottom 50% of the screen. Everything inside
                         (battlefield, hand, sidebars) uses absolute positioning relative to
                         THIS div, so top:0 = my top edge, bottom:0 = screen bottom.       */}
                    <div data-testid="my-half" style={{ position: 'absolute', top: '50%', bottom: 0, left: 0, right: 0, boxShadow: activePlayerId === user.uid ? ACTIVE_RING : undefined }}
                        className={`transition-all duration-200 ${activePlayerId === user.uid ? 'bg-green-900/10' : 'bg-gray-900/20'}`}
                    >
                        {/* Battlefield drop surface */}
                        <div 
                            ref={playerLowerBattlefieldRef}
                            className="absolute inset-0"
                            style={{ zIndex: 0 }}
                            onDrop={(e) => handleDropOnBattlefield(e, 'lower', playerLowerBattlefieldRef)}
                            onDragOver={(e) => e.preventDefault()}
                        >
                            {myGeom && (
                                <div className="absolute inset-0 pointer-events-none z-0">
                                    {Object.entries(myGeom.zones).map(([t, z]) => (
                                        <div key={t} data-zone={t} style={{ position: 'absolute', left: z.left, width: z.right - z.left, top: z.top, height: myGeom.ch, border: `1px dashed ${z.color}`, borderRadius: 3, pointerEvents: 'none' }}>
                                            <span style={{ fontSize: 9, fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '0.05em', opacity: 0.5, whiteSpace: 'nowrap', position: 'absolute', top: 2, right: 4, color: z.text }}>{z.label}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                            {(myState.battlefieldLower || []).map(card => renderBattlefieldCard(card, 'battlefieldLower', true, myLayout[card.instanceId], myGeom))}
                            {(myState.battlefieldUpper || []).map(card => renderBattlefieldCard(card, 'battlefieldUpper', true, myLayout[card.instanceId], myGeom))}
                        </div>

                        {/* Phasenleiste – oben in meiner Hälfte zwischen den Seitenleisten. Zeigt die Phase des AKTIVEN
                            Spielers; steuern darf nur er (oder jeder, wenn er den Tisch verlassen hat). */}
                        <div style={{ position: 'absolute', top: PHASE_BAR_TOP, left: 240, right: 240, height: PHASE_BAR_H, zIndex: 45 }}
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={(e) => handleDropOnBattlefield(e, 'lower', playerLowerBattlefieldRef)}
                        >
                            <PhaseBar
                                step={curStep}
                                ownerName={activePlayerId && activePlayerId !== user.uid ? activeName : null}
                                canControl={canControlPhase}
                                lockTitle={!mayControlTurn ? `Nur ${activeName} kann die Phase wechseln` : holdTitle}
                                onJump={jumpToStep}
                                onNext={nextStep}
                                nextDisabled={nextInfo.disabled}
                                nextTitle={`${nextInfo.title} (Leertaste)`}
                                flash={phaseFlash}
                                extra={
                                    hold ? (
                                        iHold
                                            ? <button onClick={releaseHold} title="Haltebitte aufheben – der aktive Spieler kann weitermachen (X)" className="flex-shrink-0 px-2 h-5 rounded border-0 font-bold whitespace-nowrap bg-yellow-600 hover:bg-yellow-500 text-gray-950">Weiter geben</button>
                                            : (
                                                <span className="flex items-center gap-1 flex-shrink-0 whitespace-nowrap">
                                                    <span className="text-yellow-300 font-bold timer-warning" title={holdTitle}>✋ {hold.name || getPlayerName(hold.uid)}</span>
                                                    {mayControlTurn && <button onClick={releaseHold} title={`${holdTitle} – trotzdem fortsetzen (z. B. wenn niemand reagiert) (X)`} className="px-1.5 h-5 rounded border-solid border border-yellow-700/60 bg-gray-900 hover:bg-gray-800 text-yellow-300">Fortsetzen</button>}
                                                </span>
                                            )
                                    ) : (!mayControlTurn && activePlayerId && (
                                        <button onClick={requestHold} title={`${activeName} bitten, kurz anzuhalten – du möchtest reagieren (X)`} className="flex-shrink-0 px-2 h-5 rounded border-solid border border-yellow-700/60 bg-gray-900 hover:bg-gray-800 text-yellow-300 whitespace-nowrap">✋ Moment!</button>
                                    ))
                                }
                            />
                        </div>

                        {/* ── PLAYER UI OVERLAYS ─────────────────────────────────────── */}

                        {/* Hand — a tab centered on the bottom edge between the two sidebars. When open, the
                            hand panel sits directly below the tab (the tab stays on top of the panel). The
                            wrapper spans the free width between the sidebars (8px margin + w-56 + 8px gap each
                            side) and lets clicks through; only the tab and the panel catch the mouse. */}
                        <div style={{ position: 'absolute', bottom: 0, left: 240, right: 240 }} className="z-50 flex flex-col items-center pointer-events-none">
                            <button
                                onClick={() => setMyHandMinimized(!myHandMinimized)}
                                onDragOver={(e) => e.preventDefault()}
                                onDrop={(e) => handleDropOnZone(e, 'hand')}
                                title={myHandMinimized ? 'Hand zeigen (H)' : 'Hand verbergen (H)'}
                                className={`pointer-events-auto bg-gray-900/90 hover:bg-gray-800 backdrop-blur-sm border-solid border-0 border-t border-x border-yellow-700/60 rounded-t-lg px-4 py-0.5 flex items-center gap-2 text-yellow-400 font-bold text-xs shadow-lg transition-colors ${myHandMinimized ? 'border-b' : ''}`}
                            >
                                <span>{myHandMinimized ? '▲' : '▼'}</span>
                                <span>Hand ({myState.hand.length})</span>
                            </button>
                            {!myHandMinimized && (
                                <div className="pointer-events-auto bg-gray-900/90 backdrop-blur-sm px-4 py-2 rounded-t-lg border-t border-x border-yellow-700/50 relative shadow-xl max-w-full min-w-[200px]"
                                    ref={myHandZoneRef}
                                    onDrop={(e) => handleDropOnZone(e, 'hand')}
                                    onDragOver={(e) => e.preventDefault()}
                                >
                                    <div className="flex gap-2 items-center h-[18vh] overflow-x-auto" style={{ scrollbarWidth:'thin', scrollbarColor:'rgba(99,102,241,0.5) rgba(30,27,75,0.3)' }}>
                                        <div className="flex overflow-x-visible gap-2 h-full flex-grow items-center" style={{ minWidth: 'max-content' }}>
                                            {myState.hand.map(card => (
                                                <div
                                                    key={card.instanceId}
                                                    draggable
                                                    onDragStart={(e) => handleDragStart(e, card, 'hand')}
                                                    className="relative group/handcard cursor-pointer flex-shrink-0"
                                                >
                                                    <CardImage
                                                        src={card.image_url}
                                                        style={{ width: 'calc((18vh - 8px) * 0.714)', height: 'calc(18vh - 8px)' }}
                                                        className="group-hover/handcard:brightness-110 transition-[filter]"
                                                        onMouseEnter={() => setHoveredCard(previewOf(card))}
                                                        onMouseLeave={() => setHoveredCard(null)}
                                                    />
                                                    {landBackIdx(card) != null ? (
                                                        <div className="absolute bottom-1 inset-x-1 flex flex-col gap-0.5 opacity-0 group-hover/handcard:opacity-100 touch-show transition-opacity">
                                                            <button
                                                                onClick={(e) => { e.stopPropagation(); playCardFromHand(card); }}
                                                                className="w-full bg-green-600 hover:bg-green-500 text-white text-[10px] font-bold py-0.5 rounded shadow-lg"
                                                                title={isLand(card) ? `${card.card_faces[0].name} als Land spielen` : `${card.card_faces[0].name} auf den Stack legen`}
                                                            >Spielen</button>
                                                            <button
                                                                onClick={(e) => { e.stopPropagation(); playLandFace(card, 1); }}
                                                                className="w-full bg-yellow-700 hover:bg-yellow-600 text-white text-[10px] font-bold py-0.5 rounded shadow-lg"
                                                                title={`Rückseite ${card.card_faces[1].name} als Land spielen`}
                                                            >{isLand(card) ? '🌍 Rückseite' : '🌍 Als Land'}</button>
                                                        </div>
                                                    ) : (
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); playCardFromHand(card); }}
                                                        className="absolute bottom-1 inset-x-1 bg-green-600 hover:bg-green-500 text-white text-[10px] font-bold py-1 rounded opacity-0 group-hover/handcard:opacity-100 touch-show transition-opacity shadow-lg"
                                                        title={isLand(card) ? 'Auf dein Spielfeld' : 'Auf den Stack legen'}
                                                    >Spielen</button>
                                                    )}
                                                    {hasFaces(card) && previewOf(card) && Array.isArray(previewOf(card)) && (
                                                        <span className="absolute top-1 right-1 bg-gray-950/80 text-yellow-300 text-[10px] font-bold rounded px-1 opacity-0 group-hover/handcard:opacity-100 touch-show pointer-events-none" title="Doppelseitig – die Vorschau zeigt beide Seiten">↺</span>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Left sidebar — compact console (life, mana, emblems), action row, Commander-Zone.
                            Sized to fit the full height of my half without scrolling (the Commander-Zone card
                            absorbs the remaining height); overflow-y-auto is only a fallback for tiny windows. */}
                        <div ref={myLeftSidebarRef} style={{ position: 'absolute', top: 4, bottom: 4, left: 8 }} className="z-40 w-56 overflow-y-auto scrollbar-hide flex flex-col gap-1.5">
                            {/* Console: Du + turn badge, life, mana pool, emblems */}
                            <div className="bg-gray-900/80 backdrop-blur-sm px-3 py-2 rounded-lg border border-yellow-700/50 flex-shrink-0 shadow-lg">
                                <div className="flex justify-between items-center h-5">
                                    <h4 className="text-blue-400 text-sm font-bold">Du</h4>
                                    {activePlayerId === user.uid && <ActiveTurnBadge />}
                                </div>
                                <div className="flex items-center justify-between my-1">
                                    <button onClick={() => updateMyState({ life: myState.life - 1 })} title="Leben −1 (−)" aria-label="Leben −1" className="w-8 h-8 rounded-full bg-red-700 hover:bg-red-600 border border-solid border-red-500/60 text-white text-lg font-bold leading-none shadow">−</button>
                                    <div className="flex flex-col items-center leading-none">
                                        <span className="text-green-400 font-title font-bold text-3xl">{myState.life}</span>
                                        <span className="text-gray-400 text-[9px] uppercase tracking-wider mt-0.5">Leben</span>
                                    </div>
                                    <button onClick={() => updateMyState({ life: myState.life + 1 })} title="Leben +1 (+)" aria-label="Leben +1" className="w-8 h-8 rounded-full bg-green-700 hover:bg-green-600 border border-solid border-green-500/60 text-white text-lg font-bold leading-none shadow">+</button>
                                </div>
                                <ManaPool compact pool={manaPool} onAdd={addMana} onRemove={removeMana} onClear={clearMana} />
                                {myEmblems.length > 0 && (
                                    <div className="flex gap-1 mt-1.5 overflow-hidden whitespace-nowrap">
                                        {myEmblems.map(e => (
                                            <span key={e.instanceId} className="min-w-0 truncate bg-indigo-700/80 border border-indigo-400 text-indigo-100 text-[10px] font-bold px-1.5 py-0.5 rounded cursor-default" title={`${e.name}: ${e.stage > 0 ? e.stageText[e.stage - 1] : 'Gerade erstellt'}`}>
                                                {e.name} {e.maxStage > 1 ? `${e.stage}/${e.maxStage}` : ''}
                                            </span>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {/* Action row: Weiter (bzw. „Kein Blocker“ als Verteidiger), Zug beenden, ⋯ menu */}
                            <div className="flex gap-1 flex-shrink-0">
                                {myPriorityPending ? (
                                    <button
                                        onClick={passPriority}
                                        title="Kein Blocker / Priorität abgeben (Leertaste)"
                                        aria-label="Kein Blocker"
                                        className="flex-1 min-w-0 truncate px-1 py-1.5 rounded text-[11px] font-bold transition-colors shadow bg-yellow-600 hover:bg-yellow-500 text-white cursor-pointer"
                                    >🛡️ Kein Blocker</button>
                                ) : amDefending ? (
                                    <button disabled title="Du hast gepasst – warte auf den Angreifer" aria-label="Gepasst"
                                        className="flex-1 min-w-0 truncate px-1 py-1.5 rounded text-[11px] font-bold shadow bg-gray-700 text-gray-400 cursor-not-allowed"
                                    >✓ Gepasst</button>
                                ) : (
                                    <button
                                        onClick={nextStep}
                                        disabled={nextInfo.disabled}
                                        title={`${nextInfo.title} (Leertaste)`}
                                        aria-label="Weiter"
                                        className={`flex-1 min-w-0 truncate px-1 py-1.5 rounded text-[11px] font-bold transition-colors shadow ${nextInfo.disabled ? 'bg-gray-700 text-gray-500 cursor-not-allowed' : 'bg-yellow-500 hover:bg-yellow-400 text-gray-950 cursor-pointer'}`}
                                    >{nextInfo.label}</button>
                                )}
                                <button
                                    onClick={endTurn}
                                    disabled={!canEndTurn}
                                    title={!mayControlTurn ? `Nur ${activeName} kann den Zug beenden` : holdBlocksMe ? holdTitle : 'Zug beenden (E)'}
                                    aria-label="Zug beenden"
                                    className={`flex-1 min-w-0 truncate px-1 py-1.5 rounded text-[11px] font-bold transition-colors shadow ${canEndTurn ? 'bg-yellow-700 hover:bg-yellow-600 text-white cursor-pointer' : 'bg-gray-700 text-gray-500 cursor-not-allowed'}`}
                                >⏭ Zug beenden</button>
                                {(() => {
                                    const maxCmdDmg = Math.max(0, ...Object.values(myState.commanderDamage || {}));
                                    return (
                                        <button
                                            ref={myMenuBtnRef}
                                            onClick={toggleMyMenu}
                                            title="Weitere Aktionen"
                                            aria-label="Weitere Aktionen"
                                            aria-expanded={!!myMenuPos}
                                            className={`relative w-8 flex-shrink-0 py-1.5 rounded text-sm font-bold leading-none border border-solid transition-colors shadow ${myMenuPos ? 'bg-gray-800 border-yellow-500 text-yellow-300' : 'bg-gray-900/80 border-yellow-700/50 text-yellow-400 hover:bg-gray-800'}`}
                                        >
                                            ⋯
                                            {maxCmdDmg >= 15 && (
                                                <span title={`Höchster Commander-Schaden: ${maxCmdDmg}`} className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-0.5 rounded-full bg-red-600 text-white text-[9px] font-bold flex items-center justify-center leading-none">{maxCmdDmg}</span>
                                            )}
                                        </button>
                                    );
                                })()}
                            </div>
                            {myMenuPos && ReactDOM.createPortal(
                                <div ref={myMenuRef} role="menu" style={{ position: 'fixed', zIndex: 9999, left: myMenuPos.left, top: myMenuPos.top, width: 180 }}
                                    className="bg-gray-900 border border-solid border-yellow-700/60 rounded-lg shadow-2xl p-1 flex flex-col gap-1"
                                >
                                    <button role="menuitem" onClick={openCmdDmg} className="w-full text-left px-3 py-1.5 rounded text-sm font-bold text-blue-400 bg-transparent border-0 hover:bg-gray-800 transition-colors">Commander-Schaden</button>
                                    <button role="menuitem" onClick={() => { setMyMenuPos(null); setShowKeys(true); }} className="w-full text-left px-3 py-1.5 rounded text-sm font-bold text-yellow-300 bg-transparent border-0 hover:bg-gray-800 transition-colors">Tastenkürzel (?)</button>
                                    <button role="menuitem" onClick={() => { setMyMenuPos(null); handleLeaveGame(); }} className="w-full text-left px-3 py-1.5 rounded text-sm font-bold text-white bg-red-600 hover:bg-red-500 border-0 transition-colors">Spiel verlassen</button>
                                </div>,
                                (document.getElementById('arena-portal') || document.body)
                            )}

                            {/* Commander Damage — rendered via React portal into (document.getElementById('arena-portal') || document.body) to escape
                                the overflow:hidden on the GameSim root div that clips fixed children. Opened from the ⋯ menu. */}
                            {cmdDmgOpen && ReactDOM.createPortal(
                                <div style={{ position: 'fixed', zIndex: 9999, left: cmdDmgPos.left, top: cmdDmgPos.top, width: 260, maxHeight: '45vh', overflowY: 'auto', background: '#111827', border: '2px solid #3b82f6', borderRadius: 8, padding: 12, boxShadow: '0 25px 50px rgba(0,0,0,0.8)', display: 'flex', flexDirection: 'column', gap: 8 }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <span style={{ color: '#60a5fa', fontSize: 11, fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Commander-Schaden</span>
                                        <button onClick={() => setCmdDmgOpen(false)} style={{ color: '#9ca3af', background: 'none', border: 'none', cursor: 'pointer', fontSize: 14 }}>✕</button>
                                    </div>
                                    {seatedOpponentIds.length === 0 && (
                                        <p style={{ color: '#6b7280', fontSize: 11, textAlign: 'center', padding: '8px 0' }}>Noch keine Gegner am Tisch</p>
                                    )}
                                    {seatedOpponentIds.map(oppId => {
                                        const oppState = opponentStates[oppId];
                                        const commanders = oppState ? getCommandersOf(oppState) : [];
                                        if (!oppState) return <p key={oppId} style={{ color: '#9ca3af', fontSize: 11 }}>Warte auf {getPlayerName(oppId)} …</p>;
                                        if (commanders.length === 0) return <p key={oppId} style={{ color: '#9ca3af', fontSize: 11, borderTop: '1px solid #374151', paddingTop: 8 }}>{getPlayerName(oppId)}: Spiel noch nicht gestartet</p>;
                                        return commanders.map(cmdr => {
                                            const dmg = (myState.commanderDamage || {})[cmdr.instanceId] || 0;
                                            return (
                                                <div key={cmdr.instanceId} style={{ borderTop: '1px solid #374151', paddingTop: 8 }}>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                                                        <span style={{ color: 'white', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: 4 }} title={cmdr.name}>{cmdr.name}</span>
                                                        <span style={{ color: dmg >= 21 ? '#f87171' : '#fca5a5', fontWeight: 'bold', flexShrink: 0 }}>{dmg}{dmg >= 21 ? ' ☠' : ''}</span>
                                                    </div>
                                                    <div style={{ display: 'flex', gap: 4 }}>
                                                        <button onClick={() => updateMyState({ commanderDamage: { ...(myState.commanderDamage || {}), [cmdr.instanceId]: dmg + 1 }, life: myState.life - 1 })} style={{ flex: 1, background: '#dc2626', color: 'white', border: 'none', borderRadius: 4, padding: '4px 0', cursor: 'pointer', fontSize: 11 }}>+</button>
                                                        <button onClick={() => { if (dmg > 0) updateMyState({ commanderDamage: { ...(myState.commanderDamage || {}), [cmdr.instanceId]: dmg - 1 }, life: myState.life + 1 }); }} style={{ flex: 1, background: '#16a34a', color: 'white', border: 'none', borderRadius: 4, padding: '4px 0', cursor: dmg > 0 ? 'pointer' : 'not-allowed', opacity: dmg > 0 ? 1 : 0.4, fontSize: 11 }} disabled={!(dmg > 0)}>-</button>
                                                    </div>
                                                </div>
                                            );
                                        });
                                    })}
                                </div>,
                                (document.getElementById('arena-portal') || document.body)
                            )}

                            {/* Command Zone — fills the remaining height; two partner commanders fit side by side */}
                            <div className="bg-gray-900/80 backdrop-blur-sm px-3 py-2 rounded-lg border border-yellow-700/50 flex-1 min-h-0 overflow-hidden flex flex-col shadow-lg"
                                onDrop={(e) => handleDropOnZone(e, 'command')}
                                onDragOver={(e) => e.preventDefault()}
                            >
                                <h4 className="text-blue-400 text-sm font-bold mb-1 flex-shrink-0">Commander-Zone</h4>
                                <div className="flex flex-wrap gap-2 content-start justify-center min-h-0">
                                    {myState.commandZone.map(card => (
                                        <div key={card.instanceId} draggable onDragStart={(e) => handleDragStart(e, card, 'command')} className="cursor-pointer flex-shrink-0 flex flex-col items-center group/cmdcard relative">
                                            <CardImage
                                                src={card.image_url}
                                                className="w-14 h-[78px] hover:brightness-110 transition-[filter] border border-yellow-500"
                                                onMouseEnter={() => setHoveredCard(previewOf(card))}
                                                onMouseLeave={() => setHoveredCard(null)}
                                            />
                                            {card.isCommander && (
                                                <div className="text-yellow-400 text-[10px] font-bold mt-0.5">
                                                    Steuer: +{(myState.cmdTax || {})[card.instanceId] || 0}
                                                </div>
                                            )}
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    // Commanders go to the stack like any non-land card, but leave
                                                    // the command zone (not the hand) - use playCard directly.
                                                    const stackEntry = { instanceId: card.instanceId, card, ownerId: user.uid, ownerName: user.displayName || getDeckCommanderDisplayName(deck) || 'Spieler', timestamp: Date.now() };
                                                    // „Whenever you cast …“-Auslöser auch beim Wirken aus der Commander-Zone (über dem Zauber)
                                                    const trig = castTriggerEntries(card);
                                                    runTx(async (tx) => {
                                                        const snap = await tx.get(roomRef);
                                                        const currentStack = snap.exists() ? (snap.data().stack || []) : [];
                                                        tx.update(roomRef, { stack: [...trig, stackEntry, ...currentStack] });
                                                    }).catch(err => addToast(`❌ Commander konnte nicht gewirkt werden: ${err.message}`, 'red'));
                                                    if (trig.length) { logEvent(`löst aus: ${trig.map(t => t.card.name).join(', ')}`); addToast(`⚡ ${trig.map(t => t.card.name).join(', ')} löst aus`, 'yellow'); }
                                                    updateMyState({
                                                        commandZone: myState.commandZone.filter(c => c.instanceId !== card.instanceId),
                                                        cmdTax: { ...(myState.cmdTax || {}), [card.instanceId]: ((myState.cmdTax || {})[card.instanceId] || 0) + 2 }
                                                    });
                                                    logEvent(`wirkt Commander ${cardName(card)} (Steuer bisher +${(myState.cmdTax || {})[card.instanceId] || 0}, jetzt +${((myState.cmdTax || {})[card.instanceId] || 0) + 2})`, [card]);
                                                }}
                                                className="absolute left-0.5 right-0.5 top-[60px] bg-green-600 hover:bg-green-500 text-white text-[9px] font-bold py-0.5 rounded shadow opacity-0 group-hover/cmdcard:opacity-100 touch-show transition-opacity"
                                                title={`${card.name} aus der Commander-Zone wirken`}
                                            >Spielen</button>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>

                        {/* Right sidebar (Library / GY / Exile / action buttons) — top to just above hand */}
                        <div ref={myRightSidebarRef} style={{ position: 'absolute', top: 4, bottom: 4, right: 8 }} className="z-40 w-56 overflow-y-auto flex flex-col gap-1.5 scrollbar-hide">
                            {/* Library */}
                            <div 
                                className="bg-gray-900/80 backdrop-blur-sm p-2 rounded-lg border border-yellow-700/50 cursor-pointer hover:bg-gray-900 flex-shrink-0 flex flex-col items-center justify-center relative shadow-lg"
                                onClick={(e) => setLibraryMenu({ x: e.clientX, y: e.clientY })}
                                onDrop={(e) => handleDropOnZone(e, 'library')}
                                onDragOver={(e) => e.preventDefault()}
                            >
                                <h4 className="text-blue-400 text-sm font-bold mb-1">Bibliothek ({myState.library.length})</h4>
                                <CardImage isBack={true} className="w-[60px] h-[84px]" />
                            </div>

                            {/* Graveyard + Exile */}
                            <div className="flex gap-2 flex-shrink-0">
                                <div 
                                    className="bg-gray-900/80 backdrop-blur-sm p-2 rounded-lg border border-yellow-700/50 cursor-pointer hover:bg-gray-900 flex-1 flex flex-col items-center justify-center shadow-lg"
                                    onClick={() => setViewingZone('graveyard')}
                                    onDrop={(e) => handleDropOnZone(e, 'graveyard')}
                                    onDragOver={(e) => e.preventDefault()}
                                >
                                    <h4 className="text-blue-400 text-xs font-bold mb-1">Friedhof ({myState.graveyard.length})</h4>
                                    {myState.graveyard[0] ? (
                                        <CardImage src={myState.graveyard[0].image_url} className="w-12 h-16"
                                            onMouseEnter={() => setHoveredCard(myState.graveyard[0].image_url)}
                                            onMouseLeave={() => setHoveredCard(null)} />
                                    ) : <div className="w-12 h-16 bg-black/50 rounded border border-gray-600"></div>}
                                </div>
                                <div 
                                    className="bg-gray-900/80 backdrop-blur-sm p-2 rounded-lg border border-yellow-700/50 cursor-pointer hover:bg-gray-900 flex-1 flex flex-col items-center justify-center shadow-lg"
                                    onClick={() => setViewingZone('exile')}
                                    onDrop={(e) => handleDropOnZone(e, 'exile')}
                                    onDragOver={(e) => e.preventDefault()}
                                >
                                    <h4 className="text-blue-400 text-xs font-bold mb-1">Exil ({myState.exile.length})</h4>
                                    {myState.exile[0] ? (
                                        <CardImage src={myState.exile[0].image_url} className="w-12 h-16"
                                            onMouseEnter={() => setHoveredCard(myState.exile[0].image_url)}
                                            onMouseLeave={() => setHoveredCard(null)} />
                                    ) : <div className="w-12 h-16 bg-black/50 rounded border border-gray-600"></div>}
                                </div>
                            </div>

                            {/* Action buttons */}
                            <div className="flex gap-2 flex-shrink-0">
                                <button onClick={drawCard} title="Karte ziehen (D)" className="flex-1 bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded text-xs font-bold shadow-lg">Ziehen</button>
                                <button onClick={() => setTokenModalOpen(true)} title="Token erstellen (T)" className="flex-1 bg-green-600 hover:bg-green-500 text-white px-3 py-1.5 rounded text-xs font-bold shadow-lg">Token</button>
                                <button onClick={shuffleLibrary} title="Bibliothek mischen (M)" className="flex-1 bg-purple-600 hover:bg-purple-500 text-white px-3 py-1.5 rounded text-xs font-bold shadow-lg">Mischen</button>
                            </div>
                            <button onClick={() => setEmblemModalOpen(true)} className="w-full bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1.5 rounded text-xs font-bold shadow-lg flex-shrink-0">
                                Embleme{myEmblems.length > 0 ? ` (${myEmblems.length})` : ''}
                            </button>
                        </div>
                    </div>{/* ── END MY HALF ── */}
                    {/* --- OPPONENT AREA (oben) ---
                        2 Spieler: exaktes Spiegelbild meiner Hälfte (gleiche Seitenleisten, Reihen-Geometrie und Skalierung
                        aus computeBfGeom, nur vertikal gespiegelt: Konsole und Kreaturen zur Tischmitte, Commander-Zone und
                        Verzauberungen/Artefakte zum Bildschirmrand). 3–4 Spieler: Kachelansicht. Steht im DOM nach meiner
                        Hälfte, damit Selektoren wie [data-zone] zuerst mein Feld finden. */}
                    {opponentIds.length <= 1 ? (() => {
                        const oppId = opponentIds[0];
                        const opp = oppId ? opponentStates[oppId] : null;
                        const oppActive = !!oppId && activePlayerId === oppId;
                        const oppName = oppId ? getPlayerName(oppId) : 'Gegner';
                        const oppChoosingMulligan = !!opp && !!lobbyState?.seatOrder && !lobbyState?.mulliganStatus?.[oppId]?.completed;
                        const oppLayout = opp && oppGeom ? layoutMyCards([...(opp.battlefieldLower || []), ...(opp.battlefieldUpper || [])], oppGeom) : {};
                        const oppEmblems = opp?.emblems || [];
                        const myCmdrs = getCommandersOf(myState);
                        const cmdDmgTo = myCmdrs.map(c => ({ name: c.name, dmg: (opp?.commanderDamage || {})[c.instanceId] || 0 }));
                        const maxCmdDmgTo = Math.max(0, ...cmdDmgTo.map(x => x.dmg));
                        const chip = 'flex-1 min-w-0 truncate px-1 py-1.5 rounded text-[11px] font-bold shadow bg-gray-800 text-gray-200';
                        return (
                            <>
                                <div data-testid="opp-half" style={{ boxShadow: oppActive ? ACTIVE_RING : undefined }} className={`absolute top-0 left-0 w-full h-1/2 z-0 transition-all duration-200 ${oppActive ? 'bg-green-900/10' : 'bg-gray-900/20'}`}>
                                    {!opp ? (
                                        <div className="flex items-center justify-center h-full text-red-500/20 text-sm font-bold uppercase tracking-widest">Gegnerseite</div>
                                    ) : (
                                        <>
                                            {/* Spielfeld des Gegners: gespiegelte Reihen, gleiche Kartengröße wie meine */}
                                            <div className="absolute inset-0" style={{ zIndex: 0 }}>
                                                {oppGeom && (
                                                    <div className="absolute inset-0 pointer-events-none z-0">
                                                        {Object.entries(oppGeom.zones).map(([t, z]) => (
                                                            <div key={t} data-opp-zone={t} style={{ position: 'absolute', left: z.left, width: z.right - z.left, top: z.top, height: oppGeom.ch, border: `1px dashed ${z.color}`, borderRadius: 3, pointerEvents: 'none' }}>
                                                                <span style={{ fontSize: 9, fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '0.05em', opacity: 0.5, whiteSpace: 'nowrap', position: 'absolute', bottom: 2, right: 4, color: z.text }}>{z.label}</span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                                {oppGeom && (opp.battlefieldLower || []).map(card => renderBattlefieldCard(card, 'battlefieldLower', false, oppLayout[card.instanceId], oppGeom))}
                                                {oppGeom && (opp.battlefieldUpper || []).map(card => renderBattlefieldCard(card, 'battlefieldUpper', false, oppLayout[card.instanceId], oppGeom))}
                                            </div>

                                            {/* Gespiegelter Streifen an Stelle der Phasenleiste (gleiche Höhe, nur Anzeige) */}
                                            <div data-testid="opp-strip" style={{ position: 'absolute', bottom: PHASE_BAR_TOP, left: 240, right: 240, height: PHASE_BAR_H, zIndex: 45, fontSize: 11 }}
                                                className="flex items-center justify-center gap-2 px-2 rounded-lg bg-gray-950/60 border-solid border border-yellow-700/30 text-gray-400 select-none whitespace-nowrap overflow-hidden"
                                            >
                                                <b className="text-red-300 truncate min-w-0">{oppName}</b>
                                                {oppActive
                                                    ? <span className="text-yellow-300 font-bold">am Zug · {PHASE_LABEL[curStep] || ''}</span>
                                                    : <span className="text-gray-500">wartet</span>}
                                            </div>

                                            {/* Linke Seitenleiste, gespiegelt: Konsole unten (Tischmitte), Info-Reihe, Commander-Zone oben */}
                                            <div data-testid="opp-left" style={{ position: 'absolute', top: 4, bottom: 4, left: 8 }} className="z-40 w-56 overflow-y-auto scrollbar-hide flex flex-col-reverse gap-1.5">
                                                <div data-testid="opp-console" className="bg-gray-900/80 backdrop-blur-sm px-3 py-2 rounded-lg border border-yellow-700/50 flex-shrink-0 shadow-lg">
                                                    <div className="flex justify-between items-center h-5">
                                                        <h4 className="text-red-400 text-sm font-bold truncate min-w-0" title={oppName}>{oppName}</h4>
                                                        {oppChoosingMulligan
                                                            ? <span className="text-yellow-400 text-[10px] font-bold uppercase tracking-wide whitespace-nowrap">Wählt Mulligan …</span>
                                                            : oppActive && <ActiveTurnBadge />}
                                                    </div>
                                                    <div className="flex items-center justify-between my-1">
                                                        <span className="w-8 h-8" aria-hidden="true" />
                                                        <div className="flex flex-col items-center leading-none" title={`Leben von ${oppName}`}>
                                                            <span data-testid="opp-life" className="text-green-400 font-title font-bold text-3xl">{opp.life}</span>
                                                            <span className="text-gray-400 text-[9px] uppercase tracking-wider mt-0.5">Leben</span>
                                                        </div>
                                                        <span className="w-8 h-8" aria-hidden="true" />
                                                    </div>
                                                    <ManaPool compact readOnly ownerName={oppName} pool={{ W: 0, U: 0, B: 0, R: 0, G: 0, C: 0, ...(opp.manaPool || {}) }} />
                                                    {oppEmblems.length > 0 && (
                                                        <div className="flex gap-1 mt-1.5 overflow-hidden whitespace-nowrap">
                                                            {oppEmblems.map(e => (
                                                                <span key={e.instanceId} className="min-w-0 truncate bg-indigo-700/80 border border-indigo-400 text-indigo-100 text-[10px] font-bold px-1.5 py-0.5 rounded cursor-default" title={`${e.name}: ${e.stage > 0 ? (e.stageText || [])[e.stage - 1] || '' : 'Gerade erstellt'}`}>
                                                                    {e.name} {e.maxStage > 1 ? `${e.stage}/${e.maxStage}` : ''}
                                                                </span>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>

                                                {/* Info-Reihe in der Geometrie meiner Aktionsreihe: Hand, Bibliothek, Commander-Schaden */}
                                                <div data-testid="opp-info" className="flex gap-1 flex-shrink-0">
                                                    <button type="button" tabIndex={-1} style={{ cursor: 'default' }} className={chip} title={`${oppName} hat ${opp.hand?.length || 0} Handkarten (verdeckt)`}>🂠 Hand {opp.hand?.length || 0}</button>
                                                    <button type="button" tabIndex={-1} style={{ cursor: 'default' }} className={chip} title={`Bibliothek von ${oppName}`}>📚 Bibl. {opp.library?.length || 0}</button>
                                                    <button type="button" tabIndex={-1} style={{ cursor: 'default' }}
                                                        title={cmdDmgTo.length ? `Commander-Schaden an ${oppName}: ${cmdDmgTo.map(x => `${x.name} ${x.dmg}`).join(', ')}` : 'Commander-Schaden'}
                                                        className={`relative w-8 flex-shrink-0 py-1.5 rounded text-sm font-bold leading-none border border-solid shadow bg-gray-900/80 ${maxCmdDmgTo >= 15 ? 'border-red-500 text-red-300' : 'border-yellow-700/50 text-yellow-400'}`}
                                                    >{maxCmdDmgTo > 0 ? maxCmdDmgTo : '⚔'}</button>
                                                </div>

                                                <div className="bg-gray-900/80 backdrop-blur-sm px-3 py-2 rounded-lg border border-yellow-700/50 flex-1 min-h-0 overflow-hidden flex flex-col shadow-lg">
                                                    <h4 className="text-red-400 text-sm font-bold mb-1 flex-shrink-0">Commander-Zone</h4>
                                                    <div className="flex flex-wrap gap-2 content-start justify-center min-h-0">
                                                        {(opp.commandZone || []).map(card => (
                                                            <div key={card.instanceId} className="flex-shrink-0 flex flex-col items-center">
                                                                <CardImage
                                                                    src={card.image_url}
                                                                    className="w-14 h-[78px] border border-yellow-500"
                                                                    onMouseEnter={() => setHoveredCard(previewOf(card))}
                                                                    onMouseLeave={() => setHoveredCard(null)}
                                                                />
                                                                {card.isCommander && (
                                                                    <div className="text-yellow-400 text-[10px] font-bold mt-0.5">Steuer: +{(opp.cmdTax || {})[card.instanceId] || 0}</div>
                                                                )}
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Rechte Seitenleiste, gespiegelt: Bibliothek unten (Tischmitte), darüber Friedhof/Exil */}
                                            <div data-testid="opp-right" style={{ position: 'absolute', top: 4, bottom: 4, right: 8 }} className="z-40 w-56 overflow-y-auto flex flex-col-reverse gap-1.5 scrollbar-hide">
                                                <div className="bg-gray-900/80 backdrop-blur-sm p-2 rounded-lg border border-yellow-700/50 flex-shrink-0 flex flex-col items-center justify-center relative shadow-lg">
                                                    <h4 className="text-red-400 text-sm font-bold mb-1">Bibliothek ({opp.library?.length || 0})</h4>
                                                    <CardImage isBack={true} className="w-[60px] h-[84px]" />
                                                </div>
                                                <div className="flex gap-2 flex-shrink-0">
                                                    {[['graveyard', 'Friedhof'], ['exile', 'Exil']].map(([zone, label]) => {
                                                        const top = (opp[zone] || [])[0];
                                                        return (
                                                            <div key={zone} onClick={() => setViewingZone({ zone, playerId: oppId })}
                                                                className="bg-gray-900/80 backdrop-blur-sm p-2 rounded-lg border border-yellow-700/50 cursor-pointer hover:bg-gray-900 flex-1 flex flex-col items-center justify-center shadow-lg"
                                                            >
                                                                <h4 className="text-red-400 text-xs font-bold mb-1">{label} ({opp[zone]?.length || 0})</h4>
                                                                {top ? (
                                                                    <CardImage src={top.image_url} className="w-12 h-16"
                                                                        onMouseEnter={() => setHoveredCard(top.image_url)}
                                                                        onMouseLeave={() => setHoveredCard(null)} />
                                                                ) : <div className="w-12 h-16 bg-black/50 rounded border border-gray-600"></div>}
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                                {oppEmblems.length > 0 && (
                                                    <div className="w-full bg-indigo-700/60 text-indigo-100 px-3 py-1.5 rounded text-xs font-bold shadow-lg flex-shrink-0 text-center truncate" title={oppEmblems.map(e => e.name).join(', ')}>
                                                        Embleme ({oppEmblems.length})
                                                    </div>
                                                )}
                                            </div>
                                        </>
                                    )}
                                </div>
                                {/* Mittellinie zwischen den Hälften (eigenes Element, damit beide Hälften gleich hoch bleiben) */}
                                <div aria-hidden="true" className="absolute left-0 right-0 pointer-events-none bg-yellow-700/30" style={{ top: 'calc(50% - 1px)', height: 2, zIndex: 1 }} />
                            </>
                        );
                    })() : (
                        /* --- 3-4 PLAYER LAYOUT ---
                           Top 50% of the screen, split among however many opponents are actually seated:
                           - Grid mode (expandedOpponentId === null): all opponent tiles equal width.
                           - Expanded mode: the clicked opponent takes 80% width, the rest share the remaining
                             20% between them (so they never disappear when one tile is enlarged) - per the
                             spec: 10% each at 4 players (3 others), 20% as one tile at 3 players (2 others,
                             so 10% each there too - the remaining tiles always split the 20% evenly).
                           My own battlefield (bottom 50%) merges battlefieldUpper+battlefieldLower into a
                           single unified drop zone - no more internal split on my own side. */
                        <div className="absolute top-0 left-0 w-full h-1/2 bg-gray-950/40 border-b-2 border-yellow-700/30 z-0 flex gap-1 p-1">
                            {seatedOpponentIds.map(oppId => {
                                const isThisExpanded = expandedOpponentId === oppId;
                                const otherCount = seatedOpponentIds.length - 1;
                                let widthStyle;
                                if (!expandedOpponentId) {
                                    widthStyle = { width: `${100 / seatedOpponentIds.length}%` };
                                } else if (isThisExpanded) {
                                    widthStyle = { width: '80%' };
                                } else {
                                    widthStyle = { width: `${otherCount > 0 ? 20 / otherCount : 20}%` };
                                }
                                return (
                                    <div key={oppId} style={widthStyle} className="h-full transition-all duration-200">
                                        <OpponentTile 
                                            name={getPlayerName(oppId)}
                                            state={opponentStates[oppId]}
                                            isActivePlayer={activePlayerId === oppId}
                                            isChoosingMulligan={!!lobbyState?.seatOrder && !lobbyState?.mulliganStatus?.[oppId]?.completed}
                                            isExpanded={isThisExpanded}
                                            onClick={() => setExpandedOpponentId(isThisExpanded ? null : oppId)}
                                            onHoverCard={setHoveredCard}
                                            myCommanders={getCommandersOf(myState)}
                                            auraValidFor={auraTarget ? (card) => auraTargetOk(auraTarget, card, false) : null}
                                            onAuraPick={(card, zone, valid) => {
                                                if (!auraTarget) return false;
                                                if (!valid) { addToast(`Kein gültiges Ziel für ${cardName(auraTarget.aura)}`, 'yellow'); return true; }
                                                chooseAuraTarget(card, zone, oppId);
                                                return true;
                                            }}
                                            onReanimate={(card, zone) => reanimateFrom(card, oppId, zone)}
                                        />
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            );
        };


export { GameSim, getDeckCommanderDisplayName }
