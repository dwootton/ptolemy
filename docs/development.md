# Development

Follow the [README](../README.md) to install dependencies and build. Both the repository root and `webview-ui/` have their own package manifests and lockfiles.

## Source layout

- `src/extension.ts` registers the VS Code sidebar and commands.
- `src/services/messaging/` handles messages between the extension and sidebar.
- `src/services/llm/` contains the OpenAI client and generation code.
- `src/services/` also handles datasets, notebooks, saved state, and checkpoints.
- `webview-ui/src/` contains the React interface and map visualization.
- `scripts/` contains build and repository checks.

An analysis is called an **analet** in the source. It holds an analysis statement, its embedding and map position, and links to notebook content. The internal `meridian` names are retained for compatibility with saved workspaces.

## Build and check

```sh
pnpm run typecheck
pnpm run lint:all
pnpm test
pnpm run build
pnpm run check:release
pnpm run package
```

The build writes `out/extension.js` and `webview-ui/dist/`. Packaging produces a `.vsix` file. Rebuild after changing source and restart the Extension Development Host to test the packaged interface.

The Vite development server (`pnpm run dev:webview`) is useful for interface work, but it does not supply the VS Code extension APIs. Verify extension messaging in the Extension Development Host.

## Manual smoke test

Use a temporary working folder and the synthetic `examples/sales.csv`. Keep real datasets and credentials out of bug reports and test fixtures.

1. Build, press **F5**, and run **Open Ptolemy Sidebar**. The sidebar should load without a blank screen or activation error.
2. With no API key configured, run **Ptolemy: Test OpenAI Connection**. It should report the missing key without crashing or exposing credentials.
3. Configure a key, reload the host, and repeat the connection test. This contacts OpenAI.
4. Load the CSV. Check that the column names and row count match the file.
5. Generate an analysis and open its notebook. Inspect the generated code before running it. Add an analysis note from a notebook cell and check that it appears in the sidebar.
6. Save a checkpoint, reload the window, and check that the saved analysis can be restored.
7. Install the generated VSIX in a separate VS Code profile and repeat the sidebar and dataset checks.

Automated checks do not cover the full interactive notebook workflow or live OpenAI requests. Include the commands you ran and any manual checks with a pull request.

## Research features and local data

Study mode, interaction recording, and Firebase logging are disabled in the default build and settings. The study controls and recording implementation remain in the source for research use.

Interaction recording may capture interface content, analysis text, dataset values, and notebook activity. Firebase logging requires both `meridian.instrumentation.enabled` and `meridian.firebase.enabled`, plus `FIREBASE_CONFIG` JSON containing `apiKey`, `projectId`, and `appId` for a project you control. Reload the window after changing recording settings. Review the collection paths and obtain appropriate consent before enabling either feature.

For a study build, use `pnpm run build:study`. To supply a survey destination, set `VITE_STUDY_SURVEY_URL` when building the webview; no survey link is enabled by default. The survey URL receives participant and condition identifiers.

Working state can include copies of datasets, notebook metadata, notes, embeddings, and checkpoints. Files under `.meridian/`, `.env` files, recordings, and build artifacts should stay out of source control and extension packages.

## Known limits

- The file picker accepts CSV files up to 10 MB. Larger datasets and other formats are not supported by that path.
- AI-generated analyses and notebook code can be wrong. The map reflects embedding similarity, not statistical evidence.
- Notebook synchronization and checkpoint restoration need manual testing when their storage formats change.

The current Zod 3 dependency is affected by [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5) (memory exhaustion on very large arrays). Moving to the patched major version also requires updating the OpenAI structured-output integration. This advisory remains unresolved; run `pnpm audit --prod` when updating dependencies.
