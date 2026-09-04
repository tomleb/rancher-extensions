// `this.$shell.proxy.allowDomains()` (@rancher/shell's ProxyApi, currently v3.0.13) only
// builds `{ domain }` route entries -- it doesn't expose `caBundle`/`insecureSkipVerify`,
// and this extension has no build-time link to the @rancher/shell *source* (the installed
// node_modules/@rancher/shell is a normal published package, not a symlink into any local
// checkout of it) -- so extending those fields there isn't an option from here. This
// mirrors ProxyApiImpl.allowDomains()'s own `management/create` + `.save()` pattern
// (see @rancher/shell/apis/shell/proxy.ts) with the extra per-route fields bolted on.
import { MANAGEMENT } from '@shell/config/types';

export interface ProxyEndpointRouteInput {
  /** Bare hostname or wildcard pattern, e.g. `api.example.com` or `%.amazonaws.com`. */
  domain: string;

  /**
   * PEM CA bundle, base64-encoded (i.e. `[]byte` JSON form -- same convention as a
   * Secret's `.data` values, NOT a raw multi-line PEM block). See
   * ProxyEndpointSpec.CABundle in rancher/rancher's proxy_types.go.
   */
  caBundle?: string;

  /** Skip TLS verification entirely for this domain. When true, `caBundle` is ignored. */
  insecureSkipVerify?: boolean;
}

// Creates a `ProxyEndpoint` CR with per-route `caBundle`/`insecureSkipVerify`, which
// `this.$shell.proxy.allowDomains()` doesn't support (see module comment above).
export async function allowDomainsWithOptions(store: any, routes: ProxyEndpointRouteInput[], name?: string): Promise<any> {
  const metadata: any = name ? { name } : { generateName: 'endpoints-' };

  const resource = await store.dispatch('management/create', {
    type: MANAGEMENT.PROXY_ENDPOINT,
    metadata,
    spec: {
      routes: routes.map(({ domain, caBundle, insecureSkipVerify }) => ({
        domain,
        ...(caBundle ? { caBundle } : {}),
        ...(insecureSkipVerify ? { insecureSkipVerify } : {}),
      })),
    },
  });

  return resource.save();
}
