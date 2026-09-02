// proxy-tester only makes sense running against the `local` cluster -- the meta proxy's
// outbound HTTP calls are made from the Rancher SERVER's own pod, not from any
// downstream cluster's agent, so a `<name>.<namespace>.svc` DNS name is only reachable
// via /meta/proxy when the target pod/service lives in the same cluster Rancher itself
// runs in (normally `local`). Hardcoded rather than exposed as a UI field/param since
// this extension is local-cluster-only by design.
export const LOCAL_CLUSTER_ID = 'local';

function collectionUrl(type: string): string {
  return `/k8s/clusters/${ LOCAL_CLUSTER_ID }/v1/${ type }`;
}

function resourceUrl(type: string, namespace: string, name: string): string {
  return `${ collectionUrl(type) }/${ encodeURIComponent(namespace) }/${ encodeURIComponent(name) }`;
}

export async function localFindOrNull(store: any, type: string, namespace: string, name: string): Promise<any> {
  try {
    return await store.dispatch('management/request', { url: resourceUrl(type, namespace, name), method: 'get' });
  } catch (e: any) {
    if (e?._status === 404 || e?.status === 404) {
      return null;
    }
    throw e;
  }
}

export async function localCreate(store: any, type: string, body: any): Promise<any> {
  return store.dispatch('management/request', {
    url:    collectionUrl(type),
    method: 'post',
    data:   { type, ...body },
  });
}

export async function localDelete(store: any, type: string, namespace: string, name: string): Promise<void> {
  await store.dispatch('management/request', { url: resourceUrl(type, namespace, name), method: 'delete' });
}
