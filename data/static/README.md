# Static / manually-sourced datasets

Fields that don't have a free, live, public API (Phase 3.1) are read from
JSON files in this folder instead. Populate them as the founder registers
for access / transcribes published reports:

- `ef-epi.json` — EF English Proficiency Index scores by country (annual report)
- `pisa-scores.json` — PISA/UNESCO school quality scores by country
- `who-healthcare-fallback.json` — WHO healthcare quality fallback if the live
  GHO API (lib/data-sources/who.ts) doesn't have data for a given country

Each file should map an ISO 3166-1 alpha-2 country code to a 0-100 score, e.g.:

```json
{ "PT": 62, "FR": 55, "DE": 63 }
```

Until populated, `lib/data-sources/manual-sources.ts` returns clearly-flagged
placeholder values so the app runs end-to-end.
