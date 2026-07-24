// Idempotently creates the ClusterRoleBinding the metrics-fetcher pod needs to pass
// Rancher's own /metrics SubjectAccessReview check.
//
// See /opt/data/sqlite-explorer-metrics-recommendation.md ("Candidate 1") for the full
// investigation this is based on -- summary of the load-bearing facts:
// - Rancher's `/metrics` route is guarded by TokenReviewAuth (accepts ANY token the
//   local apiserver's TokenReview API considers valid, including a plain in-pod
//   ServiceAccount token -- no Rancher-issued token needed) followed by a
//   SubjectAccessReview for `verb=get, group=management.cattle.io, resource=ranchermetrics`
//   with NO Namespace set on resourceAttributes.
// - Because the SAR carries no namespace, only a CLUSTER-scoped RBAC grant satisfies it --
//   a namespaced RoleBinding to the same ClusterRole is REJECTED (confirmed 401 in the
//   investigation's negative control). This is the one non-obvious fact driving this file's
//   design: it must create a ClusterRoleBinding, not reuse the existing namespaced
//   Role/RoleBinding from rbac.ts (which remains unchanged / still required for the
//   dumper's ephemeral-container flow).
// - No new ClusterRole is needed -- Rancher auto-creates `cattle-globalrole-view-rancher-metrics`
//   as soon as the built-in `view-rancher-metrics` GlobalRole exists (stock/default,
//   present with no special enablement).
//
// Uses createResourceRaw (raw POST) exactly like rbac.ts, for the same reasons (uniform
// idiom, avoids relying on per-type client model quirks).
import { DEFAULT_DUMPER_SERVICE_ACCOUNT } from './podSpec';
import { createResourceRaw } from './steveRaw';

export const METRICS_VIEWER_CLUSTER_ROLE = 'cattle-globalrole-view-rancher-metrics';
export const METRICS_CRB_NAME = 'sqlite-explorer-metrics-viewer';

async function findExisting(store: any, type: string, id: string) {
  try {
    return await store.dispatch('cluster/find', { type, id });
  } catch (e) {
    return null;
  }
}

// namespace: the namespace the dumper ServiceAccount lives in (normally cattle-system) --
// ClusterRoleBinding itself is cluster-scoped, but its `subjects[].namespace` still needs
// to point at wherever that ServiceAccount actually is.
export async function ensureMetricsRbac(store: any, namespace: string): Promise<void> {
  const existing = await findExisting(store, 'rbac.authorization.k8s.io.clusterrolebinding', METRICS_CRB_NAME);

  if (existing) {
    return;
  }

  await createResourceRaw(store, 'rbac.authorization.k8s.io.clusterrolebinding', {
    metadata: {
      name:   METRICS_CRB_NAME,
      labels: { 'sqlite-explorer': 'true' },
    },
    roleRef: {
      apiGroup: 'rbac.authorization.k8s.io',
      kind:     'ClusterRole',
      name:     METRICS_VIEWER_CLUSTER_ROLE,
    },
    subjects: [
      { kind: 'ServiceAccount', name: DEFAULT_DUMPER_SERVICE_ACCOUNT, namespace },
    ],
  });
}
