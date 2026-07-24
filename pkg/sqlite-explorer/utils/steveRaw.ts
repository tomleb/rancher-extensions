// Creates a Steve/Kubernetes resource via a raw POST to its collection URL, bypassing
// the higher-level `dispatch('cluster/create', {...}); obj.save()` pattern.
//
// Why this is needed: Rancher's own client-side `Pod` model (shell/models/pod.js)
// overrides `save()` to unconditionally destructure `this.spec.template` -- code clearly
// written for their "create a Pod via the workload-creation UI" flow, which stashes a
// pending workload template there before saving. A plain, hand-built Pod spec (like
// ours) has no `spec.template`, so calling `.save()` on a `cluster/create`-produced Pod
// model throws `Cannot destructure property 'metadata' of 'this.spec.template' as it is
// undefined` -- confirmed live against a real Rancher instance (2026-07-23). This is
// Rancher's own model behavior, not something we can configure around from outside it.
//
// Fix: skip the Pod model wrapper entirely for pod creation and POST directly to the
// collection URL (same technique Rancher's own `resourceAction`/`collectionAction`
// actions use internally -- see shell/plugins/steve/actions.js).
export async function createResourceRaw(store: any, type: string, body: any): Promise<any> {
  const schema = store.getters['cluster/schemaFor'](type);

  if (!schema) {
    throw new Error(`No schema found for type "${ type }" -- is it available on this cluster?`);
  }

  const url = schema.links.collection;

  const res = await store.dispatch('cluster/request', {
    url,
    method: 'post',
    data:   { type, ...body },
  });

  return res;
}
