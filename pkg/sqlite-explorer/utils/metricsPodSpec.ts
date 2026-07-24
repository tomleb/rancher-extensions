// Builds the short-lived "metrics fetcher" Pod spec used by the per-pod "Refresh
// metrics" button (see NOTES.md / pages/index.vue).
//
// Design (see /opt/data/sqlite-explorer-metrics-recommendation.md -- proven live against
// a real k3d cluster, do not re-derive):
// - Single container, `curl`, with its OWN ServiceAccount token (automountServiceAccountToken:
//   true) as the Authorization bearer -- NOT a proxy through Steve's pod-proxy subresource.
// - Rancher's `/metrics` route runs `TokenReviewAuth` against the LOCAL cluster's own
//   apiserver, so any valid ServiceAccount JWT authenticates, then a SubjectAccessReview
//   (verb=get, group=management.cattle.io, resource=ranchermetrics, no namespace) gates
//   access -- satisfied by binding the SA to the existing built-in ClusterRole
//   `cattle-globalrole-view-rancher-metrics` via a ClusterRoleBinding (see metricsRbac.ts).
// - Target host: the specific pod's IP (reachable cross-namespace with no special
//   networking, confirmed in the recommendation doc) on port 443 -- this lets the
//   "Refresh metrics" button work per-pod-row (e.g. distinguishing HA rancher replicas),
//   not just "the Rancher Service" in aggregate.
// - Container writes curl's stdout directly (no redirection) -- the extension reads the
//   result back via Steve's pod-logs API, mirroring the existing dumper-pod pattern.
import type { AppType } from './podSpec';
import { DEFAULT_DUMPER_SERVICE_ACCOUNT } from './podSpec';

export interface BuildMetricsFetcherPodSpecArgs {
  appType: AppType;
  targetPodName: string;
  targetPodIp: string;
  namespace?: string;
  serviceAccountName?: string;
  curlImage?: string;
}

const DEFAULT_NAMESPACE = 'cattle-system';
const DEFAULT_CURL_IMAGE = 'curlimages/curl:8.8.0';

// Reuses the same dumper ServiceAccount (see podSpec.ts's DEFAULT_DUMPER_SERVICE_ACCOUNT)
// for both duties -- ensureMetricsRbac() just adds one more ClusterRoleBinding on top of
// the existing Role/RoleBinding, rather than creating a second, parallel ServiceAccount.
export const DEFAULT_METRICS_SERVICE_ACCOUNT = DEFAULT_DUMPER_SERVICE_ACCOUNT;

export function buildMetricsFetcherPodName(): string {
  return `sqlite-explorer-metrics-${ Date.now() }`;
}

export function buildMetricsFetcherPodSpec({
  appType,
  targetPodName,
  targetPodIp,
  namespace = DEFAULT_NAMESPACE,
  serviceAccountName = DEFAULT_METRICS_SERVICE_ACCOUNT,
  curlImage = DEFAULT_CURL_IMAGE,
}: BuildMetricsFetcherPodSpecArgs) {
  const name = buildMetricsFetcherPodName();
  // Token is read fresh from the pod's own mounted SA token file at request time (not
  // baked in at pod-creation time). Built as a separate shell var (rather than inlined
  // directly into the -H flag) purely for readability; behavior is identical either way.
  const curlCommand = 'TOKEN=$(cat /var/run/secrets/kubernetes.io/serviceaccount/token); '
    + `curl -sk -H "Authorization: ${ 'Bearer' } $TOKEN" https://${ targetPodIp }:443/metrics`;

  return {
    type:     'pod',
    metadata: {
      name,
      namespace,
      labels: {
        'sqlite-explorer':      'true',
        'sqlite-explorer/type': 'metrics-fetch',
        'sqlite-explorer/target-app': appType,
      },
    },
    spec: {
      restartPolicy:               'Never',
      serviceAccountName,
      automountServiceAccountToken: true,
      containers: [
        {
          name:    'curl',
          image:   curlImage,
          // -k: target's cert is self-signed.
          command: ['sh', '-c', curlCommand],
          env:     [
            { name: 'TARGET_POD', value: targetPodName },
            { name: 'TARGET_NAMESPACE', value: namespace },
          ],
        },
      ],
    },
  };
}
