<template>
  <div>
    <h1>SQLite Explorer</h1>
    <p>
      Inspect the steve informer object cache for this cluster's Rancher/agent pods
      (read-only, ad-hoc SQL queries via Datasette). This is an MVP tool — sessions are
      not automatically cleaned up; delete the pod manually in <code>cattle-system</code>
      when done.
    </p>

    <div
      v-if="loadingPods"
      class="mt-20"
    >
      Loading pods...
    </div>

    <p
      v-else-if="!candidatePods.length"
      class="text-muted mt-20"
    >
      No rancher/cattle-cluster-agent pods found in cattle-system for this cluster.
    </p>

    <table
      v-else
      class="sortable-table mt-20"
    >
      <thead>
        <tr>
          <th>Pod</th>
          <th>Container</th>
          <th>DB size / WAL / SHM</th>
          <th></th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="entry in candidatePods"
          :key="entry.pod.metadata.name"
        >
          <td>{{ entry.pod.metadata.name }}</td>
          <td>{{ entry.container }}</td>
          <td>
            <span v-if="metricsError[entry.pod.metadata.name]" class="text-error">
              {{ metricsError[entry.pod.metadata.name] }}
            </span>
            <span v-else-if="metrics[entry.pod.metadata.name]">
              {{ formatBytes(metrics[entry.pod.metadata.name].dbBytes) }}
              / {{ formatBytes(metrics[entry.pod.metadata.name].walBytes) }}
              / {{ formatBytes(metrics[entry.pod.metadata.name].shmBytes) }}
            </span>
            <span v-else class="text-muted">—</span>
          </td>
          <td>
            <button
              class="btn btn-sm role-secondary"
              :disabled="!!metricsLoadingFor"
              @click="refreshMetrics(entry)"
            >
              {{ metricsLoadingFor === entry.pod.metadata.name ? 'Fetching...' : 'Refresh metrics' }}
            </button>
          </td>
          <td>
            <button
              v-if="!sessions[entry.pod.metadata.name]"
              class="btn role-primary"
              :disabled="!!launchingFor"
              @click="launch(entry)"
            >
              {{ launchingFor === entry.pod.metadata.name ? (statusMessage || 'Launching...') : 'Open SQLite Explorer' }}
            </button>
            <template v-else>
              <a
                :href="sessions[entry.pod.metadata.name].viewerUrl"
                target="_blank"
                rel="noopener"
              >Open viewer in new tab</a>
              <div class="text-muted">
                Pod: {{ sessions[entry.pod.metadata.name].podNamespace }}/{{ sessions[entry.pod.metadata.name].podName }}
                — remember to delete it manually when done.
              </div>
            </template>
          </td>
        </tr>
      </tbody>
    </table>

    <p
      v-if="error"
      class="text-error mt-20"
    >
      {{ error }}
    </p>
  </div>
</template>

<script>
import { buildPodSpec, targetContainerFor } from '../utils/podSpec';
import { podProxyUrlFromParts } from '../utils/proxyUrl';
import { DUMPER_ENTRYPOINT_SCRIPT } from '../utils/dumperScript';
import { ensureDumperRbac } from '../utils/rbac';
import { ensureMetricsRbac } from '../utils/metricsRbac';
import { fetchPodMetrics, formatBytes } from '../utils/metricsFetch';
import { createResourceRaw } from '../utils/steveRaw';

const VIEWER_PORT = 8001;
const NAMESPACE = 'cattle-system';
const POLL_INTERVAL_MS = 2000;
const POLL_MAX_ATTEMPTS = 60;

