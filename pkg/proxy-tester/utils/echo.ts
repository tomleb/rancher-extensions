// Orchestrates deploying/checking/removing both http-https-echo variants (plain HTTP and
// self-signed HTTPS) on the local cluster. Idempotent throughout (check-then-create) so
// the page can call ensure*() on every load without erroring on "already exists".
// A single "Deploy"/"Remove" action manages BOTH variants together (per Tom's request --
// one button for all of them).
import {
  ECHO_NAMESPACE, ECHO_HTTP_NAME, ECHO_HTTPS_NAME,
  ECHO_TLS_ISSUER_NAME, ECHO_TLS_SECRET_NAME, ECHO_TLS_CA_KEY,
  echoHttpServiceUrl, echoHttpsServiceUrl,
  buildEchoNamespaceSpec, buildEchoHttpDeploymentSpec, buildEchoHttpServiceSpec,
  buildEchoHttpsDeploymentSpec, buildEchoHttpsServiceSpec,
  buildEchoTlsIssuerSpec, buildEchoTlsCertificateSpec,
} from './echoSpec';
import { localFindOrNull, localCreate, localDelete } from './localCluster';

export interface EchoVariantStatus {
  deploymentExists: boolean;
  serviceExists: boolean;
  readyReplicas: number;
  url: string;
}

export interface EchoStatus {
  namespaceExists: boolean;
  http: EchoVariantStatus;
  https: EchoVariantStatus;
  tlsSecretExists: boolean;
}

async function getVariantStatus(store: any, name: string, url: string): Promise<EchoVariantStatus> {
  const [deployment, service] = await Promise.all([
    localFindOrNull(store, 'apps.deployment', ECHO_NAMESPACE, name),
    localFindOrNull(store, 'service', ECHO_NAMESPACE, name),
  ]);

  return {
    deploymentExists: !!deployment,
    serviceExists:    !!service,
    readyReplicas:    deployment?.status?.readyReplicas ?? 0,
    url,
  };
}

export async function getEchoStatus(store: any): Promise<EchoStatus> {
  const [namespace, http, https, tlsSecret] = await Promise.all([
    localFindOrNull(store, 'namespace', '', ECHO_NAMESPACE),
    getVariantStatus(store, ECHO_HTTP_NAME, echoHttpServiceUrl()),
    getVariantStatus(store, ECHO_HTTPS_NAME, echoHttpsServiceUrl()),
    localFindOrNull(store, 'secret', ECHO_NAMESPACE, ECHO_TLS_SECRET_NAME),
  ]);

  return {
    namespaceExists: !!namespace, http, https, tlsSecretExists: !!tlsSecret,
  };
}

async function ensureResource(store: any, findType: string, name: string, spec: { type: string; metadata: any; spec?: any }): Promise<void> {
  const existing = await localFindOrNull(store, findType, spec.metadata.namespace ?? '', name);

  if (!existing) {
    await localCreate(store, spec.type, { metadata: spec.metadata, spec: spec.spec });
  }
}

// Deploys BOTH variants together, plus the cert-manager Issuer/Certificate the HTTPS
// variant's cert comes from.
export async function ensureEchoDeployed(store: any): Promise<void> {
  const namespace = await localFindOrNull(store, 'namespace', '', ECHO_NAMESPACE);

  if (!namespace) {
    await localCreate(store, 'namespace', buildEchoNamespaceSpec());
  }

  // Issuer + Certificate must exist (and the Certificate must have had a chance to
  // issue, producing ECHO_TLS_SECRET_NAME) before the echo-https Deployment's Secret
  // volume mount will succeed -- create these first.
  await ensureResource(store, 'cert-manager.io.issuer', ECHO_TLS_ISSUER_NAME, buildEchoTlsIssuerSpec());
  await ensureResource(store, 'cert-manager.io.certificate', ECHO_HTTPS_NAME, buildEchoTlsCertificateSpec());

  await ensureResource(store, 'apps.deployment', ECHO_HTTP_NAME, buildEchoHttpDeploymentSpec());
  await ensureResource(store, 'service', ECHO_HTTP_NAME, buildEchoHttpServiceSpec());
  await ensureResource(store, 'apps.deployment', ECHO_HTTPS_NAME, buildEchoHttpsDeploymentSpec());
  await ensureResource(store, 'service', ECHO_HTTPS_NAME, buildEchoHttpsServiceSpec());
}

// Removes BOTH variants' Deployment + Service, plus the cert-manager Issuer/Certificate
// (namespace is left in place -- cheap, and avoids a race against the namespace-delete
// finalizer if the user re-deploys shortly after).
export async function teardownEcho(store: any): Promise<void> {
  await Promise.all([
    localDelete(store, 'apps.deployment', ECHO_NAMESPACE, ECHO_HTTP_NAME).catch(() => {}),
    localDelete(store, 'service', ECHO_NAMESPACE, ECHO_HTTP_NAME).catch(() => {}),
    localDelete(store, 'apps.deployment', ECHO_NAMESPACE, ECHO_HTTPS_NAME).catch(() => {}),
    localDelete(store, 'service', ECHO_NAMESPACE, ECHO_HTTPS_NAME).catch(() => {}),
    localDelete(store, 'cert-manager.io.certificate', ECHO_NAMESPACE, ECHO_HTTPS_NAME).catch(() => {}),
    localDelete(store, 'cert-manager.io.issuer', ECHO_NAMESPACE, ECHO_TLS_ISSUER_NAME).catch(() => {}),
    // cert-manager doesn't auto-delete the Secret when its Certificate is deleted --
    // clean it up explicitly so a redeploy starts from a clean cert, not a stale one.
    localDelete(store, 'secret', ECHO_NAMESPACE, ECHO_TLS_SECRET_NAME).catch(() => {}),
  ]);
}

// Reads the CA certificate out of the cert-manager-issued Secret, base64-encoded, for
// the UI's "Copy CA Certificate" button. ProxyEndpoint's `spec.routes[].caBundle` field
// is a Go `[]byte`, which Kubernetes marshals to/from JSON as a base64 string (same
// convention as Secret .data) -- NOT a raw multi-line PEM block. Steve already returns
// Secret .data values base64-encoded, unwrapped (equivalent to `base64 -w0`), so this is
// the value to paste directly into `caBundle` with no further encoding needed. Returns
// null if the Secret doesn't exist yet (cert still issuing, or HTTPS variant not
// deployed).
export async function getEchoCaCertificateBase64(store: any): Promise<string | null> {
  const secret = await localFindOrNull(store, 'secret', ECHO_NAMESPACE, ECHO_TLS_SECRET_NAME);

  return secret?.data?.[ECHO_TLS_CA_KEY] ?? null;
}
