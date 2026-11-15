# Nearchus: route and sketchbook

24 sketches cover all 18 stops. Six stops have two pages, played in sequence by the existing journey sketchbook. English and Chinese captions use short, natural narrative, with attribution for episodes reported by Arrian.

## Sources and scope

The main narrative is Arrian's **Indica 18–43**, read in J. W. McCrindle's public-domain 1879 translation, [The Commerce and Navigation of the Erythraean Sea](https://www.gutenberg.org/files/55054/55054-h/55054-h.htm). This volume also contains the much later *Periplus of the Erythraean Sea*: that separate work is **not** evidence for Nearchus's ships or ports. The new `arrian-indica` source links to the volume and identifies the relevant work and chapters.

Arrian wrote centuries after the voyage, drawing on Nearchus's lost account. The summary no longer calls the surviving text his literal log or claims these were the first Greeks to chart the sea. Local pilots Hydraces and Mazenes receive attention, as do the shore communities whose resources and knowledge supported the voyage. The Tomerus caption records the violent landing rather than presenting every encounter as friendly exchange.

The sequence is checked against *Indica* XXI–XLII. McCrindle's commentary and tables provide traditional identifications, used cautiously rather than treated as modern surveyed coordinates. Useful checks on that caution are Paolo Biagi's [Uneasy Riders: With Alexander and Nearchus from Pattala to Rhambakia](https://www.academia.edu/121634145/P_Biagi_Uneasy_Riders_With_Alexander_and_Nearchus_from_Pattala_to_Rhambakia), which discusses competing harbour identifications, and the [Encyclopaedia Iranica account of Arrian](https://www.iranicaonline.org/articles/arrian-greek-historian/). [Iranica's Ahvaz monuments article](https://www.iranicaonline.org/articles/ahvaz-iii/) describes the association of the pontoon crossing with Ahvaz as a possibility, not a securely located surviving bridge.

## Route corrections

- Separate the short sandy-island halt at **Krokala** from the **33-day stay at Alexander's Haven** (*Indica* XXI). The Karachi-area pins follow a traditional identification; the harbour and ancient Indus channels remain disputed.
- Align Patala with the parent journey's departure point (the old child pin differed), followed by a schematic descent through the delta. This does not identify Patala with the exact fleet anchorage from which the final sea departure began.
- Restore intermediate stages on the Oritan and Gedrosian coasts: **Cocala, Tomerus, Malana and Mosarna**, then the broader **Gedrosian coast** (*Indica* XXIII–XXX). Cocala is placed approximately near Ras Kachari; Tomerus follows the usual Hingol identification. Regional pages group experiences from a stretch of coast rather than claim a precise location for the whale encounter.
- Add **Badis** and the turn towards Hormuz. The Arabian headland is sighted, not visited: the fleet remains on the Persian side (*Indica* XXXII).
- Place **Harmozeia** by the Anamis/Minab region on the mainland. Nearchus's inland meeting and return are told at this stop; the fleet itself is not routed inland to Alexander (*Indica* XXXIII–XXXVI).
- Continue via **Oaracta**, traditionally Qeshm, and the **islands off Persis**, **Gogana**, **Mesambria** and **Susian shoals** (*Indica* XXXVII–XLI). The pearl fishery is not assigned a supposedly certain island. These are selected stages, not an exhaustive list of every anchorage.
- Restore **Diridotis** and the eastward return to the **Pasitigris** (*Indica* XLI–XLII). Diridotis has competing proposed locations; its pin represents the head-of-Gulf trading district. The lower estuary legs use schematic authored waypoints (`direct`) because forcing today's coastline would imply false precision about ancient river outlets. This is not an overland journey.
- End at the **bridge on the Pasitigris**, in the general Ahvaz area, where the fleet met Alexander's army on its way to Susa (*Indica* XLII). The old sea arrival at Susa is removed. The Pasitigris is the Karun river system, not the Tigris.

Dates retain the voyage's 325–324 BCE span; no exact day or modern-calendar date is inferred for individual anchorages. Overall route confidence is medium. Ocean legs explicitly use sea routing; the initial descent and final ascent use river routing. Coast-shaping waypoints prevent the long legs from skipping across headlands or treating the Gulf as a direct open-water crossing.

## Art and prompt records

Generated with **built-in imagegen**. Final assets are `data/depictions/journey/nearchus/<scene>.webp`; exact full prompts and provenance are adjacent `<scene>.json` files. `subject.json` stores captions, scene evidence, composition and stop indices. Chinese text lives under `journey/nearchus` in `data/i18n/zh/depictions.json`.

Graphite, sepia and restrained watercolour match the journey sketchbooks. The composition alternates broad landforms, sea-level views, work scenes, a deck encounter and object studies. Nearchus appears only in the pilot and messenger scenes. Ship prompts specify wooden oared vessels, square sails and steering oars; landscapes and object pages explicitly omit a foreground hero. The bridge sketch requires a continuous deck supported by boats, with the fleet moored downstream.

## Sequence

| Stop | Sketches | Evidence |
| --- | --- | --- |
| Patala | Preparing for the coast; Following the river out | XX–XXI; loading details contextual |
| Krokala | A short stop on sand | XXI |
| Alexander's Haven | Thirty-three days in harbour; Food at the water's edge | XXI |
| Cocala | Ten days of provisions | XXIII |
| Tomerus estuary | A contested landing | XXIV–XXV |
| Cape Malana | Rounding Malana | XXV |
| Mosarna | A pilot who knew the coast | XXVI–XXVII |
| Gedrosian coast | Fish laid out to dry; Whales ahead of the ships | XXVII–XXX |
| Badis | Cultivated ground again; Keeping to the Persian shore | XXXII; headland sighting on the onward passage |
| Harmozeia | The fleet comes ashore; Finding the army inland | XXXIII–XXXVI |
| Oaracta | An island and another pilot | XXXVII |
| Islands off Persis | Pearls from the Gulf | XXXVIII; shore objects contextual |
| Gogana | Waiting for enough water | XXXVIII |
| Mesambria | Gardens on the peninsula | XXXIX |
| Susian shoals | A channel marked by stakes | XLI |
| Diridotis | Cargoes from Arabia | XLI–XLII; storehouse scene contextual |
| Mouth of the Pasitigris | Up the Pasitigris | XLII |
| Bridge on the Pasitigris | Ships and army meet; Flowers for the returning sailors | XLII; wreath still-life contextual |

## Validation

- Route sanity checks passed; the authored route was also reviewed against the basemap, including the delta sections and the head-of-Gulf return.
- All 18 stops have matching scenes and Chinese stop translations; all 24 scenes have English/Chinese captions and saved full prompts. Patala matches the parent journey's fork coordinates.
- Data build and production build passed. The 24 images produce 72 thumbnail/card/full variants with no placeholders.
- Existing test suite: 20 tests passed.
- Browser checks passed for every card, caption, stop mapping and full-size image in English and Chinese. Companion playback passed at all 18 stops; real autoplay showed both first-stop pages before departure. Mobile rendering at 390 × 844 passed with no browser page errors.
