# Fabula

Webová aplikace pro stavbu příběhu a psaní scénáře: tabule s kauzálními vazbami, scénář, časová osa s motivy a napětím, reporty.

## Spuštění

```bash
npm install
npm run dev
```

Aplikace běží na http://localhost:5173. Automatické ukládání do složky na disku funguje jen v prohlížečích na Chromiu.

## Testy

```bash
npm test
```

## Kde co je

- `src/model.ts` – datový model projektu
- `src/store.ts` – stav aplikace, historie kroků, ukládání do prohlížeče
- `src/io.ts` – import (Causality `.cau`, Final Draft `.fdx`, Fountain) a exporty
- `src/evaluate.ts` – kontrola děje a formátu
- `src/tension.ts`, `src/stats.ts` – napětí z motivů, statistiky a reporty
- `src/views/` – tabule, scénář, časová osa, reporty, rešerše
- `tests/` – automatické testy
