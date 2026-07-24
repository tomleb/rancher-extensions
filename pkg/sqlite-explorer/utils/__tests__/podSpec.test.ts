import { buildPodSpec, targetContainerFor, targetPodLabelFor } from '../podSpec';

describe('podSpec', () => {
  describe('targetContainerFor', () => {
    it('maps rancher appType to the rancher container', () => {
      expect(targetContainerFor('rancher')).toBe('rancher');
    });

    it('maps cattle-cluster-agent appType to the cluster-register container', () => {
      expect(targetContainerFor('cattle-cluster-agent')).toBe('cluster-register');
    });
  });

  describe('targetPodLabelFor', () => {
    it('maps rancher appType to app=rancher', () => {
      expect(targetPodLabelFor('rancher')).toBe('app=rancher');
    });

    it('maps cattle-cluster-agent appType to app=cattle-cluster-agent', () => {
      expect(targetPodLabelFor('cattle-cluster-agent')).toBe('app=cattle-cluster-agent');
    });
  });

  describe('buildPodSpec', () => {
    it('builds a pod spec with two containers sharing the same emptyDir volume', () => {
      const spec = buildPodSpec({
        appType:                   'cattle-cluster-agent',
        targetPodName:             'cattle-cluster-agent-abc123',
        dumperScriptConfigMapName: 'sqlite-explorer-dumper-script-xyz',
      });

      expect(spec.type).toBe('pod');
      expect(spec.metadata.namespace).toBe('cattle-system');
      expect(spec.spec.containers).toHaveLength(2);

      const dumper = spec.spec.containers.find((c: any) => c.name === 'dumper');
      const viewer = spec.spec.containers.find((c: any) => c.name === 'viewer');

      expect(dumper).toBeDefined();
      expect(viewer).toBeDefined();

      const dumperEnv = Object.fromEntries(dumper.env.map((e: any) => [e.name, e.value]));

      expect(dumperEnv.TARGET_POD).toBe('cattle-cluster-agent-abc123');
      expect(dumperEnv.TARGET_CONTAINER).toBe('cluster-register');
      expect(dumperEnv.TARGET_NAMESPACE).toBe('cattle-system');

      const sharedVolumeNames = spec.spec.volumes.map((v: any) => v.name);

      expect(sharedVolumeNames).toContain('shared');

      const dumperMountsShared = dumper.volumeMounts.some((m: any) => m.name === 'shared');
      const viewerMountsShared = viewer.volumeMounts.some((m: any) => m.name === 'shared');

      expect(dumperMountsShared).toBe(true);
      expect(viewerMountsShared).toBe(true);
    });

    it('targets the rancher container/namespace when appType is rancher', () => {
      const spec = buildPodSpec({
        appType:                   'rancher',
        targetPodName:             'rancher-abc123',
        dumperScriptConfigMapName: 'sqlite-explorer-dumper-script-xyz',
      });

      const dumper = spec.spec.containers.find((c: any) => c.name === 'dumper');
      const dumperEnv = Object.fromEntries(dumper.env.map((e: any) => [e.name, e.value]));

      expect(dumperEnv.TARGET_CONTAINER).toBe('rancher');
    });
  });
});
