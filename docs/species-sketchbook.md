# Species sketchbook

All 53 plant and animal entries in `data/living.json` have one natural-history study: 29 plants and 24 animals. The cards reuse the atlas's lazy-loaded sketch plate and full-size viewer, with English and Chinese captions. Music entries retain their existing presentation.

The set alternates habitat views, whole plants or animals, and close studies of identifying features. Broad entries use a specific representative where needed: an Indian rhinoceros, Asian elephant, eastern grey kangaroo, emmer wheat, and South Island giant moa. The cloves/nutmeg card shows two separate specimens. Early domestic animals are illustrative representatives rather than claims about an exact ancient breed. Extinct animals are evidence-informed reconstructions. The sketches are natural-history studies, not dated snapshots of every arrival along a species' route.

## Assets and generation

Generated with **built-in imagegen** on 2026-11-17. Each directory `data/depictions/living/<id>/` contains:

- `study.webp`: accepted sketch, converted from the generated PNG.
- `study.json`: exact generation prompt, method, date and source provenance.
- `subject.json`: caption, concise scene brief and references.

The shared style is in `data/depictions/style.json`; Chinese titles and captions are under `living/<id>` in `data/i18n/zh/depictions.json`. The data builder produces thumbnail, card and full-size variants, plus a lazy-loaded subject document, in `public/data/depictions/living/`.

## Reference checks

Existing species sources remain attached to each study. Additional checks cover [coelacanth anatomy](https://ocean.si.edu/ocean-life/fish/coelacanth), [moa specimens](https://collections.tepapa.govt.nz/object/92365), [Steller's sea cow](https://repository.library.noaa.gov/view/noaa/34672/noaa_34672_DS1.pdf), [thylacines](https://australian.museum/learn/australia-over-time/extinct-animals/the-thylacine/) and [cloves and nutmeg](https://www.kew.org/read-and-watch/christmas-spices). Reference identifiers are recorded in `data/sources.csv`.

## Validation

All 53 images received a visual review. The data build confirms 53 studies and 159 image variants with no placeholders. Type checking, the production build, and all 20 existing tests pass. Browser checks opened every card and full-size image in English and Chinese, checked the translated captions, exercised arrival/year changes, and checked a mobile card and the unaffected music-card presentation.
