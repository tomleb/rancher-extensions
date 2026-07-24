// Builds the single Pod manifest that both dumps the target's steve informer cache
// (dumper container) and serves it read-only via Datasette (viewer container).
//
// Design note (see NOTES.md / plan Task 3): the dumper and viewer MUST be containers in
// the SAME pod, because a Kubernetes emptyDir volume is pod-scoped, not shareable across
// separate pods. The dumper does NOT run as an initContainer of the *target*
// rancher/cattle-cluster-agent pod -- it's a regular container in THIS new pod that
// reaches into the target pod over the Kubernetes API (ephemeral containers +
// exec), exactly like `kubectl debug --target=` does, just invoked from in-cluster
// instead of from an operator's laptop.

export type AppType = 'rancher' | 'cattle-cluster-agent';

export interface BuildPodSpecArgs {
  appType: AppType;
  targetPodName: string;
  dumperScriptConfigMapName: string;
  dumpImage?: string;
  datasetteImage?: string;
  namespace?: string;
  serviceAccountName?: string;
}

const DEFAULT_DUMP_IMAGE = 'ghcr.io/rancherlabs/db-cache-dump:latest';
const DEFAULT_DUMPER_ORCHESTRATOR_IMAGE = 'bitnami/kubectl:latest';
const DEFAULT_DATASETTE_IMAGE = 'datasetteproject/datasette:latest';
const DEFAULT_NAMESPACE = 'cattle-system';
const SHARED_DB_PATH = '/shared/vacuumed_informer_object_cache.db';
const VIEWER_PORT = 8001;

// Verified live (2026-07-23) against a real k3d Rancher instance: the namespace default
// ServiceAccount has `automountServiceAccountToken: false` and no RBAC, so the dumper
// container MUST run under a dedicated ServiceAccount -- see assets/dumper-rbac.yaml
// for the exact Role (pods get/list, pods/ephemeralcontainers patch+update+get,
// pods/exec create, pods/log get) confirmed sufficient end-to-end.
export const DEFAULT_DUMPER_SERVICE_ACCOUNT = 'sqlite-explorer-dumper';

export function targetContainerFor(appType: AppType): string {
  return appType === 'rancher' ? 'rancher' : 'cluster-register';
}

export function targetPodLabelFor(appType: AppType): string {
  return appType === 'rancher' ? 'app=rancher' : 'app=cattle-cluster-agent';
}

export function buildPodName(): string {
  return `sqlite-explorer-${ Date.now() }`;
}

export function buildPodSpec({
  appType,
  targetPodName,
  dumperScriptConfigMapName,
  dumpImage = DEFAULT_DUMP_IMAGE,
  datasetteImage = DEFAULT_DATASETTE_IMAGE,
  namespace = DEFAULT_NAMESPACE,
  serviceAccountName = DEFAULT_DUMPER_SERVICE_ACCOUNT,
}: BuildPodSpecArgs) {
  const name = buildPodName();
  const targetContainer = targetContainerFor(appType);

  return {
    type:     'pod',
    metadata: {
      name,
      namespace,
      labels: {
        'sqlite-explorer':      'true',
        'sqlite-explorer/type': appType,
      },
    },
    spec: {
      restartPolicy:      'Never',
      serviceAccountName,
      volumes:        [
        { name: 'shared', emptyDir: {} },
        {
          name:      'dumper-script',
          configMap: {
            name:        dumperScriptConfigMapName,
            defaultMode: 0o755,
          },
        },
      ],
      containers: [
        {
          name:    'dumper',
          image:   DEFAULT_DUMPER_ORCHESTRATOR_IMAGE,
          command: ['/scripts/dumper-entrypoint.sh'],
          env:     [
            { name: 'TARGET_POD', value: targetPodName },
            { name: 'TARGET_NAMESPACE', value: namespace },
            { name: 'TARGET_CONTAINER', value: targetContainer },
            { name: 'DUMP_IMAGE', value: dumpImage },
            { name: 'OUT_PATH', value: SHARED_DB_PATH },
          ],
          volumeMounts: [
            { name: 'shared', mountPath: '/shared' },
            { name: 'dumper-script', mountPath: '/scripts' },
          ],
        },
        {
          name:    'viewer',
          image:   datasetteImage,
          command: [
            'sh',
            '-c',
            `until [ -f ${ SHARED_DB_PATH } ]; do echo "waiting for dumped DB..."; sleep 2; done; exec datasette serve ${ SHARED_DB_PATH } --host 0.0.0.0 --port ${ VIEWER_PORT } --setting sql_time_limit_ms 5000`,
          ],
          ports: [
            { containerPort: VIEWER_PORT, name: 'http' },
          ],
          volumeMounts: [
            { name: 'shared', mountPath: '/shared', readOnly: false },
          ],
        },
      ],
    },
  };
}

export const VIEWER_PORT_NUMBER = VIEWER_PORT;
export const SHARED_DB_PATH_CONST = SHARED_DB_PATH;
