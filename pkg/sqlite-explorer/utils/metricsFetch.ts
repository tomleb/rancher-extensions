// Orchestrates one "Refresh metrics" click: creates the fetcher pod (metricsPodSpec.ts),
// polls until it completes, fetches its stdout via Steve's pod-logs API (the same
// mechanism proven working for the dumper pod's flow -- see rbac.ts/pages/index.vue),
// then parses the Prometheus exposition text for the three steve sqlcache gauges.
//
// Design note: results come back via pod logs, NOT any live response body read directly
// from the fetcher pod's curl call -- see
// /opt/data/sqlite-explorer-metrics-recommendation.md ("Getting results back to the
// browser") for why: there is no live channel the browser can reach from inside the
// fetcher pod without hitting the same proxy-auth problem this whole design avoids.
// Steve's pod-logs endpoint (`GET .../api/v1/namespaces/<ns>/pods/<pod>/log`) is a
// first-class k8s API subresource, forwarded using the browser user's own Steve
// session RBAC -- completely uninvolved with Rancher's /metrics auth chain.
import { buildMetricsFetcherPodSpec, type BuildMetricsFetcherPodSpecArgs } from './metricsPodSpec';
import { createResourceRaw } from './steveRaw';

const POLL_INTERVAL_MS = 1000;
const POLL_MAX_ATTEMPTS = 30; // 30s -- this is a single curl call, should be fast

export interface SqlcacheDbMetrics {
  dbBytes: number | null;
  walBytes: number | null;
  shmBytes: number | null;
}

// Unlabeled gauges, one line each, e.g.:
//   steve_sqlcache_db_bytes 3.551232e+06
//   steve_sqlcache_db_wal_bytes 4.243632e+06
//   steve_sqlcache_db_shm_bytes 32768
// Matches plain integers, decimals, and Go's exponential notation.
const METRIC_PATTERNS: Record<keyof SqlcacheDbMetrics, RegExp> = {
  dbBytes:  /^steve_sqlcache_db_bytes\s+([\d.eE+-]+)/m,
  walBytes: /^steve_sqlcache_db_wal_bytes\s+([\d.eE+-]+)/m,
  shmBytes: /^steve_sqlcache_db_shm_bytes\s+([\d.eE+-]+)/m,
};

export function parseSqlcacheMetrics(prometheusText: string): SqlcacheDbMetrics {
  const result: SqlcacheDbMetrics = { dbBytes: null, walBytes: null, shmBytes: null };

  (Object.keys(METRIC_PATTERNS) as Array<keyof SqlcacheDbMetrics>).forEach((key) => {
    const match = prometheusText.match(METRIC_PATTERNS[key]);

    if (match) {
      const parsed = parseFloat(match[1]);

      if (!Number.isNaN(parsed)) {
        result[key] = parsed;
      }
    }
  });

  return result;
}

export function formatBytes(bytes: number | null): string {
  if (bytes === null || Number.isNaN(bytes)) {
    return '—';
  }
  if (bytes === 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, exponent);

  return `${ value.toFixed(exponent === 0 ? 0 : 2) } ${ units[exponent] }`;
}