export default {
  data() {
    return {
      loadingPods:      true,
      candidatePods:    [],
      launchingFor:     null,
      statusMessage:    '',
      sessions:         {},
      error:            null,
      metrics:          {},
      metricsError:     {},
      metricsLoadingFor: null,
    };
  },
  async created() {
    try {
      // The page is already cluster-scoped (route param `cluster`), so it doesn't need
      // to ask the user which app/source -- list every rancher/cattle-cluster-agent pod
      // found in this cluster's cattle-system namespace instead. On a downstream
      // cluster this is normally exactly one cattle-cluster-agent pod; on the local
      // cluster running Rancher in HA this can be multiple rancher pods, one row each.
      const pods = await this.$store.dispatch('cluster/findAll', { type: 'pod' });

      this.candidatePods = pods
        .filter((p) => {
          const ns = p.metadata?.namespace;
          const app = p.metadata?.labels?.app;

          return ns === NAMESPACE && (app === 'rancher' || app === 'cattle-cluster-agent');
        })
        .map((pod) => ({
          pod,
          appType:   pod.metadata.labels.app,
          container: targetContainerFor(pod.metadata.labels.app),
        }));
    } catch (e) {
      this.error = e.message;
    } finally {
      this.loadingPods = false;
    }
  },
  methods: {
    formatBytes,
    async refreshMetrics(entry) {
      const podKey = entry.pod.metadata.name;

      this.metricsLoadingFor = podKey;
      this.metricsError = { ...this.metricsError, [podKey]: null };

      try {
        // The metrics-fetcher pod reuses the dumper flow's ServiceAccount (see
        // metricsRbac.ts) but ensureMetricsRbac() only creates the ClusterRoleBinding --
        // it doesn't create the ServiceAccount itself. On a fresh cluster where "Refresh
        // metrics" is clicked before "Open SQLite Explorer" has ever run, the SA doesn't
        // exist yet and pod creation fails with "serviceaccount ... not found" (found via
        // real browser click-through, 2026-07-24). Ensure both, in order, every time.
        await ensureDumperRbac(this.$store, NAMESPACE);
        await ensureMetricsRbac(this.$store, NAMESPACE);

        const targetPodIp = entry.pod.status?.podIP;

        if (!targetPodIp) {
          throw new Error('Target pod has no podIP yet (not Running?) -- cannot reach its /metrics.');
        }

        const result = await fetchPodMetrics(this.$store, {
          appType:       entry.appType,
          targetPodName: entry.pod.metadata.name,
          targetPodIp,
          namespace:     NAMESPACE,
        });

        this.metrics = { ...this.metrics, [podKey]: result };
      } catch (e) {
        this.metricsError = { ...this.metricsError, [podKey]: e.message };
      } finally {
        this.metricsLoadingFor = null;
      }
    },
    async launch(entry) {
      const podKey = entry.pod.metadata.name;

      this.launchingFor = podKey;
      this.error = null;
      this.statusMessage = 'Ensuring dumper RBAC exists...';

      try {
        const clusterId = this.$route.params.cluster;

        await ensureDumperRbac(this.$store, NAMESPACE);

        this.statusMessage = 'Creating dumper script ConfigMap...';

        const cm = await createResourceRaw(this.$store, 'configmap', {
          metadata: {
            generateName: 'sqlite-explorer-dumper-script-',
            namespace:    NAMESPACE,
          },
          data: { 'dumper-entrypoint.sh': DUMPER_ENTRYPOINT_SCRIPT },
        });

        this.statusMessage = 'Creating pod...';

        const spec = buildPodSpec({
          appType:                   entry.appType,
          targetPodName:             entry.pod.metadata.name,
          dumperScriptConfigMapName: cm.metadata.name,
        });

        const newPod = await createResourceRaw(this.$store, 'pod', {
          metadata: spec.metadata,
          spec:     spec.spec,
        });

        this.statusMessage = 'Waiting for viewer to become ready (this can take a minute)...';

        for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
          await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

          // eslint-disable-next-line no-await-in-loop
          const fresh = await this.$store.dispatch('cluster/find', {
            type: 'pod',
            id:   `${ newPod.metadata.namespace }/${ newPod.metadata.name }`,
          });

          const viewerStatus = fresh.status?.containerStatuses?.find((c) => c.name === 'viewer');

          if (viewerStatus?.ready) {
            this.sessions = {
              ...this.sessions,
              [podKey]: {
                viewerUrl:    podProxyUrlFromParts(clusterId, newPod.metadata.namespace, newPod.metadata.name, VIEWER_PORT),
                podName:      newPod.metadata.name,
                podNamespace: newPod.metadata.namespace,
              },
            };
            this.launchingFor = null;
            this.statusMessage = '';

            return;
          }
        }

        throw new Error('Timed out waiting for the viewer container to become ready.');
      } catch (e) {
        this.error = e.message;
        this.launchingFor = null;
        this.statusMessage = '';
      }
    },
  },
};
</script>
