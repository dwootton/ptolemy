# Ptolemy

Ptolemy is a VS Code extension for exploratory data analysis. It puts analysis ideas on a map and connects them to Jupyter notebooks, so you can keep track of questions, code, and notes while working through a dataset.

This is a research prototype. Expect rough edges, and review generated code and results before using them.

## What it does

- Loads a CSV and summarizes its columns and values.
- Uses OpenAI to suggest analyses and place related ideas near each other on a semantic map.
- Connects analyses to notebook cells, with notes, grouping, and saved checkpoints.

## Run locally

You need Node.js 22 or newer, pnpm 10.15.0, and VS Code 1.88 or newer. To run Python notebooks, also install the VS Code Python and Jupyter extensions and select a Python kernel with the packages your notebook uses.

```sh
git clone https://github.com/dwootton/ptolemy.git
cd ptolemy
pnpm install --frozen-lockfile
pnpm --dir webview-ui install --frozen-lockfile
cp env.template .env
```

Add your own OpenAI API key to `OPENAI_API_KEY` in `.env`. Keep this file private. Alternatively, set `meridian.openaiApiKey` in VS Code **User** settings. OpenAI-backed features require a key and may incur API charges.

```sh
pnpm run build
```

Open the repository in VS Code and press **F5** to launch the Extension Development Host. In that window:

1. Open a working folder and run **Open Ptolemy Sidebar** from the Command Palette.
2. Load a CSV file, up to 10 MB, from the sidebar.
3. Explore the analysis map, open an analysis in a notebook, or add a note with **Ptolemy: Add Analysis Note** from a notebook cell.

Run **Ptolemy: Test OpenAI Connection** to check your key. To install outside the development host, run `pnpm run package`, then use **Extensions: Install from VSIX...** in VS Code.

## Data and settings

AI features send context to OpenAI. Depending on the action, that can include column names, sample values, dataset summaries, prompts, analysis text, and notebook content. Use data you are comfortable sending to that service.

Datasets, checkpoints, and other working state are stored locally in the workspace's `.meridian` directory and VS Code storage. Study mode, interaction recording, and Firebase logging are off by default. Enabling those research features can record dataset and notebook content; see the [development notes](docs/development.md).

The extension was previously called Meridian. Settings, command IDs, and storage paths still use `meridian` to keep existing workspaces compatible.

## Development

The extension is written in TypeScript. The sidebar uses React, D3, and Vite.

```sh
pnpm run typecheck
pnpm run lint:all
pnpm test
pnpm run build
```

See [development notes](docs/development.md) for the source layout and a manual smoke test. Bug reports and focused pull requests are welcome.

## License

[MIT](LICENSE).
