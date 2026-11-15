# Alexander’s campaign sketchbook

32 sketches cover all 22 non-waypoint stops, with ten stops receiving two pages. Existing journey playback gives companion sketches time before moving on.

## Editorial approach

Short English and Chinese captions explain what the scene adds to the stop. They alternate account-based narrative with ordinary historical context; contextual work and equipment are not presented as recorded eyewitness episodes. The existing Imagined sketch credit carries the reconstruction label. Alexander need not appear. Landscape, architecture, objects, transport, provisioning and the effects of conquest share the sketchbook with military events.

Primary narrative: [Arrian, Anabasis of Alexander, translated by E. J. Chinnock (1884)](https://www.gutenberg.org/files/46976/46976-h/46976-h.htm), a public-domain translation of a much later ancient account, not an eyewitness diary. Chapter references and contextual qualifications are recorded in each scene’s evidence. Gordium retains the competing versions of the knot story; Siwa does not invent the oracle’s words. The palace fire and hardship of the desert march are included without romanticising conquest. [Pakistan’s archaeological site record for Bhir Mound](https://doam.gov.pk/public/sites/9752) informs the Taxila street: no later Sirkap plan or Gandharan monuments.

## Route corrections

- Alexandria’s foundation precedes the visit to Siwa in Arrian III.1–4; the two stops and Chinese entries are reordered together.
- Ecbatana marks reorganisation and the start of renewed pursuit, not Darius’s murder there (III.19–21). The death is described as occurring farther east.
- Alexandria Eschate’s foundation is placed in 329 BCE, in the first Sogdian campaign (IV.1–4; [Jeffrey D. Lerner, Alexandria Eschate](https://doi.org/10.1002/9781444338386.wbeah14022)).
- The summary now says the expedition expanded Greek geographical knowledge; it does not erase earlier Greek knowledge of Persia.

The route remains a compressed itinerary. Each scene uses the non-waypoint stop index; the Indus waypoint is not a sketchbook stop. Nearchus’s separate journey is not expanded in this batch.

## Art and files

Built-in imagegen, one image per scene. Full prompts and provenance: `data/depictions/journey/alexander/<scene>.json`. Accepted artwork: adjacent `<scene>.webp`. Scene captions, evidence and composition: `subject.json`; translations: `data/i18n/zh/depictions.json`, under `journey/alexander`.

The shared journey style uses loose graphite, sepia hatching and restrained watercolour with unfinished cream-paper margins. Scene constraints exclude later monuments and equipment: no Pharos at the foundation of Alexandria, no Registan in Maracanda, no stirrups, no Roman armour, no modern shipyards. River crossings and animals receive explicit spatial and anatomical constraints.

## Sequence

| Stop | Place | Page | Focus | Narrative reference |
| --- | --- | --- | --- | --- |
| 1 | Pella | The baggage on the road | travel | I.11; baggage details contextual |
| 1 | Pella | Preparing the long spears | objects | I.14–16; contextual equipment study |
| 2 | The Granicus | The opposite bank | landscape | I.13–16 |
| 3 | Gordium | The knot on the wagon | objects | II.3 |
| 4 | Issus | Mountains beside the sea | landscape | II.7–11 |
| 5 | Tyre | A road into the water | work | II.18–19 |
| 5 | Tyre | Ships under the walls | travel | II.20–24 |
| 6 | Alexandria | Marking a future city | work | III.1–2 |
| 7 | Siwa oasis | Green ground in the desert | landscape | III.3–4 |
| 7 | Siwa oasis | At the sanctuary of Ammon | architecture | III.3–4 |
| 8 | Gaugamela | Room to manoeuvre | landscape | III.8–15 |
| 9 | Babylon | Through the city gate | architecture | III.16; architectural context |
| 9 | Babylon | Fields supplied by canals | daily-life | III.16; contextual landscape |
| 10 | Persepolis | Under the palace columns | architecture | III.18; architectural context |
| 10 | Persepolis | After the palace fire | aftermath | III.18 |
| 11 | Ecbatana | Changing the pace of pursuit | work | III.19–21 |
| 12 | Bactra | A city at the crossing of routes | daily-life | III.28–29; contextual settlement |
| 12 | Bactra | Crossing without timber | objects | III.29 |
| 13 | Maracanda | Beyond the garrison | landscape | IV.3–6; contextual landscape |
| 14 | Alexandria Eschate | Building a frontier town | work | IV.1–4 |
| 15 | Taxila | Through the older town | architecture | V.3; Bhir Mound archaeological context |
| 15 | Taxila | Provisioning the visitors | daily-life | V.3; provisioning details contextual |
| 16 | The Hydaspes | The crossing in the rain | travel | V.9–14 |
| 16 | The Hydaspes | Elephants across the field | animals | V.15–17 |
| 17 | The Hyphasis | Men who would go no farther | people | V.25–29 |
| 18 | Patala | Boats on the mud | landscape | VI.18–20 |
| 18 | Patala | A base for the fleet | work | VI.18–20 |
| 19 | Gedrosian desert | The distance between water | landscape | VI.24–26 |
| 19 | Gedrosian desert | The water in a helmet | people | VI.26 |
| 20 | Carmania | News from the coast | people | VI.28 |
| 21 | Susa | A ceremony of alliance | people | VII.4 |
| 22 | Babylon | Boats for another voyage | travel | VII.19–21,24–26 |

Seventeen pages focus on landscape, architecture or objects without a foreground portrait. The other pages show provisioning, construction, animals, river crossings and encounters, alongside a few scenes centred on Alexander.

## Validation

- Data build and production build passed; all 32 source images produce 96 thumbnail/card/full variants without placeholders.
- Existing test suite: 20 tests passed.
- Browser checks passed for all 32 captions, stop mappings and full-size images in both English and Chinese.
- Companion-page playback checked at all 22 stops; real autoplay held at Pella until both sketches had shown. Mobile rendering checked at 390 × 844, with no browser page errors.
