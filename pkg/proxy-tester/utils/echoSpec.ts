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
// - self-signed HTTPS (echoHttpsServiceUrl()) -- HTTPS_PORT set, plus a cert-manager-
//   issued cert (see below) -- HTTP_PORT unset
//
// Cert handling for the HTTPS variant: the image ships its OWN built-in self-signed cert
// (confirmed live via docker run + openssl s_client), but its CN/SAN are hardcoded to
// `my.example.com`/`my.example.net`/`192.168.50.108`/`127.0.0.1` -- NONE of which match
// our actual Service DNS name. A strict cert-hostname validator (arguably what
// rancher/rancher#53667 -- dynamic cert handling in ProxyEndpoint -- needs to test
// against) would reject that cert for a HOSTNAME MISMATCH, not the "self-signed but
// otherwise plausible" case we actually want to exercise.
//
// Rancher itself requires cert-manager as a prerequisite in essentially every real
// deployment (it's how Rancher's own webhook/TLS certs get issued), and this extension
// is local-cluster-only by design (see localCluster.ts) -- so rather than hand-rolling
// cert generation with an alpine+openssl initContainer, we use cert-manager's own
// `Issuer`/`Certificate` CRs: a namespace-scoped self-signed Issuer, and a Certificate
// resource requesting a cert whose dnsNames cover the Service's own DNS name. This is
// simpler AND solves the "copy the CA cert" requirement for free -- cert-manager
// automatically writes `ca.crt` (alongside `tls.crt`/`tls.key`) into the resulting
// Secret, no custom RBAC/ConfigMap-publishing plumbing needed (verified live: for a
// selfSigned Issuer, `ca.crt` == `tls.crt`, both readable directly off the Secret via
// the Steve API).
//
// Per the image's own README ("Use your own certificates"), the cert is overridable via
// the HTTPS_CERT_FILE/HTTPS_KEY_FILE env vars pointing at any mounted path -- so the
// echo-https container mounts the cert-manager Secret directly and points at
// tls.crt/tls.key inside it. Verified live end-to-end: created a selfSigned Issuer +
// Certificate, mounted the resulting Secret into a real http-https-echo pod via
// HTTPS_CERT_FILE/HTTPS_KEY_FILE, confirmed `curl -k` -> 200 and a normal `curl` with
// the correct hostname (but real cert validation) -> SSL error (exit 60, untrusted as
// intended, NOT a hostname mismatch).
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

// cert-manager resource names. The Certificate's secretName is what the UI's "Copy CA
// Certificate" reads `ca.crt` from directly (Steve `secret` type, same mechanism the
// rest of this extension already uses for reading resources on the local cluster).
export const ECHO_TLS_ISSUER_NAME = 'echo-https-selfsigned-issuer';
export const ECHO_TLS_SECRET_NAME = 'echo-https-tls';
export const ECHO_TLS_CA_KEY = 'ca.crt';

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

// Namespace-scoped self-signed Issuer -- no external ACME/CA dependency, matches what
// we verified live against this cluster's existing cert-manager v1.19.1 install.
export function buildEchoTlsIssuerSpec() {
  return {
    type:     'cert-manager.io.issuer',
    metadata: {
      name:      ECHO_TLS_ISSUER_NAME,
      namespace: ECHO_NAMESPACE,
      labels:    { 'proxy-tester': 'true' },
    },
    spec: { selfSigned: {} },
  };
}

// Requests a cert whose dnsNames cover the Service's own DNS name -- see module-level
// comment for why this replaces the image's built-in cert. cert-manager writes
// tls.crt/tls.key/ca.crt into ECHO_TLS_SECRET_NAME once issued (self-signed -> ca.crt
// and tls.crt are identical, confirmed live).
export function buildEchoTlsCertificateSpec() {
  const fqdn = `${ ECHO_HTTPS_NAME }.${ ECHO_NAMESPACE }.svc`;

  return {
    type:     'cert-manager.io.certificate',
    metadata: {
      name:      ECHO_HTTPS_NAME,
      namespace: ECHO_NAMESPACE,
      labels:    { 'proxy-tester': 'true' },
    },
    spec: {
      secretName: ECHO_TLS_SECRET_NAME,
      dnsNames:   [fqdn, ECHO_HTTPS_NAME, 'localhost'],
      issuerRef:  { name: ECHO_TLS_ISSUER_NAME, kind: 'Issuer' },
      isCA:       false,
    },
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

// Self-signed HTTPS variant, cert mounted straight from the cert-manager-issued Secret --
// see module-level comment. No initContainer, no manual cert generation, no key
// permission workaround needed (Kubernetes Secret volume mounts are world-readable by
// default -- confirmed live, unlike the earlier openssl-in-emptyDir approach which
// needed an explicit chmod because openssl writes keys 0600).
export function buildEchoHttpsDeploymentSpec() {
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
          volumes: [{ name: 'tls-certs', secret: { secretName: ECHO_TLS_SECRET_NAME } }],
          containers: [
            {
              name:  ECHO_HTTPS_NAME,
              image: ECHO_IMAGE,
              env:   [
                { name: 'HTTPS_PORT', value: String(ECHO_HTTPS_PORT) },
                { name: 'HTTPS_CERT_FILE', value: '/certs/tls.crt' },
                { name: 'HTTPS_KEY_FILE', value: '/certs/tls.key' },
              ],
              ports:        [{ containerPort: ECHO_HTTPS_PORT, name: 'https' }],
              volumeMounts: [{ name: 'tls-certs', mountPath: '/certs', readOnly: true }],
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
