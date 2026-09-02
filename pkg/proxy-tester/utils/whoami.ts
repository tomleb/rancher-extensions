// Orchestrates deploying/checking/removing both whoami variants (plain HTTP and
// self-signed HTTPS) on the local cluster. Idempotent throughout (check-then-create) so
// the page can call ensure*() on every load without erroring on "already exists".
// A single "Deploy"/"Remove" action manages BOTH variants together (per Tom's request --
// one button for all of them), since they're always used as a pair for exercising
// /meta/proxy against both a trusted-scheme and a self-signed target.
import {
  WHOAMI_NAMESPACE, WHOAMI_NAME, WHOAMI_TLS_NAME, whoamiServiceUrl, whoamiTlsServiceUrl,
  buildWhoamiNamespaceSpec, buildWhoamiDeploymentSpec, buildWhoamiServiceSpec,
  buildWhoamiTlsDeploymentSpec, buildWhoamiTlsServiceSpec,
} from './whoamiSpec';
import { localFindOrNull, localCreate, localDelete } from './localCluster';

export interface WhoamiVariantStatus {
  deploymentExists: boolean;
  serviceExists: boolean;
  readyReplicas: number;
  url: string;
}

export interface WhoamiStatus {
  namespaceExists: boolean;
  http: WhoamiVariantStatus;
  tls: WhoamiVariantStatus;
}

async function getVariantStatus(store: any, name: string, url: string): Promise<WhoamiVariantStatus> {
  const [deployment, service] = await Promise.all([
    localFindOrNull(store, 'apps.deployment', WHOAMI_NAMESPACE, name),
    localFindOrNull(store, 'service', WHOAMI_NAMESPACE, name),
  ]);

  return {
    deploymentExists: !!deployment,
    serviceExists:    !!service,
    readyReplicas:    deployment?.status?.readyReplicas ?? 0,
    url,
  };
}

export async function getWhoamiStatus(store: any): Promise<WhoamiStatus> {
  const [namespace, http, tls] = await Promise.all([
    localFindOrNull(store, 'namespace', '', WHOAMI_NAMESPACE),
    getVariantStatus(store, WHOAMI_NAME, whoamiServiceUrl()),
    getVariantStatus(store, WHOAMI_TLS_NAME, whoamiTlsServiceUrl()),
  ]);

  return { namespaceExists: !!namespace, http, tls };
}

async function ensureResource(store: any, findType: string, name: string, spec: { type: string; metadata: any; spec?: any }): Promise<void> {
  const existing = await localFindOrNull(store, findType, spec.metadata.namespace ?? '', name);

  if (!existing) {
    await localCreate(store, spec.type, { metadata: spec.metadata, spec: spec.spec });
  }
}

// Deploys BOTH the plain-HTTP and self-signed-HTTPS whoami variants together.
export async function ensureWhoamiDeployed(store: any): Promise<void> {
  const namespace = await localFindOrNull(store, 'namespace', '', WHOAMI_NAMESPACE);

  if (!namespace) {
    await localCreate(store, 'namespace', buildWhoamiNamespaceSpec());
  }

  await ensureResource(store, 'apps.deployment', WHOAMI_NAME, buildWhoamiDeploymentSpec());
  await ensureResource(store, 'service', WHOAMI_NAME, buildWhoamiServiceSpec());
  await ensureResource(store, 'apps.deployment', WHOAMI_TLS_NAME, buildWhoamiTlsDeploymentSpec());
  await ensureResource(store, 'service', WHOAMI_TLS_NAME, buildWhoamiTlsServiceSpec());
}

// Removes BOTH variants' Deployment + Service (namespace is left in place -- cheap, and
// avoids a race against the namespace-delete finalizer if the user re-deploys shortly
// after).
export async function teardownWhoami(store: any): Promise<void> {
  await Promise.all([
    localDelete(store, 'apps.deployment', WHOAMI_NAMESPACE, WHOAMI_NAME).catch(() => {}),
    localDelete(store, 'service', WHOAMI_NAMESPACE, WHOAMI_NAME).catch(() => {}),
    localDelete(store, 'apps.deployment', WHOAMI_NAMESPACE, WHOAMI_TLS_NAME).catch(() => {}),
    localDelete(store, 'service', WHOAMI_NAMESPACE, WHOAMI_TLS_NAME).catch(() => {}),
  ]);
}
