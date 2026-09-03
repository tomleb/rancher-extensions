<script>
import RcButton from '@components/RcButton/RcButton.vue';
import { getEchoStatus, ensureEchoDeployed, teardownEcho } from '../utils/echo';
import { echoHttpServiceUrl, echoHttpsServiceUrl } from '../utils/echoSpec';

const AUTH_MODE = {
  NONE:       'none',
  CREDENTIAL: 'credential',
  TOKEN:      'token',
};

export default {
  name: 'ProxyTesterPage',

  components: { RcButton },

  data() {
    return {
      form: {
        url:            'https://api.digitalocean.com/v2/regions',
        method:         'GET',
        authMode:       AUTH_MODE.CREDENTIAL,
        credentialId:   '',       // e.g. cattle-global-data:cc-abc12
        token:          '',       // plain token, used when authMode === TOKEN
        authSigner:     'bearer', // bearer | basic | digest | awsv4 | arbitrary
        usernameField:  '',       // required for basic/digest
        passwordField:  '',       // required for bearer/basic/digest
        headersJson:    '{}',
        bodyJson:       '',
        allowDomain:    '',
      },
      AUTH_MODE,
      loading:      false,
      allowLoading: false,
      error:        null,
      allowError:   null,
      allowMessage: null,
      response:     null,
      echo: {
        loading:  false,
        deploying: false,
        removing: false,
        error:    null,
        status:   null,
      },
    };
  },

  computed: {
    proxy() {
      return this.$shell.proxy;
    },

    // authSigner is only meaningful for credential auth, or for token auth
    // where it doubles as the Authorization scheme prefix (defaults Bearer).
    needsUsernameField() {
      return this.form.authMode === AUTH_MODE.CREDENTIAL && ['basic', 'digest'].includes(this.form.authSigner);
    },

    needsPasswordField() {
      return this.form.authMode === AUTH_MODE.CREDENTIAL && ['bearer', 'basic', 'digest'].includes(this.form.authSigner);
    },

    echoHttpUrl() {
      return echoHttpServiceUrl();
    },

    echoHttpsUrl() {
      return echoHttpsServiceUrl();
    },
  },

  async created() {
    await this.refreshEchoStatus();
  },

  methods: {
    parseJsonField(raw, fieldLabel) {
      if (!raw || !raw.trim()) {
        return undefined;
      }
      try {
        return JSON.parse(raw);
      } catch (e) {
        throw new Error(`${ fieldLabel } is not valid JSON: ${ e.message }`);
      }
    },

    buildAuthentication() {
      const { authMode, credentialId, token, authSigner, usernameField, passwordField } = this.form;

      if (authMode === AUTH_MODE.NONE) {
        return undefined;
      }

      if (authMode === AUTH_MODE.CREDENTIAL) {
        if (!credentialId) {
          throw new Error('Credential ID is required for Cloud Credential auth');
        }
        const auth = { id: credentialId, authSigner: authSigner || undefined };

        if (usernameField) {
          auth.usernameField = usernameField;
        }
        if (passwordField) {
          auth.passwordField = passwordField;
        }

        return auth;
      }

      // AUTH_MODE.TOKEN
      if (!token) {
        throw new Error('Token is required for plain-token auth');
      }

      return { token, authSigner: authSigner || undefined };
    },

    // Rancher's shell request action rejects with the raw (unwrapped) response body,
    // decorated with non-enumerable _status/_statusText/_headers/_url properties (see
    // @rancher/shell/plugins/steve/actions.js's responseObject/onError) -- it does NOT
    // have a `.message` property, so `String(e)` on it prints the useless literal
    // "[object Object]". Build a real, readable dump instead.
    describeError(e) {
      const status = e?._status ?? e?.status;
      const statusText = e?._statusText ?? e?.statusText;
      const body = e?.body ?? e?.data ?? e;

      let summary = e?.message;

      if (!summary) {
        summary = [status, statusText].filter(Boolean).join(' ') || 'Request failed';
      }

      // 502/503 from /meta/proxy almost always means the target host isn't on
      // Rancher's proxy allow-list yet -- call it out explicitly since it's the
      // single most common thing to hit while testing arbitrary URLs here.
      if (status === 502 || status === 503) {
        summary += ' -- likely means the target host is not on Rancher\'s proxy allow-list. Use "Allow Domain" below to add it, then retry.';
      }

      let dump;

      try {
        // Include non-enumerable props (_status etc aren't enumerable via defineProperties)
        // by explicitly listing them alongside a JSON.stringify of the rest.
        dump = JSON.stringify({
          status, statusText, body, headers: e?._headers ?? e?.headers,
        }, null, 2);
      } catch (jsonErr) {
        dump = `<unserializable error object: ${ jsonErr.message }>`;
      }

      return {
        message: summary, status, body: dump,
      };
    },

    async submit() {
      this.error = null;
      this.response = null;
      this.loading = true;

      try {
        const headers = this.parseJsonField(this.form.headersJson, 'Headers');
        const data = this.parseJsonField(this.form.bodyJson, 'Body');
        const authentication = this.buildAuthentication();

        const options = {
          url:    new URL(this.form.url),
          method: this.form.method,
          headers,
          data,
          authentication,
        };

        const res = await this.proxy.request(options);

        this.response = {
          status: res?._status ?? res?.status ?? 'n/a',
          body:   res,
        };
      } catch (e) {
        this.error = this.describeError(e);
      } finally {
        this.loading = false;
      }
    },

    async allowDomain() {
      this.allowError = null;
      this.allowMessage = null;

      if (!this.form.allowDomain) {
        this.allowError = 'Enter a domain/hostname pattern first (e.g. api.example.com or %.amazonaws.com)';

        return;
      }

      this.allowLoading = true;
      try {
        await this.proxy.allowDomains([this.form.allowDomain]);
        this.allowMessage = `Created ProxyEndpoint allowing "${ this.form.allowDomain }"`;
      } catch (e) {
        this.allowError = e?.message || String(e);
      } finally {
        this.allowLoading = false;
      }
    },

    async refreshEchoStatus() {
      this.echo.loading = true;
      this.echo.error = null;
      try {
        this.echo.status = await getEchoStatus(this.$store);
      } catch (e) {
        this.echo.error = this.describeError(e).message;
      } finally {
        this.echo.loading = false;
      }
    },

    async deployEcho() {
      this.echo.deploying = true;
      this.echo.error = null;
      try {
        await ensureEchoDeployed(this.$store);
        await this.refreshEchoStatus();
      } catch (e) {
        this.echo.error = this.describeError(e).message;
      } finally {
        this.echo.deploying = false;
      }
    },

    async removeEcho() {
      this.echo.removing = true;
      this.echo.error = null;
      try {
        await teardownEcho(this.$store);
        await this.refreshEchoStatus();
      } catch (e) {
        this.echo.error = this.describeError(e).message;
      } finally {
        this.echo.removing = false;
      }
    },

    useEchoUrl(url) {
      this.form.url = url;
      this.form.authMode = AUTH_MODE.NONE;
    },
  },
};
</script>

