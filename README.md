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
- **[proxy-tester](./pkg/proxy-tester)** — Adds a page to test the `/meta/proxy`
  endpoint

# Installing

1. Go to local cluster
2. Go to Apps -> Repositories. Click on Add Repositories.
3. Add Helm Repository with following Index URL: https://tomleb.github.io/rancher-extensions
4. Go to Extensions tab in the sidebar
5. Find and install the extensions

# Development

Only requirements is docker. Run the following command and then you can go to
https://localhost:8005.

```sh
make dev API=<your-Rancher-URL>
```

# Releasing

The following instructions will build and publish the extension to Github Pages
(in `gh-pages` branch).

1. Tag a new release this way: `<extension-name>-<version>` (eg:
   `sqlite-explorer-0.1.0`)
2. Manually create a Github release for that new tag (this triggers a workflow)
