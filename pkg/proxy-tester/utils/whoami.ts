// Orchestrates deploying/checking/removing all three test-target variants (plain HTTP
// whoami, self-signed HTTPS whoami, and the HTTP-only http-https-echo request-dumper) on
// the local cluster. Idempotent throughout (check-then-create) so the page can call
// ensure*() on every load without erroring on "already exists".
// A single "Deploy"/"Remove" action manages ALL THREE variants together (per Tom's
// request -- one button for all of them), since they're always used as a set for
// exercising /meta/proxy against different target shapes.
import {
  WHOAMI_NAMESPACE, WHOAMI_NAME, WHOAMI_TLS_NAME, ECHO_NAME,
  whoamiServiceUrl, whoamiTlsServiceUrl, echoServiceUrl,
  buildWhoamiNamespaceSpec, buildWhoamiDeploymentSpec, buildWhoamiServiceSpec,
  buildWhoamiTlsDeploymentSpec, buildWhoamiTlsServiceSpec,
  buildEchoDeploymentSpec, buildEchoServiceSpec,
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
  echo: WhoamiVariantStatus;
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
  const [namespace, http, tls, echo] = await Promise.all([
    localFindOrNull(store, 'namespace', '', WHOAMI_NAMESPACE),
    getVariantStatus(store, WHOAMI_NAME, whoamiServiceUrl()),
    getVariantStatus(store, WHOAMI_TLS_NAME, whoamiTlsServiceUrl()),
    getVariantStatus(store, ECHO_NAME, echoServiceUrl()),
  ]);

  return {
    namespaceExists: !!namespace, http, tls, echo,
  };
}

async function ensureResource(store: any, findType: string, name: string, spec: { type: string; metadata: any; spec?: any }): Promise<void> {
  const existing = await localFindOrNull(store, findType, spec.metadata.namespace ?? '', name);

  if (!existing) {
    await localCreate(store, spec.type, { metadata: spec.metadata, spec: spec.spec });
  }
}

// Deploys ALL THREE variants together.
export async function ensureWhoamiDeployed(store: any): Promise<void> {
  const namespace = await localFindOrNull(store, 'namespace', '', WHOAMI_NAMESPACE);

  if (!namespace) {
    await localCreate(store, 'namespace', buildWhoamiNamespaceSpec());
  }

  await ensureResource(store, 'apps.deployment', WHOAMI_NAME, buildWhoamiDeploymentSpec());
  await ensureResource(store, 'service', WHOAMI_NAME, buildWhoamiServiceSpec());
  await ensureResource(store, 'apps.deployment', WHOAMI_TLS_NAME, buildWhoamiTlsDeploymentSpec());
  await ensureResource(store, 'service', WHOAMI_TLS_NAME, buildWhoamiTlsServiceSpec());
  await ensureResource(store, 'apps.deployment', ECHO_NAME, buildEchoDeploymentSpec());
  await ensureResource(store, 'service', ECHO_NAME, buildEchoServiceSpec());
}

// Removes ALL THREE variants' Deployment + Service (namespace is left in place -- cheap,
// and avoids a race against the namespace-delete finalizer if the user re-deploys
// shortly after).
export async function teardownWhoami(store: any): Promise<void> {
  await Promise.all([
    localDelete(store, 'apps.deployment', WHOAMI_NAMESPACE, WHOAMI_NAME).catch(() => {}),
    localDelete(store, 'service', WHOAMI_NAMESPACE, WHOAMI_NAME).catch(() => {}),
    localDelete(store, 'apps.deployment', WHOAMI_NAMESPACE, WHOAMI_TLS_NAME).catch(() => {}),
    localDelete(store, 'service', WHOAMI_NAMESPACE, WHOAMI_TLS_NAME).catch(() => {}),
    localDelete(store, 'apps.deployment', WHOAMI_NAMESPACE, ECHO_NAME).catch(() => {}),
    localDelete(store, 'service', WHOAMI_NAMESPACE, ECHO_NAME).catch(() => {}),
  ]);
}
