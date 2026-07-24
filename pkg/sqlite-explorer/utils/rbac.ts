// Idempotently creates the ServiceAccount + Role + RoleBinding the dumper container
// needs (see assets/dumper-rbac.yaml -- kept in sync manually, this is the same RBAC
// expressed as Steve/dashboard store dispatch calls instead of a static manifest).
//
// Verified live (2026-07-23) against a real k3d Rancher instance: creating a pod with
// serviceAccountName pointed at this exact Role successfully ran `kubectl debug
// --target=` + `kubectl exec`/`cp` against the target rancher pod, and the resulting
// Datasette viewer served real queryable data through Rancher's own pod-proxy endpoint.
// The default ServiceAccount in cattle-system has `automountServiceAccountToken: false`
// and no RBAC at all, so this step is not optional.
//
// Uses createResourceRaw (raw POST, bypassing client-side model wrappers) throughout --
// see steveRaw.ts for why (Rancher's own Pod model has unrelated save() override
// behavior that doesn't apply to ServiceAccount/Role/RoleBinding, but using the same
// raw-create path for everything keeps this code uniform and avoids relying on
// per-type model quirks that could change between shell versions).
import { DEFAULT_DUMPER_SERVICE_ACCOUNT } from './podSpec';
import { createResourceRaw } from './steveRaw';

async function findExisting(store: any, type: string, id: string) {
  try {
    return await store.dispatch('cluster/find', { type, id });
  } catch (e) {
    return null;
  }
}

export async function ensureDumperRbac(store: any, namespace: string): Promise<void> {
  const name = DEFAULT_DUMPER_SERVICE_ACCOUNT;

  const existingSa = await findExisting(store, 'serviceaccount', `${ namespace }/${ name }`);

  if (!existingSa) {
    await createResourceRaw(store, 'serviceaccount', {
      metadata: {
        name,
        namespace,
        labels: { 'sqlite-explorer': 'true' },
      },
    });
  }

  const existingRole = await findExisting(store, 'rbac.authorization.k8s.io.role', `${ namespace }/${ name }`);

  if (!existingRole) {
    await createResourceRaw(store, 'rbac.authorization.k8s.io.role', {
      metadata: {
        name,
        namespace,
        labels: { 'sqlite-explorer': 'true' },
      },
      rules: [
        { apiGroups: [''], resources: ['pods'], verbs: ['get', 'list'] },
        { apiGroups: [''], resources: ['pods/ephemeralcontainers'], verbs: ['patch', 'update', 'get'] },
        { apiGroups: [''], resources: ['pods/exec'], verbs: ['create'] },
        { apiGroups: [''], resources: ['pods/log'], verbs: ['get'] },
      ],
    });
  }

  const existingBinding = await findExisting(store, 'rbac.authorization.k8s.io.rolebinding', `${ namespace }/${ name }`);

  if (!existingBinding) {
    await createResourceRaw(store, 'rbac.authorization.k8s.io.rolebinding', {
      metadata: {
        name,
        namespace,
        labels: { 'sqlite-explorer': 'true' },
      },
      roleRef: {
        apiGroup: 'rbac.authorization.k8s.io',
        kind:     'Role',
        name,
      },
      subjects: [
        { kind: 'ServiceAccount', name, namespace },
      ],
    });
  }
}
