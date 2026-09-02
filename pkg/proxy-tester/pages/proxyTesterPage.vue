<script>
import RcButton from '@components/RcButton/RcButton.vue';

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
        this.error = {
          message: e?.message || String(e),
          status:  e?._status ?? e?.status,
          body:    e?.body ?? e?.data,
        };
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
  },
};
</script>

<template>
  <div>
    <h2>Meta Proxy Tester</h2>
    <p>Manually issue requests through Rancher's <code>/meta/proxy</code> endpoint via <code>this.$shell.proxy</code>, for testing the meta-proxy / ProxyEndpoint feature work.</p>

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
      <pre v-if="error.body">{{ JSON.stringify(error.body, null, 2) }}</pre>
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
