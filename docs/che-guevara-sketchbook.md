# Che Guevara's motorcycle journey: sketchbook

26 sketches cover all 18 existing stops. Companion pages add time for the lakes, the broken motorcycle, Chuquicamata, Cusco, Machu Picchu, Lima, the riverboat and San Pablo. Landscapes, architecture, tools, transport interiors and ordinary encounters alternate; Ernesto and Alberto appear only where useful. They wear civilian clothes appropriate to 1952, without the later revolutionary iconography.

Captions use concise third-person narration. They paraphrase the account where an event is documented and describe contextual scenery without inventing diary quotations. The images remain imagined sketches, using the existing annotation and source link. Architectural and landscape details are illustrative reconstructions, not claims to reproduce a particular photograph.

## Evidence and small itinerary corrections

The existing `motorcycle-diaries` reference is retained. Each scene records a chapter in `evidence.passage` and a link to the [Ocean Press edition](https://psi329.cankaya.edu.tr/uploads/files/Ernesto%20Che%20Guevara%20-%20The%20Motorcycle%20Diaries_%20notes%20on%20a%20latin%20american%20journey.pdf). The [Penguin publisher's itinerary](https://cdn.penguin.co.uk/dam-assets/books/9780241465103/9780241465103-sample.pdf), pp. xiii–xv, confirms the stop sequence and dates.

- The broken Norton traveled by truck from Los Ángeles to Santiago; the caption does not show them riding it onward.
- San Pablo's birthday gathering and the river swim are separate episodes in the diary. The old stop note conflated them; the revised note records the stay and birthday, and the sketches show everyday company and the gathering.
- Leticia to Bogotá was a flight on 2 July. That leg now uses the atlas's `direct` routing mode, rather than a fictional road across the forest. No new travel mode is introduced.
- The Chinese summary no longer describes the journey from the Andes toward the Amazon as a southward trip.

## Assets and prompts

Generated with **built-in imagegen** on 2026-11-18. Accepted WebP images live in `data/depictions/journey/che-guevara/`, alongside a per-image JSON file containing its exact prompt and generation provenance. `subject.json` records scenes, captions, sources and stop indices. Chinese titles and captions are under `journey/che-guevara` in `data/i18n/zh/depictions.json`.

The existing data pipeline creates thumb/card/full variants. The existing journey player presents companion pages sequentially before leaving their stop; no player changes are required.

## Validation

All 26 accepted images visually reviewed; the Cusco stonework, mine panorama and Machu Picchu panorama were refined to keep their focus on the place. Data validation confirms coverage of all 18 stops, 78 derived image variants, and no placeholders. Type checking, production build and all 20 tests pass. Chrome checks verified every card, caption and enlarged image in English and Chinese, companion playback at all stops, real timed autoplay at the two-page lake stop, and mobile rendering without browser errors.
