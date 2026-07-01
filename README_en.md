# Blindsight — Korean Translation

[한국어](README.md) | **English**

A project that translates Peter Watts' hard-SF novel ***Blindsight*** (2006) into Korean and shares it online.

📖 **Read the novel: <https://yunhojeon.github.io/blindsight-translation/>**

## About the Novel

*Blindsight* is set in 2082, following the exploration vessel *Theseus* and its crew, sent to make contact with an unidentified alien intelligence that has been observing Earth. The crew includes a vampire captain, a linguist with multiple personalities, a biologist who has replaced his senses with machines, and the narrator Siri Keeton — a man who, having lost his own affect, "observes and translates" other people. The novel was a Hugo Award nominee and is widely regarded as one of the finest works of hard SF.

## Motivation

The novel was once [officially published in Korea](https://product.kyobobook.co.kr/detail/S000000818813), but it is **now out of print** and hard to find. Fortunately, Peter Watts has made the full text of the novel available on [his own website](https://www.rifters.com/real/Blindsight.htm) under a **Creative Commons (CC BY-NC-SA 2.5)** license.

That license permits non-commercial redistribution and derivative works under the **same terms (ShareAlike)**. So, working from the original text, this project produced a fresh Korean translation with the help of **Claude** and publishes it — **under the same license as the original** — for anyone to read. It is non-commercial, and the original author, source, and license are credited both in the reader and in this repository.

## The Translation Process (Overview)

The work is built on a pipeline that separates translation *data* from *presentation*. The **translation, glossary, and character data in `data/` are the single source of truth**, and the HTML that readers see is **generated** from that data. To change presentation (colors, layout, how original terms are shown alongside the translation), we don't re-translate — we just re-run the build.

```
extract.py        Original HTML → 3,667 segments (immutable ids) + Watts' endnotes
build_glossary.py Glossary curation (transliterate/translate/coinage strategy, first-mention gloss, locked terms)
chunk.py          Split into 51 translation units, respecting scene and part boundaries
translate.sh      Per-chunk translation with Claude (resumable, split into batched calls)
validate.py       Batch validation of ids, italics, speaker register, locked terms
build_reader.py   Translation → inlined into a single-file HTML reader
```

For the full design, rules, and schema, see [`CLAUDE.md`](CLAUDE.md), [`번역_설계.md`](번역_설계.md), and the sources under `build/`.

## Challenges of Translating SF

Translating SF poses its own particular problems. This project paid special attention to the following.

- Translating chunk by chunk, we kept the translation consistent by referencing and updating the glossary as we went.
- **Scientific terms and invented (in-world) coinages**: for established scientific terms we use the standard translation (e.g. *blindsight* → **맹시**), while for the work's own neologisms and technology names we transliterate (e.g. *scrambler* → **스크램블러**); proper nouns rendered by meaning (e.g. *fireflies* → **반딧불이**) are marked as coinages.
- **Proper nouns and first-mention gloss**: at the first appearance of a personal name, ship name, or term, the original is automatically shown in the form `한글(English[, 漢字])`, and on later appearances an underline provides a **term gloss (definition)**. This matching is generated automatically from the glossary as the source of truth.
- **Handling italics**: Watts uses italics very frequently, and for **many different purposes** — inner monologue/thought, emphasis, foreign words, titles and ship names, transmitted (comm) speech, and so on. But **Korean has no typographic convention of italics.** So rather than flattening them all into one, we **render them differently by purpose** (thought, emphasis, foreign, name, comm, other — each in a distinct style). The data preserves the "purpose" of each italic run, and the presentation rules are applied at build time (and can be changed in `reader.css`).
- **Register (honorific vs. plain speech)**: Korean's relative honorifics are defined via a character-relationship matrix, and applied and validated consistently for each speaker→addressee pair.

## Web Reader

We built a web reader app that uses the outputs of the translation process directly — the **original text, translation, glossary, and character data** (a single HTML file, deployed to GitHub Pages as `docs/index.html`). Key features:

- Per-paragraph and global **original-text toggle**, **original-term display**, and **term gloss** on/off
- Purpose-based italic and coinage color coding, automatic first-mention original-term display
- Chapter-by-chapter paging, table of contents, glossary, bookmarks
- Reading settings such as font size, line spacing, and brightness (theme)
- When logged in, **cross-device sync of reading position and bookmarks** (Supabase)

## License

- **Original work** — *Blindsight* © Peter Watts — [rifters.com](https://www.rifters.com/real/Blindsight.htm), [CC BY-NC-SA 2.5](https://creativecommons.org/licenses/by-nc-sa/2.5/).
- **This entire repository** — not only the Korean translation (`data/`, reader output) but also the **translation pipeline Python code, per-chunk translation results, glossary, and design documents** — is shared under the same **CC BY-NC-SA 2.5** license as the original. For full terms, see [`LICENSE`](LICENSE).

In other words, you are free to read, copy, and improve or extend it, so long as you give attribution, keep it non-commercial, and share alike.
