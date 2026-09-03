// Builds the whoami Deployment + Service pairs (traefik/whoami -- a trivial HTTP echo
// server) used to give proxy-tester known-good, always-reachable targets on the local
// cluster for exercising /meta/proxy end to end. Two variants are deployed together:
// - plain HTTP  (whoamiServiceUrl())
// - self-signed HTTPS (whoamiTlsServiceUrl()) -- for exercising /meta/proxy against a
//   target with an untrusted certificate, which is exactly the case rancher/rancher#53667
//   ("Dynamic Certificate Handling in ProxyEndpoint CRD") is about.
//
// A stable Service DNS name (`<name>.<namespace>.svc`) is used rather than a bare Pod IP
// because Pod IPs churn on restart/reschedule -- the whole point of this helper is a URL
// that stays valid for the lifetime of the deployment, not just until the pod restarts.
export const WHOAMI_NAMESPACE = 'cattle-proxy-tester';
export const WHOAMI_NAME = 'whoami';
export const WHOAMI_TLS_NAME = 'whoami-tls';
export const WHOAMI_IMAGE = 'traefik/whoami:latest';
export const WHOAMI_PORT = 80;
export const WHOAMI_TLS_PORT = 443;

// whoami has no shell/openssl of its own (distroless-style binary, confirmed via
// `docker run --entrypoint sh` failing with "executable file not found") -- an alpine
// initContainer generates a self-signed cert/key into a shared emptyDir before the
// whoami container starts, so the whole thing is self-contained (no external
// cert-manager dependency, no client-side crypto in the browser).
const CERT_GEN_IMAGE = 'alpine:latest';
const CERT_VOLUME = 'tls-certs';
const CERT_DIR = '/certs';

// Cluster-internal DNS names -- reachable from any pod on the cluster, including
// Rancher's own server pod (which is what actually issues the /meta/proxy outbound
// call). The short 2-label form (name.namespace) already resolves within-cluster; the
// full form is included in the label for clarity when copy-pasted elsewhere.
export function whoamiServiceUrl(): string {
  return `http://${ WHOAMI_NAME }.${ WHOAMI_NAMESPACE }.svc:${ WHOAMI_PORT }/`;
}

export function whoamiTlsServiceUrl(): string {
  return `https://${ WHOAMI_TLS_NAME }.${ WHOAMI_NAMESPACE }.svc:${ WHOAMI_TLS_PORT }/`;
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

// Self-signed HTTPS variant. The generated cert's CN/SAN cover the Service's own DNS
// name so a client validating hostname-vs-cert (rather than just presence of TLS) sees
// a *plausible* cert -- still untrusted (self-signed, no real CA), which is the point.
export function buildWhoamiTlsDeploymentSpec() {
  const fqdn = `${ WHOAMI_TLS_NAME }.${ WHOAMI_NAMESPACE }.svc`;
  const genCertScript = [
    'apk add --no-cache openssl >/dev/null',
    `openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
      -keyout ${ CERT_DIR }/tls.key -out ${ CERT_DIR }/tls.crt \
      -subj "/CN=${ fqdn }" \
      -addext "subjectAltName=DNS:${ fqdn },DNS:${ WHOAMI_TLS_NAME },DNS:localhost"`,
  ].join(' && ');

  return {
    type:     'apps.deployment',
    metadata: {
      name:      WHOAMI_TLS_NAME,
      namespace: WHOAMI_NAMESPACE,
      labels:    { 'proxy-tester': 'true', app: WHOAMI_TLS_NAME },
    },
    spec: {
      replicas: 1,
      selector: { matchLabels: { app: WHOAMI_TLS_NAME } },
      template: {
        metadata: { labels: { app: WHOAMI_TLS_NAME } },
        spec:     {
          volumes: [{ name: CERT_VOLUME, emptyDir: {} }],
          initContainers: [
            {
              name:         'gen-cert',
              image:        CERT_GEN_IMAGE,
              command:      ['sh', '-c', genCertScript],
              volumeMounts: [{ name: CERT_VOLUME, mountPath: CERT_DIR }],
            },
          ],
          containers: [
            {
              name:         WHOAMI_TLS_NAME,
              image:        WHOAMI_IMAGE,
              args:         ['-port', String(WHOAMI_TLS_PORT), '-cert', `${ CERT_DIR }/tls.crt`, '-key', `${ CERT_DIR }/tls.key`],
              ports:        [{ containerPort: WHOAMI_TLS_PORT, name: 'https' }],
              volumeMounts: [{ name: CERT_VOLUME, mountPath: CERT_DIR, readOnly: true }],
            },
          ],
        },
      },
    },
  };
}

export function buildWhoamiTlsServiceSpec() {
  return {
    type:     'service',
    metadata: {
      name:      WHOAMI_TLS_NAME,
      namespace: WHOAMI_NAMESPACE,
      labels:    { 'proxy-tester': 'true' },
    },
    spec: {
      selector: { app: WHOAMI_TLS_NAME },
      ports:    [{ port: WHOAMI_TLS_PORT, targetPort: WHOAMI_TLS_PORT, protocol: 'TCP' }],
    },
  };
}

// Third variant: mendhak/http-https-echo (https://github.com/mendhak/docker-http-https-echo)
// -- a Node-based echo server that dumps the full incoming request (method, path,
// headers, body) as JSON. HTTP-only per Tom's request, even though the image also
// supports HTTPS on a separate port (HTTPS_PORT env var / 8443) -- we simply never set
// that env var or expose that port, so only the HTTP listener (port 8080 by default,
// confirmed via `docker inspect` ExposedPorts/Env) is used. Useful specifically for
// inspecting exactly what /meta/proxy forwards (e.g. confirming header stripping/
// rewriting, body passthrough) since it echoes the raw request back verbatim, unlike
// whoami which only reports server-side info.
export const ECHO_NAME = 'echo';
export const ECHO_IMAGE = 'mendhak/http-https-echo:latest';
export const ECHO_PORT = 8080;

export function echoServiceUrl(): string {
  return `http://${ ECHO_NAME }.${ WHOAMI_NAMESPACE }.svc:${ ECHO_PORT }/`;
}

export function buildEchoDeploymentSpec() {
  return {
    type:     'apps.deployment',
    metadata: {
      name:      ECHO_NAME,
      namespace: WHOAMI_NAMESPACE,
      labels:    { 'proxy-tester': 'true', app: ECHO_NAME },
    },
    spec: {
      replicas: 1,
      selector: { matchLabels: { app: ECHO_NAME } },
      template: {
        metadata: { labels: { app: ECHO_NAME } },
        spec:     {
          containers: [
            {
              name:  ECHO_NAME,
              image: ECHO_IMAGE,
              env:   [{ name: 'HTTP_PORT', value: String(ECHO_PORT) }],
              ports: [{ containerPort: ECHO_PORT, name: 'http' }],
            },
          ],
        },
      },
    },
  };
}

export function buildEchoServiceSpec() {
  return {
    type:     'service',
    metadata: {
      name:      ECHO_NAME,
      namespace: WHOAMI_NAMESPACE,
      labels:    { 'proxy-tester': 'true' },
    },
    spec: {
      selector: { app: ECHO_NAME },
      ports:    [{ port: ECHO_PORT, targetPort: ECHO_PORT, protocol: 'TCP' }],
    },
  };
}
