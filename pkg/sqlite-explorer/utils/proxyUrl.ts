// Mirrors dashboard's existing shell/models/service.js `proxyUrlFromParts`/`proxyUrlFromBase`
// helpers, but for the Pod subresource instead of Service. Kubernetes exposes the same
// generic `.../<resource>/<scheme>:<name>:<port>/proxy/<path>` subresource shape for both
// Pods and Services -- Rancher's dashboard just hasn't shipped a pod-flavored helper yet.
export function podProxyUrlFromParts(
  clusterId: string,
  namespace: string,
  podName: string,
  port: number,
  path = ''
): string {
  const base = `/k8s/clusters/${ encodeURIComponent(clusterId) }/api/v1/namespaces/${ encodeURIComponent(namespace) }/pods`;
  const cleanPath = `/${ path.replace(/^\/+/, '') }`;

  return `${ base }/${ encodeURIComponent(podName) }:${ port }/proxy${ cleanPath }`;
}
