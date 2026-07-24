import { podProxyUrlFromParts } from '../proxyUrl';

describe('podProxyUrlFromParts', () => {
  it('builds the expected pod-proxy URL shape', () => {
    const url = podProxyUrlFromParts('c-abc12', 'cattle-system', 'sqlite-explorer-1234', 8001);

    expect(url).toBe('/k8s/clusters/c-abc12/api/v1/namespaces/cattle-system/pods/sqlite-explorer-1234:8001/proxy/');
  });

  it('appends a path when provided', () => {
    const url = podProxyUrlFromParts('c-abc12', 'cattle-system', 'sqlite-explorer-1234', 8001, '/query');

    expect(url).toBe('/k8s/clusters/c-abc12/api/v1/namespaces/cattle-system/pods/sqlite-explorer-1234:8001/proxy/query');
  });

  it('strips leading slashes from path to avoid double slashes', () => {
    const url = podProxyUrlFromParts('c-abc12', 'cattle-system', 'sqlite-explorer-1234', 8001, '///query');

    expect(url).toBe('/k8s/clusters/c-abc12/api/v1/namespaces/cattle-system/pods/sqlite-explorer-1234:8001/proxy/query');
  });
});
