# Voting Aid

Write what you think about the topics you care about, and see which party is
closest, three ways: by its program for the Bundestagswahl 2025, by how it voted
in the Bundestag, and by what its politicians and official channels say. A rebuild of
[VotingAid](https://github.com/NicolasMahn/VotingAid_Frontend) that runs entirely
in the browser and lets [Jev](https://docs.typesafe.ai/), TypeSafe's decision
model, do the judging.

Live: https://nicolasmahn.github.io/VotingAid/

## How it works

Three databases, all static files built by `scripts/`:

- `data/programme.json`: the seven programs in `programme/`, split into
  ~1,000-character passages that never cross a page (2,025 passages).
  `build_programs.py`.
- `data/abstimmungen.json`: the roll-call votes of the 20th and 21st Bundestag (from 2021-11) from
  the [abgeordnetenwatch.de API](https://www.abgeordnetenwatch.de/api) (CC0),
  counted per parliamentary group; members without one are left out. `build_votes.py`.
- `data/aussagen/`: the speeches of the covered parties' members in the Bundestag since 2025-03-25, from the
  [plenary protocols](https://www.bundestag.de/services/opendata), plus pages from
  the websites of the Bundestag fractions and the federal parties.
  `build_speeches.py` and `build_web.py` collect, `build_statements.py` embeds.

Federal politics is the boundary: speeches in the Bundestag are federal by
definition, and only fraction and federal party sites are crawled, not state
associations. Speeches in public parliamentary debates may be reproduced with attribution
(§ 48 UrhG); from websites we only show short passages with a link. Press
interviews are left out, because hosting them would mean republishing other
people's articles.

All three use `voyageai/voyage-4-large`. It placed the right program passage
higher than `text-embedding-3-large` in a comparison of eight models on 16
everyday phrasings (mean reciprocal rank 0.93 vs 0.83), and its vectors can be
shortened by truncation, so one query embedding serves every database.

The statements are too large to load whole (about 14,000 speeches). The browser
preloads a compact index, one party byte and a 1,024-bit vector per document,
finds the closest documents per party by Hamming distance, fetches only their
shards, and picks the closest passage in each.

For each topic, programs, votes and statements go to Jev in three separate
requests, and the page ranks parties separately for each. Mixing them would blur
the parties: coalition partners usually vote together whatever their programs say, and
one politician's speech is not the party line. For programs and statements, Jev
answers three narrow questions per party: where the material places it, whether
it takes a clear position at all, and which passage or statement shows it best.
For votes, Jev only judges how the person would vote in each one, without seeing
the parties; the code then compares that with how each party voted, so parties
that voted alike score alike. Jev returns probabilities, not prose. Every
finding on the page cites its source.

Scores run from -10 (the party wants the opposite) to +10 (it wants the same).
A party's score averages its topics, weighted by how clearly each is addressed;
topics it is silent on don't count, and parties silent on all of them come last,
greyed out, with no score rather than a low one. Where a party's votes and program disagree clearly
on a topic, the page says so.

The page shows one ranking, the weighted mean of the three sources; people can
set each source to off, normal or double. Opening a party shows its topics by
source, and each score opens its evidence in place: for programs and
statements a quote of the two sentences closest to the opinion, with […] where
text is left out and the whole passage one tap away; for votes, whether the
party voted as the person would, vote by vote. The key sentences are found by
embedding the passage's sentences when it is first opened; they are the
party's own words, not a generated summary.

The three sources are not equally strong. Roll-call votes are a small, contested
subset of what the Bundestag decides. FDP and BSW have not been in the Bundestag
since 2025-03-25, so they have no votes since then and appear in statements only
through their party websites.

## Run locally

```sh
echo "export const OPENROUTER_KEY = 'sk-or-…';" > js/key.js   # git-ignored
npm start        # serves http://localhost:8000
npm test
```

Without `js/key.js`, the page asks for a key and keeps it in `localStorage`.

To rebuild the databases (programs need `pdftotext`, the web crawl needs
`scripts/requirements.txt`). Downloads and embeddings are cached in `.cache/`,
so later runs only fetch and pay for what is new:

```sh
export OPENROUTER_API_KEY=sk-or-…
python3 scripts/build_programs.py
python3 scripts/build_votes.py          # ~15 minutes: the API allows 30 requests a minute
python3 scripts/build_speeches.py
.venv/bin/python scripts/build_web.py   # python3 -m venv .venv && .venv/bin/pip install -r scripts/requirements.txt
python3 scripts/build_statements.py
```

## Deploy

Pushing to `main` deploys to GitHub Pages. If the repository has an
`OPENROUTER_KEY` secret, the workflow bakes it into the deployed `js/key.js`.
Anyone can read it from there, so use a separate key with a low credit limit.

## Where things live

- `js/retrieval.js`: the query embedding, and finding the closest passages and votes.
- `js/statements.js`: the binary index and shards of the statements database.
- `js/votes.js`: how a party voted, from per-member counts.
- `js/analysis.js`: what Jev is asked about programs, votes and statements, and how answers become a match.
- `js/parties.js`: the parties and links into their programs.
- `js/suggestions.js`: the "Thema vorschlagen" topics, as of 2026-09.
- `js/results.js`: the ranking, weights, evidence and vote corrections.
- `js/excerpt.js`: the key sentences of a quote.
- `js/app.js`: the topic form, running the analysis, and the sources dialog.
- `css/theme.css`: every raw color value, including party colors.
