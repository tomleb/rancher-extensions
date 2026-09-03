// Builds the two http-https-echo (mendhak/http-https-echo --
// https://github.com/mendhak/docker-http-https-echo) Deployment + Service pairs used to
// give proxy-tester known-good, always-reachable targets on the local cluster for
// exercising /meta/proxy end to end. Replaces the earlier traefik/whoami-based targets --
// whoami doesn't echo ALL request headers back (only a curated subset), whereas
// http-https-echo dumps the full incoming request (method, path, ALL headers, body,
// cookies) verbatim as JSON, which is what's actually needed to verify exactly what
// /meta/proxy forwards/strips/rewrites.
//
// Two variants, same image, different port/env config:
// - plain HTTP  (echoHttpServiceUrl())  -- HTTP_PORT only, HTTPS_PORT unset
// - self-signed HTTPS (echoHttpsServiceUrl()) -- HTTPS_PORT only, HTTP_PORT unset
//
// The image ships its OWN built-in self-signed cert for its HTTPS listener -- confirmed
// live (docker run + curl): `curl -k https://...:8443/` returns 200, and a normal `curl`
// without `-k` fails with an SSL cert error (exit 60), i.e. genuinely self-signed/
// untrusted, exactly like the earlier custom-cert whoami-tls setup, but with NO alpine
// initContainer/openssl step needed -- the image handles cert generation internally.
//
// A stable Service DNS name (`<name>.<namespace>.svc`) is used rather than a bare Pod IP
// because Pod IPs churn on restart/reschedule -- the whole point of this helper is a URL
// that stays valid for the lifetime of the deployment, not just until the pod restarts.
export const ECHO_NAMESPACE = 'cattle-proxy-tester';
export const ECHO_HTTP_NAME = 'echo-http';
export const ECHO_HTTPS_NAME = 'echo-https';
export const ECHO_IMAGE = 'mendhak/http-https-echo:latest';
export const ECHO_HTTP_PORT = 8080;
export const ECHO_HTTPS_PORT = 8443;

// Cluster-internal DNS names -- reachable from any pod on the cluster, including
// Rancher's own server pod (which is what actually issues the /meta/proxy outbound
// call). The short 2-label form (name.namespace) already resolves within-cluster; the
// full form is included in the label for clarity when copy-pasted elsewhere.
export function echoHttpServiceUrl(): string {
  return `http://${ ECHO_HTTP_NAME }.${ ECHO_NAMESPACE }.svc:${ ECHO_HTTP_PORT }/`;
}

export function echoHttpsServiceUrl(): string {
  return `https://${ ECHO_HTTPS_NAME }.${ ECHO_NAMESPACE }.svc:${ ECHO_HTTPS_PORT }/`;
}

export function buildEchoNamespaceSpec() {
  return {
    type:     'namespace',
    metadata: { name: ECHO_NAMESPACE, labels: { 'proxy-tester': 'true' } },
  };
}

function buildEchoDeploymentSpec(name: string, port: number, httpEnv: boolean) {
  return {
    type:     'apps.deployment',
    metadata: {
      name,
      namespace: ECHO_NAMESPACE,
      labels:    { 'proxy-tester': 'true', app: name },
    },
    spec: {
      replicas: 1,
      selector: { matchLabels: { app: name } },
      template: {
        metadata: { labels: { app: name } },
        spec:     {
          containers: [
            {
              name,
              image: ECHO_IMAGE,
              env:   [{ name: httpEnv ? 'HTTP_PORT' : 'HTTPS_PORT', value: String(port) }],
              ports: [{ containerPort: port, name: httpEnv ? 'http' : 'https' }],
            },
          ],
        },
      },
    },
  };
}

function buildEchoServiceSpec(name: string, port: number) {
  return {
    type:     'service',
    metadata: {
      name,
      namespace: ECHO_NAMESPACE,
      labels:    { 'proxy-tester': 'true' },
    },
    spec: {
      selector: { app: name },
      ports:    [{ port, targetPort: port, protocol: 'TCP' }],
    },
  };
}

export function buildEchoHttpDeploymentSpec() {
  return buildEchoDeploymentSpec(ECHO_HTTP_NAME, ECHO_HTTP_PORT, true);
}

export function buildEchoHttpServiceSpec() {
  return buildEchoServiceSpec(ECHO_HTTP_NAME, ECHO_HTTP_PORT);
}

export function buildEchoHttpsDeploymentSpec() {
  return buildEchoDeploymentSpec(ECHO_HTTPS_NAME, ECHO_HTTPS_PORT, false);
}

export function buildEchoHttpsServiceSpec() {
  return buildEchoServiceSpec(ECHO_HTTPS_NAME, ECHO_HTTPS_PORT);
}
