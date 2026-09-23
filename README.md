# Political Compass 2.0

The [SapplyValues](https://sapplyvalues.github.io) questionnaire, answered in your
own words instead of with buttons. At the end, every reply goes to
[Jev](https://docs.typesafe.ai/), TypeSafe's decision model, in one request through
OpenRouter's Decisions endpoint. Jev reads each reply on the usual five-level
scale (strongly disagree … strongly agree) and returns probabilities, not prose.

Live: https://nicolasmahn.github.io/political-compass-2.0/

The score works like SapplyValues, with two differences:

- Skipped statements are left out, so they don't pull a score towards the centre.
- Each axis shows a spread (the halo on the compass). It comes from how unsure Jev
  was reading your replies: "yes, clearly" is certain, "partly" is not. It treats
  the readings as independent, so it says nothing about how consistent your views are.

The statements and German translations come from
[political_compass_llm](https://github.com/NicolasMahn/political_compass_llm),
which puts language models through the same test.

## Run locally

```sh
echo "export const OPENROUTER_KEY = 'sk-or-…';" > js/key.js   # git-ignored
npm start        # serves http://localhost:8000
npm test
```

Without `js/key.js`, the page asks for a key and keeps it in `localStorage`.

## Deploy

Pushing to `main` deploys to GitHub Pages (Settings → Pages → Source: GitHub Actions).
If the repository has an `OPENROUTER_KEY` secret, the workflow bakes it into the
deployed `js/key.js`. Anyone can read it from there, so use a separate key with a
low credit limit. A full questionnaire costs about $0.0003.

## Where things live

- `js/statements.js`: the 46 statements, their translations and which axis they move.
- `js/reading.js`: what Jev is asked, and how its answers become axis scores.
- `js/compass.js`: the compass and the social bar, as SVG.
- `js/strings.js`: every visible string, English and German.
- `js/app.js`: the page flow; replies are kept in `localStorage`.
- `css/theme.css`: every raw color value.