<template>
  <div>
    <h2>Meta Proxy Tester</h2>
    <p>Manually issue requests through Rancher's <code>/meta/proxy</code> endpoint via <code>this.$shell.proxy</code>, for testing the meta-proxy / ProxyEndpoint feature work.</p>

    <h3>Test target: http-https-echo</h3>
    <p>
      Deploys <a href="https://github.com/mendhak/docker-http-https-echo" target="_blank" rel="noopener">mendhak/http-https-echo</a>
      to the <code>local</code> cluster as two variants, reachable at stable Service DNS
      names -- known-good targets for exercising <code>/meta/proxy</code> without relying
      on a real external API. Unlike whoami, this image echoes back the FULL incoming
      request (method, path, ALL headers, body, cookies) verbatim as JSON -- needed to
      confirm exactly what <code>/meta/proxy</code> forwards/strips/rewrites.
    </p>
    <ul>
      <li>plain HTTP</li>
      <li>self-signed HTTPS (built-in cert, untrusted) — for testing how the proxy handles a target it can't verify (see rancher/rancher#53667)</li>
    </ul>
    <table v-if="echo.status" class="mb-10">
      <tbody>
        <tr>
          <td class="pr-10"><strong>HTTP</strong></td>
          <td class="pr-10">
            <span v-if="echo.status.http.readyReplicas > 0" class="text-success">ready</span>
            <span v-else-if="echo.status.http.deploymentExists" class="text-muted">deployed, not ready yet</span>
            <span v-else class="text-muted">not deployed</span>
          </td>
          <td class="pr-10"><code v-if="echo.status.http.deploymentExists">{{ echo.status.http.url }}</code></td>
          <td>
            <RcButton
              v-if="echo.status.http.deploymentExists"
              small
              @click="useEchoUrl(echoHttpUrl)"
            >
              Use this URL
            </RcButton>
          </td>
        </tr>
        <tr>
          <td class="pr-10"><strong>HTTPS (self-signed)</strong></td>
          <td class="pr-10">
            <span v-if="echo.status.https.readyReplicas > 0" class="text-success">ready</span>
            <span v-else-if="echo.status.https.deploymentExists" class="text-muted">deployed, not ready yet</span>
            <span v-else class="text-muted">not deployed</span>
          </td>
          <td class="pr-10"><code v-if="echo.status.https.deploymentExists">{{ echo.status.https.url }}</code></td>
          <td>
            <RcButton
              v-if="echo.status.https.deploymentExists"
              small
              @click="useEchoUrl(echoHttpsUrl)"
            >
              Use this URL
            </RcButton>
          </td>
        </tr>
      </tbody>
    </table>
    <RcButton
      primary
      class="mr-10"
      :disabled="echo.deploying || echo.loading"
      @click="deployEcho"
    >
      {{ echo.deploying ? 'Deploying...' : 'Deploy echo (both)' }}
    </RcButton>
    <RcButton
      :disabled="!echo.status || (!echo.status.http.deploymentExists && !echo.status.https.deploymentExists) || echo.removing"
      @click="removeEcho"
    >
      {{ echo.removing ? 'Removing...' : 'Remove echo (both)' }}
    </RcButton>
    <p v-if="echo.error" class="text-error mt-10">
      {{ echo.error }}
    </p>

    <hr class="mt-20 mb-20">

    <form @submit.prevent="submit">
      <div class="row mb-10">
        <label>Target URL</label>
        <input v-model="form.url" type="text" placeholder="https://api.example.com/v1/foo" style="width: 100%;">
      </div>

      <div class="row mb-10">
        <label>Method</label>
        <select v-model="form.method">
          <option>GET</option>
          <option>POST</option>
          <option>PUT</option>
          <option>PATCH</option>
          <option>DELETE</option>
        </select>
      </div>

      <div class="row mb-10">
        <label>Auth Mode</label>
        <select v-model="form.authMode">
          <option :value="AUTH_MODE.NONE">None</option>
          <option :value="AUTH_MODE.CREDENTIAL">Cloud Credential (X-Api-CattleAuth-Header)</option>
          <option :value="AUTH_MODE.TOKEN">Plain Token (X-API-Auth-Header)</option>
        </select>
      </div>

      <div v-if="form.authMode === AUTH_MODE.CREDENTIAL" class="row mb-10">
        <label>Credential ID</label>
        <input v-model="form.credentialId" type="text" placeholder="cattle-global-data:cc-abc12" style="width: 100%;">
      </div>

      <div v-if="form.authMode === AUTH_MODE.TOKEN" class="row mb-10">
        <label>Token</label>
        <input v-model="form.token" type="text" placeholder="raw token value" style="width: 100%;">
      </div>

      <div v-if="form.authMode !== AUTH_MODE.NONE" class="row mb-10">
        <label>Auth Signer</label>
        <select v-model="form.authSigner">
          <option value="bearer">bearer</option>
          <option value="basic">basic</option>
          <option value="digest">digest</option>
          <option value="awsv4">awsv4</option>
          <option value="arbitrary">arbitrary</option>
        </select>
      </div>

      <div v-if="needsUsernameField" class="row mb-10">
        <label>Username Field (unprefixed secret key)</label>
        <input v-model="form.usernameField" type="text" placeholder="e.g. accessKey">
      </div>

      <div v-if="needsPasswordField" class="row mb-10">
        <label>Password Field (unprefixed secret key)</label>
        <input v-model="form.passwordField" type="text" placeholder="e.g. secretKey">
      </div>

      <div class="row mb-10">
        <label>Extra Headers (JSON object)</label>
        <textarea v-model="form.headersJson" rows="3" style="width: 100%;" placeholder='{"Accept": "application/json"}' />
      </div>

      <div class="row mb-10">
        <label>Body (JSON, for POST/PUT/PATCH)</label>
        <textarea v-model="form.bodyJson" rows="4" style="width: 100%;" placeholder='{"key": "value"}' />
      </div>

      <RcButton primary type="submit" :disabled="loading">
        {{ loading ? 'Sending...' : 'Send Request' }}
      </RcButton>
    </form>

    <hr class="mt-20 mb-20">

    <div v-if="error" class="mt-20">
      <h4>Error</h4>
      <p v-if="error.status">Status: {{ error.status }}</p>
      <p>{{ error.message }}</p>
      <pre v-if="error.body">{{ error.body }}</pre>
    </div>

    <div v-if="response" class="mt-20">
      <h4>Response</h4>
      <p>Status: {{ response.status }}</p>
      <pre>{{ JSON.stringify(response.body, null, 2) }}</pre>
    </div>

    <hr class="mt-20 mb-20">

    <h3>Allow-list a domain</h3>
    <p>Creates a <code>ProxyEndpoint</code> CR so the target host passes Rancher's proxy allow-list check.</p>
    <div class="row mb-10">
      <input v-model="form.allowDomain" type="text" placeholder="api.example.com or %.example.com" style="width: 100%;">
    </div>
    <RcButton primary :disabled="allowLoading" @click="allowDomain">
      {{ allowLoading ? 'Creating...' : 'Allow Domain' }}
    </RcButton>
    <p v-if="allowMessage" class="text-success mt-10">
      {{ allowMessage }}
    </p>
    <p v-if="allowError" class="text-error mt-10">
      {{ allowError }}
    </p>
  </div>
</template>

<style lang="scss" scoped>
.row {
  display: flex;
  flex-direction: column;
  max-width: 600px;

  label {
    font-weight: bold;
    margin-bottom: 4px;
  }
}

pre {
  background: var(--body-bg, #1c1c21);
  padding: 10px;
  overflow: auto;
  max-height: 400px;
}

.text-success {
  color: var(--success, green);
}

.text-error {
  color: var(--error, red);
}
</style>
