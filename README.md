# Voting Aid

Write what you think about the topics you care about, and see which party's
program for the Bundestagswahl 2025 is closest. A rebuild of
[VotingAid](https://github.com/NicolasMahn/VotingAid_Frontend) that runs entirely
in the browser and lets [Jev](https://docs.typesafe.ai/), TypeSafe's decision
model, do the judging.

Live: https://nicolasmahn.github.io/VotingAid/

## How it works

1. `scripts/build_programs.py` splits the seven programs in `programme/` into
   ~1,000-character passages (never across pages) and embeds them once. The result,
   `data/programme.json`, is the whole database: 2,025 passages, 3.2 MB.
2. In the browser, each opinion is embedded with the same model, and the four
   closest passages of every party are picked.
3. One Jev request per topic answers three narrow questions per party: how well
   the program matches the opinion, whether it takes a clear position at all, and
   which passage shows it best. Jev returns probabilities, not prose.
4. A party's overall match averages its topics, weighted by how clearly the
   program addresses each one. Topics a program is silent on don't count.

One topic costs about $0.0004 and takes under a second; topics run in parallel.

The retrieval step is what keeps Jev's input small (under 32k tokens), so the
database can grow (more programs, other elections, voting records) without
changing what Jev is asked.

## Run locally

```sh
echo "export const OPENROUTER_KEY = 'sk-or-…';" > js/key.js   # git-ignored
npm start        # serves http://localhost:8000
npm test
```

Without `js/key.js`, the page asks for a key and keeps it in `localStorage`.

To rebuild the database after changing a program (needs `pdftotext`):

```sh
OPENROUTER_API_KEY=sk-or-… python3 scripts/build_programs.py
```

## Deploy

Pushing to `main` deploys to GitHub Pages. If the repository has an
`OPENROUTER_KEY` secret, the workflow bakes it into the deployed `js/key.js`.
Anyone can read it from there, so use a separate key with a low credit limit.

## Where things live

- `js/retrieval.js`: loading the database and finding the closest passages.
- `js/analysis.js`: what Jev is asked, and how answers become a match.
- `js/parties.js`: the parties and links into their programs.
- `js/suggestions.js`: the "Thema vorschlagen" topics from the original.
- `js/app.js`: the page.
- `css/theme.css`: every raw color value, including party colors.
