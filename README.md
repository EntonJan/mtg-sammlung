# MTG Sammlung

Eigener Sammlungsmanager und (bald) Commander-Deckbuilder für Magic: The Gathering.

**Live:** https://entonjan.github.io/mtg-sammlung/

## Stand (Stufe 1 – Sammlung)
- Google-Login (Firebase Auth), Daten pro Nutzer in Firestore (`users/{uid}/…`)
- ManaBox-CSV importieren (Sammlung ersetzen oder hinzufügen)
- Flüssige Sammlungsansicht auch bei 13.000+ Karten (virtualisierte Liste/Bilderraster)
- Suche & Filter: Name, Regeltext, Typ, Farben (inkl. Commander-Farbidentität), Seltenheit, Set, Manawert, Preis, Foil
- Karten manuell suchen und hinzufügen/entfernen
- Aktueller Marktwert (Cardmarket-Preise über Scryfall, 1× täglich aktualisiert)

## Geplant
- Stufe 2: Commander-Decks mit „Schrank-Prinzip“ (Karten wandern zwischen Sammlung und Deck), Deck-Import, Kategorien, Statistiken, Probehand
- Stufe 3: Android-App (Capacitor)
- Stufe 4: Kamera-Scan

## Entwicklung
```bash
npm install
npm run dev
```
Deployment: Push auf `main` → GitHub Actions baut und veröffentlicht auf GitHub Pages.

Kartendaten & Bilder: [Scryfall](https://scryfall.com). Inoffizielles Fan-Projekt, nicht mit Wizards of the Coast verbunden.
