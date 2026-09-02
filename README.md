# rancher-extensions

Rancher Dashboard UI extensions, developed as a single "dev app" skeleton
(`@rancher/create-extension`) hosting one or more extension packages under `pkg/`.

## Extensions in this repo

- **[sqlite-explorer](./pkg/sqlite-explorer)** — Adds a "SQLite Explorer" page (under a
  "Troubleshooting" sidebar group) to the Cluster Explorer. Lists the `rancher` /
  `cattle-cluster-agent` pods running in `cattle-system` for the current cluster and
  lets you spin up a short-lived pod that dumps a consistent snapshot of steve's
  informer object cache SQLite DB and serves it read-only via
  [Datasette](https://datasette.io), proxied through Rancher itself (no
  Ingress/LoadBalancer needed). MVP — sessions are not automatically cleaned up; delete
  the pod manually in `cattle-system` when done.

## Development

Requires Node >=24 and Yarn 4.5 (via corepack). If you don't have those installed
locally, everything can run inside a `node:24` Docker container instead — see
[`pkg/sqlite-explorer`'s own notes](./pkg/sqlite-explorer) or run directly:

```sh
corepack enable
yarn install
API=<your-Rancher-URL> yarn dev
```

Then open `https://localhost:8005` (or wherever you've proxied port 8005) and log in
to your Rancher instance to see the extension loaded.

### Using Docker (no local Node/Yarn required)

```sh
make dev API=<your-Rancher-URL>
```

This builds a small `node:24-bookworm` image (`Dockerfile.dev`) with Yarn 4.5 enabled
via corepack, then runs it with:
- the repo bind-mounted into `/work` (so `node_modules`/edits persist on the host and
  hot-reload works normally),
- port `8005` published to the host,
- `API` passed through to `yarn dev` inside the container.

Same result as running the commands above directly — open `https://localhost:8005` and
log in to `$API` to see the extension loaded. `Ctrl-C` stops the container (`--rm`, so
nothing lingers). Re-running `make dev` reuses the cached `node_modules` from the bind
mount and skips straight to `yarn dev` after `yarn install` finds nothing new to do.

## Building & publishing

```sh
yarn build-pkg <extension-name>     # builds the extension as a standalone JS library
yarn publish-pkgs -s <owner/repo>   # packages Helm charts for all pkg/* extensions
```

Tagged GitHub Releases (`<extension-folder-name>-<version>`, e.g. `sqlite-explorer-0.1.0`)
trigger `.github/workflows/build-extension-charts.yml`, which builds Helm charts for
every extension in `pkg/` and publishes them to the `gh-pages` branch. Once GitHub Pages
is enabled (Settings → Pages → Source: GitHub Actions), the resulting chart repo is
served at `https://tomleb.github.io/rancher-extensions` — add that URL under
**Apps → Repositories** in Rancher to see these extensions on the Extensions page.
