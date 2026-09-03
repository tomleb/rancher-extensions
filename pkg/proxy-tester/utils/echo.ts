// Orchestrates deploying/checking/removing both http-https-echo variants (plain HTTP and
// self-signed HTTPS) on the local cluster. Idempotent throughout (check-then-create) so
// the page can call ensure*() on every load without erroring on "already exists".
// A single "Deploy"/"Remove" action manages BOTH variants together (per Tom's request --
// one button for all of them).
import {
  ECHO_NAMESPACE, ECHO_HTTP_NAME, ECHO_HTTPS_NAME,
  echoHttpServiceUrl, echoHttpsServiceUrl,
  buildEchoNamespaceSpec, buildEchoHttpDeploymentSpec, buildEchoHttpServiceSpec,
  buildEchoHttpsDeploymentSpec, buildEchoHttpsServiceSpec,
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
  const [namespace, http, https] = await Promise.all([
    localFindOrNull(store, 'namespace', '', ECHO_NAMESPACE),
    getVariantStatus(store, ECHO_HTTP_NAME, echoHttpServiceUrl()),
    getVariantStatus(store, ECHO_HTTPS_NAME, echoHttpsServiceUrl()),
  ]);

  return { namespaceExists: !!namespace, http, https };
}

async function ensureResource(store: any, findType: string, name: string, spec: { type: string; metadata: any; spec?: any }): Promise<void> {
  const existing = await localFindOrNull(store, findType, spec.metadata.namespace ?? '', name);

  if (!existing) {
    await localCreate(store, spec.type, { metadata: spec.metadata, spec: spec.spec });
  }
}

// Deploys BOTH variants together.
export async function ensureEchoDeployed(store: any): Promise<void> {
  const namespace = await localFindOrNull(store, 'namespace', '', ECHO_NAMESPACE);

  if (!namespace) {
    await localCreate(store, 'namespace', buildEchoNamespaceSpec());
  }

  await ensureResource(store, 'apps.deployment', ECHO_HTTP_NAME, buildEchoHttpDeploymentSpec());
  await ensureResource(store, 'service', ECHO_HTTP_NAME, buildEchoHttpServiceSpec());
  await ensureResource(store, 'apps.deployment', ECHO_HTTPS_NAME, buildEchoHttpsDeploymentSpec());
  await ensureResource(store, 'service', ECHO_HTTPS_NAME, buildEchoHttpsServiceSpec());
}

// Removes BOTH variants' Deployment + Service (namespace is left in place -- cheap, and
// avoids a race against the namespace-delete finalizer if the user re-deploys shortly
// after).
export async function teardownEcho(store: any): Promise<void> {
  await Promise.all([
    localDelete(store, 'apps.deployment', ECHO_NAMESPACE, ECHO_HTTP_NAME).catch(() => {}),
    localDelete(store, 'service', ECHO_NAMESPACE, ECHO_HTTP_NAME).catch(() => {}),
    localDelete(store, 'apps.deployment', ECHO_NAMESPACE, ECHO_HTTPS_NAME).catch(() => {}),
    localDelete(store, 'service', ECHO_NAMESPACE, ECHO_HTTPS_NAME).catch(() => {}),
  ]);
}
