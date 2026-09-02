// Builds the whoami Deployment + Service pair (traefik/whoami -- a trivial HTTP echo
// server) used to give proxy-tester a known-good, always-reachable target on the local
// cluster for exercising /meta/proxy end to end.
//
// A stable Service DNS name (`<name>.<namespace>.svc`) is used rather than a bare Pod IP
// because Pod IPs churn on restart/reschedule -- the whole point of this helper is a URL
// that stays valid for the lifetime of the deployment, not just until the pod restarts.
export const WHOAMI_NAMESPACE = 'cattle-proxy-tester';
export const WHOAMI_NAME = 'whoami';
export const WHOAMI_IMAGE = 'traefik/whoami:latest';
export const WHOAMI_PORT = 80;

// Cluster-internal DNS name -- reachable from any pod on the cluster, including
// Rancher's own server pod (which is what actually issues the /meta/proxy outbound
// call). The short 2-label form (name.namespace) already resolves within-cluster; the
// full form is included in the label for clarity when copy-pasted elsewhere.
export function whoamiServiceUrl(): string {
  return `http://${ WHOAMI_NAME }.${ WHOAMI_NAMESPACE }.svc:${ WHOAMI_PORT }/`;
}

export function buildWhoamiNamespaceSpec() {
  return {
    type:     'namespace',
    metadata: { name: WHOAMI_NAMESPACE, labels: { 'proxy-tester': 'true' } },
  };
}

export function buildWhoamiDeploymentSpec() {
  return {
    type:     'apps.deployment',
    metadata: {
      name:      WHOAMI_NAME,
      namespace: WHOAMI_NAMESPACE,
      labels:    { 'proxy-tester': 'true', app: WHOAMI_NAME },
    },
    spec: {
      replicas: 1,
      selector: { matchLabels: { app: WHOAMI_NAME } },
      template: {
        metadata: { labels: { app: WHOAMI_NAME } },
        spec:     {
          containers: [
            {
              name:  WHOAMI_NAME,
              image: WHOAMI_IMAGE,
              ports: [{ containerPort: WHOAMI_PORT, name: 'http' }],
            },
          ],
        },
      },
    },
  };
}

export function buildWhoamiServiceSpec() {
  return {
    type:     'service',
    metadata: {
      name:      WHOAMI_NAME,
      namespace: WHOAMI_NAMESPACE,
      labels:    { 'proxy-tester': 'true' },
    },
    spec: {
      selector: { app: WHOAMI_NAME },
      ports:    [{ port: WHOAMI_PORT, targetPort: WHOAMI_PORT, protocol: 'TCP' }],
    },
  };
}
