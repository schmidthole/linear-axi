# linear-axi

An agent-ergonomic command-line interface (an "axi") over the [Linear](https://linear.app) API, in the style of `gh-axi`, `lavish-axi`, and `chrome-devtools-axi`. It lets an agent (or a human) perform common Linear operations on issues, projects, initiatives, and documents without logging into the Linear web app.

## Status

Bootstrapping. The full command surface is under active development.

## Authentication

`linear-axi` reads a Linear API key from the `LINEAR_API_KEY` environment variable. Generate a personal API key in Linear (Settings → Security & access → API) and export it:

```sh
export LINEAR_API_KEY=lin_api_...
```

Never commit the key. See `.env.example` for the expected variable.
