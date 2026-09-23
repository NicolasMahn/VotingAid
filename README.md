# Voting Aid

Write what you think about the topics you care about, and see which party is
closest: by its program for the Bundestagswahl 2025, and, separately, by how it
voted in the Bundestag. A rebuild of
[VotingAid](https://github.com/NicolasMahn/VotingAid_Frontend) that runs entirely
in the browser and lets [Jev](https://docs.typesafe.ai/), TypeSafe's decision
model, do the judging.

Live: https://nicolasmahn.github.io/VotingAid/

## How it works

There are two databases, both plain JSON files with int8 embeddings:

- `data/programme.json`: the seven programs in `programme/`, split into
  ~1,000-character passages that never cross a page (2,025 passages).
  Built by `scripts/build_programs.py`.
- `data/abstimmungen.json`: every roll-call vote of the Bundestag since 2021 from
  the [abgeordnetenwatch.de API](https://www.abgeordnetenwatch.de/api) (CC0),
  counted per party. Built by `scripts/build_votes.py`.

For each topic, the browser embeds the opinion once and picks the four closest
program passages of every party and the four closest votes. Programs and votes
then go to Jev in two separate requests, and the page ranks parties separately
for each. Mixing them would blur the parties: coalition partners vote together
almost every time, whatever their programs say.

Per party, Jev answers three narrow questions: how well the material matches the
opinion, whether it takes a clear position at all, and which passage or vote shows
it best. It returns probabilities, not prose. A party's match averages its
topics, weighted by how clearly each is addressed; topics it is silent on don't
count. Where a party's votes and program disagree clearly on a topic, the page
says so. That comparison is done in code, after both readings are in.

Roll-call votes are a small, contested subset of what the Bundestag decides, and
FDP and BSW have not been in the Bundestag since 2025, so the vote ranking says
less than the program ranking.

One topic costs about $0.001 and takes about a second; topics run in parallel.

## Run locally

```sh
echo "export const OPENROUTER_KEY = 'sk-or-…';" > js/key.js   # git-ignored
npm start        # serves http://localhost:8000
npm test
```

Without `js/key.js`, the page asks for a key and keeps it in `localStorage`.

To rebuild the databases (programs need `pdftotext`; votes take ~15 minutes
because of the API's rate limit, later runs only fetch new votes):

```sh
OPENROUTER_API_KEY=sk-or-… python3 scripts/build_programs.py
OPENROUTER_API_KEY=sk-or-… python3 scripts/build_votes.py
```

## Deploy

Pushing to `main` deploys to GitHub Pages. If the repository has an
`OPENROUTER_KEY` secret, the workflow bakes it into the deployed `js/key.js`.
Anyone can read it from there, so use a separate key with a low credit limit.

## Where things live

- `js/retrieval.js`: loading the databases and finding the closest passages and votes.
- `js/votes.js`: how a party voted, from per-member counts.
- `js/analysis.js`: what Jev is asked about programs and votes, and how answers become a match.
- `js/parties.js`: the parties and links into their programs.
- `js/suggestions.js`: the "Thema vorschlagen" topics from the original.
- `js/app.js`: the page.
- `css/theme.css`: every raw color value, including party colors.
