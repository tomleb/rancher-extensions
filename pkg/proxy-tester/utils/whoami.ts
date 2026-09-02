// Orchestrates deploying/checking/removing the whoami Deployment+Service on the local
// cluster. Idempotent throughout (check-then-create) so the page can call ensure*() on
// every load without erroring on "already exists".
import {
  WHOAMI_NAMESPACE, WHOAMI_NAME, whoamiServiceUrl,
  buildWhoamiNamespaceSpec, buildWhoamiDeploymentSpec, buildWhoamiServiceSpec,
} from './whoamiSpec';
import { localFindOrNull, localCreate, localDelete } from './localCluster';

export interface WhoamiStatus {
  namespaceExists: boolean;
  deploymentExists: boolean;
  serviceExists: boolean;
  readyReplicas: number;
  url: string;
}

export async function getWhoamiStatus(store: any): Promise<WhoamiStatus> {
  const [namespace, deployment, service] = await Promise.all([
    localFindOrNull(store, 'namespace', '', WHOAMI_NAMESPACE),
    localFindOrNull(store, 'apps.deployment', WHOAMI_NAMESPACE, WHOAMI_NAME),
    localFindOrNull(store, 'service', WHOAMI_NAMESPACE, WHOAMI_NAME),
  ]);

  return {
    namespaceExists:  !!namespace,
    deploymentExists: !!deployment,
    serviceExists:    !!service,
    readyReplicas:    deployment?.status?.readyReplicas ?? 0,
    url:              whoamiServiceUrl(),
  };
}

export async function ensureWhoamiDeployed(store: any): Promise<void> {
  const namespace = await localFindOrNull(store, 'namespace', '', WHOAMI_NAMESPACE);

  if (!namespace) {
    await localCreate(store, 'namespace', buildWhoamiNamespaceSpec());
  }

  const deployment = await localFindOrNull(store, 'apps.deployment', WHOAMI_NAMESPACE, WHOAMI_NAME);

  if (!deployment) {
    const spec = buildWhoamiDeploymentSpec();

    await localCreate(store, spec.type, { metadata: spec.metadata, spec: spec.spec });
  }

  const service = await localFindOrNull(store, 'service', WHOAMI_NAMESPACE, WHOAMI_NAME);

  if (!service) {
    const spec = buildWhoamiServiceSpec();

    await localCreate(store, spec.type, { metadata: spec.metadata, spec: spec.spec });
  }
}

// Removes the Deployment + Service (namespace is left in place -- cheap, and avoids a
// race against the namespace-delete finalizer if the user re-deploys shortly after).
export async function teardownWhoami(store: any): Promise<void> {
  await Promise.all([
    localDelete(store, 'apps.deployment', WHOAMI_NAMESPACE, WHOAMI_NAME).catch(() => {}),
    localDelete(store, 'service', WHOAMI_NAMESPACE, WHOAMI_NAME).catch(() => {}),
  ]);
}
