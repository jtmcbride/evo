# Public preview

Repository: <https://github.com/jtmcbride/evo>

Workbench: <https://jmcbride.site/evo/> (the account's existing Pages domain). The GitHub address is <https://jtmcbride.github.io/evo/>.

The public preview is an exploratory workbench. Training and saves run in the visitor's browser; closing the page stops computation. Export `.evolab` files to keep independent backups. Browser storage is local to this site and browser profile; localhost saves do not automatically appear on Pages.

## Publishing

The repository's Pages publishing source is **GitHub Actions**. `.github/workflows/pages.yml` checks type safety, lint, engine/runtime/persistence tests, and production Chromium acceptance on pull requests and pushes to `main`. Only successful `main` builds deploy. The workflow uses GitHub's [custom Pages workflow](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages) artifact/deployment actions.

The deployment build explicitly sets `VITE_BASE_PATH=/evo/`. Vite emits the app, diagnostic page, simulation worker, archive worker, and static assets under that repository subpath. If the repository is renamed, update both this base and the production browser-test base in `playwright.config.ts`.

Run the same checks locally with Node 24.18.0:

```sh
npm ci
npm run typecheck
npm run lint
npm run test:engine
npx playwright install chromium
npm run test:browser
VITE_BASE_PATH=/evo/ npm run build
```

The long scientific benchmark is deliberately separate from deployment checks. The [completed frozen benchmark](benchmarks/benchmark-open-v1.md) and [release evidence](release.md) record all 20 × 200 runs, separate held-out evaluation, representative Chromium-authored example archives, Firefox/WebKit acceptance, and measured runtime limits. The manual **Release browser matrix** workflow runs all three browser projects. Firefox's functional project excludes the documented axe scanner crash; Chromium/WebKit retain full automated accessibility scans.

The [initial publication pilot](benchmarks/m10-short-pilot.md) records the bounded three-run check performed after the first public push.
