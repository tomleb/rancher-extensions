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
// - self-signed HTTPS (echoHttpsServiceUrl()) -- HTTPS_PORT set, plus a custom cert (see
//   below) -- HTTP_PORT unset
//
// Cert handling for the HTTPS variant: the image ships its OWN built-in self-signed cert
// (confirmed live via docker run + openssl s_client), but its CN/SAN are hardcoded to
// `my.example.com`/`my.example.net`/`192.168.50.108`/`127.0.0.1` -- NONE of which match
// our actual Service DNS name. A strict cert-hostname validator (arguably what
// rancher/rancher#53667 -- dynamic cert handling in ProxyEndpoint -- needs to test
// against) would reject that cert for a HOSTNAME MISMATCH, not the "self-signed but
// otherwise plausible" case we actually want to exercise. Per the image's own README
// ("Use your own certificates"), the default cert lives at /app/fullchain.pem +
// /app/testpk.pem, and can be overridden via the HTTPS_CERT_FILE/HTTPS_KEY_FILE env vars
// pointing at any mounted path -- so, same initContainer + emptyDir pattern used for the
// earlier custom whoami-tls setup: an alpine initContainer runs `openssl req` to
// generate a self-signed cert/key whose CN/SAN correctly cover the Service's own DNS
// name, into a shared emptyDir, and the echo container is pointed at those files via
// HTTPS_CERT_FILE/HTTPS_KEY_FILE. Still genuinely self-signed/untrusted (openssl req
// with no real CA) -- just with a cert that would actually pass a hostname check too.
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

// See comment block above -- alpine generates the cert, echo-https reads it via
// HTTPS_CERT_FILE/HTTPS_KEY_FILE.
const CERT_GEN_IMAGE = 'alpine:latest';
const CERT_VOLUME = 'tls-certs';
const CERT_DIR = '/certs';

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

export function buildEchoHttpDeploymentSpec() {
  return {
    type:     'apps.deployment',
    metadata: {
      name:      ECHO_HTTP_NAME,
      namespace: ECHO_NAMESPACE,
      labels:    { 'proxy-tester': 'true', app: ECHO_HTTP_NAME },
    },
    spec: {
      replicas: 1,
      selector: { matchLabels: { app: ECHO_HTTP_NAME } },
      template: {
        metadata: { labels: { app: ECHO_HTTP_NAME } },
        spec:     {
          containers: [
            {
              name:  ECHO_HTTP_NAME,
              image: ECHO_IMAGE,
              env:   [{ name: 'HTTP_PORT', value: String(ECHO_HTTP_PORT) }],
              ports: [{ containerPort: ECHO_HTTP_PORT, name: 'http' }],
            },
          ],
        },
      },
    },
  };
}

export function buildEchoHttpServiceSpec() {
  return {
    type:     'service',
    metadata: {
      name:      ECHO_HTTP_NAME,
      namespace: ECHO_NAMESPACE,
      labels:    { 'proxy-tester': 'true' },
    },
    spec: {
      selector: { app: ECHO_HTTP_NAME },
      ports:    [{ port: ECHO_HTTP_PORT, targetPort: ECHO_HTTP_PORT, protocol: 'TCP' }],
    },
  };
}

// Self-signed HTTPS variant with a cert whose CN/SAN actually cover the Service's own
// DNS name -- see the module-level comment for why this replaces the image's built-in
// cert instead of just using HTTPS_PORT alone.
export function buildEchoHttpsDeploymentSpec() {
  const fqdn = `${ ECHO_HTTPS_NAME }.${ ECHO_NAMESPACE }.svc`;
  const genCertScript = [
    'apk add --no-cache openssl >/dev/null',
    `openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
      -keyout ${ CERT_DIR }/tls.key -out ${ CERT_DIR }/tls.crt \
      -subj "/CN=${ fqdn }" \
      -addext "subjectAltName=DNS:${ fqdn },DNS:${ ECHO_HTTPS_NAME },DNS:localhost"`,
    // http-https-echo runs as a non-root user (per its README) and can't read the
    // key with openssl's default 0600 perms -- confirmed live: without this, the
    // container crashes on startup with `EACCES: permission denied, open
    // '.../tls.key'`. World-readable is fine here; this is a throwaway dev-only
    // self-signed key with no real-world trust value.
    `chmod 644 ${ CERT_DIR }/tls.key`,
  ].join(' && ');

  return {
    type:     'apps.deployment',
    metadata: {
      name:      ECHO_HTTPS_NAME,
      namespace: ECHO_NAMESPACE,
      labels:    { 'proxy-tester': 'true', app: ECHO_HTTPS_NAME },
    },
    spec: {
      replicas: 1,
      selector: { matchLabels: { app: ECHO_HTTPS_NAME } },
      template: {
        metadata: { labels: { app: ECHO_HTTPS_NAME } },
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
              name:  ECHO_HTTPS_NAME,
              image: ECHO_IMAGE,
              env:   [
                { name: 'HTTPS_PORT', value: String(ECHO_HTTPS_PORT) },
                { name: 'HTTPS_CERT_FILE', value: `${ CERT_DIR }/tls.crt` },
                { name: 'HTTPS_KEY_FILE', value: `${ CERT_DIR }/tls.key` },
              ],
              ports:        [{ containerPort: ECHO_HTTPS_PORT, name: 'https' }],
              volumeMounts: [{ name: CERT_VOLUME, mountPath: CERT_DIR, readOnly: true }],
            },
          ],
        },
      },
    },
  };
}

export function buildEchoHttpsServiceSpec() {
  return {
    type:     'service',
    metadata: {
      name:      ECHO_HTTPS_NAME,
      namespace: ECHO_NAMESPACE,
      labels:    { 'proxy-tester': 'true' },
    },
    spec: {
      selector: { app: ECHO_HTTPS_NAME },
      ports:    [{ port: ECHO_HTTPS_PORT, targetPort: ECHO_HTTPS_PORT, protocol: 'TCP' }],
    },
  };
}
