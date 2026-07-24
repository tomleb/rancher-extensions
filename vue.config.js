const config = require('@rancher/shell/vue.config'); // eslint-disable-line @typescript-eslint/no-var-requires

const base = config(__dirname, {
  excludes: [],
  // excludes: ['fleet', 'example']
});

// Allow the dev server to be reached via a Traefik-proxied hostname (see DEV.md) —
// webpack-dev-server's default allowedHosts check rejects unrecognized Host headers.
base.devServer = {
  ...base.devServer,
  allowedHosts: 'all',
};

module.exports = base;