// NOTE (found via real browser click-through, 2026-07-24 -- two iterations of this bug):
// 1st attempt built this URL against the raw Kubernetes API-server proxy path prefixed
// with Steve's cluster-proxy tree (`/k8s/clusters/<id>/api/v1/namespaces/<ns>/pods/<name>/log`).
// That path doesn't exist -- Steve routes plain resource requests through its own `v1`
// API, so `/k8s/clusters/<id>/api/v1/...` 404s silently (no thrown error, request just
// resolves to nothing).
// 2nd attempt used `/k8s/clusters/<id>/v1/pods/<ns>/<name>/log` (Steve's OWN `v1` API,
// matching the URL *shape* other resource reads use elsewhere in this codebase) -- this
// returns HTTP 200, but with the POD RESOURCE JSON, not the log text, because Steve's
// `v1` collection API doesn't special-case a `/log` suffix as a log-streaming
// subresource at all -- that's a Kubernetes apiserver concept, not a Steve one.
// The ACTUAL correct mechanism (confirmed by reading Rancher's own log viewer,
// `@rancher/shell/components/Window/ContainerLogs.vue`'s `download()`): fetch the pod
// resource itself first, then GET `${pod.links.view}/log?container=<name>` -- `links.view`
// is a server-computed link Steve attaches to every pod resource pointing at the
// Kubernetes apiserver's own pod-log subresource (e.g., for a pod on the LOCAL cluster,
// this resolves to the top-level `/api/v1/namespaces/<ns>/pods/<name>` -- NOT prefixed
// with `/k8s/clusters/<id>/`, because Rancher's own apiserver IS the local cluster's
// apiserver; on a downstream cluster this would naturally come back proxied instead).
// Never hand-construct this URL -- always resolve it from the pod resource's own
// `links.view`, exactly like the real dashboard code does.
async function fetchPodLogs(store: any, namespace: string, podName: string): Promise<string> {
  const pod = await store.dispatch('cluster/find', { type: 'pod', id: `${ namespace }/${ podName }` });
  const viewLink = pod?.links?.view;

  if (!viewLink) {
    throw new Error(`Pod ${ namespace }/${ podName } has no links.view -- cannot fetch its logs.`);
  }

  const container = pod?.spec?.containers?.[0]?.name;
  const url = container ? `${ viewLink }/log?container=${ encodeURIComponent(container) }` : `${ viewLink }/log`;

  return store.dispatch('cluster/request', { url, method: 'get' });
}

export async function fetchPodMetrics(
  store: any,
  args: BuildMetricsFetcherPodSpecArgs
): Promise<SqlcacheDbMetrics> {
  const spec = buildMetricsFetcherPodSpec(args);

  const pod = await createResourceRaw(store, 'pod', {
    metadata: spec.metadata,
    spec:     spec.spec,
  });

  const namespace = pod.metadata.namespace;
  const name = pod.metadata.name;

  try {
    for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

      // eslint-disable-next-line no-await-in-loop
      const fresh = await store.dispatch('cluster/find', { type: 'pod', id: `${ namespace }/${ name }` });
      const phase = fresh.status?.phase;

      if (phase === 'Succeeded' || phase === 'Failed') {
        // eslint-disable-next-line no-await-in-loop
        const logs = await fetchPodLogs(store, namespace, name);

        // The steve store's `cluster/request` action does NOT return a plain string for
        // this endpoint -- it returns the raw axios-shaped response object
        // (`{ data, _status, _statusText, _headers, _req, ... }`) because the response
        // Content-Type isn't `application/json` (it's the pod-log endpoint's plain text).
        // Found via real browser click-through (2026-07-24): the code originally did
        // `typeof logs === 'string' ? logs : String(logs)`, which stringified the whole
        // response object to the literal text "[object Object]" instead of unwrapping
        // `.data` -- silently producing a value with no metric lines to match, so every
        // parsed field came back null (rendered as "—" in the UI) with no thrown error
        // anywhere in the chain. Always prefer `.data` when the response isn't already
        // a plain string.
        const logText = typeof logs === 'string' ? logs : (logs as any)?.data ?? String(logs);

        return parseSqlcacheMetrics(logText);
      }
    }

    throw new Error('Timed out waiting for the metrics-fetcher pod to complete.');
  } finally {
    // Best-effort cleanup -- this pod's only purpose was the one curl call, no reason
    // to leave it around cluttering cattle-system the way the dumper/viewer pod
    // intentionally is (that one still serves the Datasette UI, this one doesn't).
    // Uses the pod resource's own `links.remove` (same fix as fetchPodLogs above --
    // never hand-construct Steve/k8s API URLs when the resource already carries the
    // correct link).
    try {
      const fresh = await store.dispatch('cluster/find', { type: 'pod', id: `${ namespace }/${ name }` });
      const removeLink = fresh?.links?.remove;

      if (removeLink) {
        await store.dispatch('cluster/request', { url: removeLink, method: 'delete' });
      }
    } catch (e) {
      // non-fatal -- leaving a completed pod behind is harmless, just untidy
    }
  }
}
