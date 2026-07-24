import { importTypes } from '@rancher/auto-import';
import { IPlugin } from '@shell/core/types';
import { init as initProduct } from './product';
import extensionRouting from './routing/extension-routing';

// Init the package
export default function(plugin: IPlugin, internal: any): void {
  // Auto-import model, detail, edit from the folders
  importTypes(plugin);

  // Provide plugin metadata from package.json
  plugin.metadata = require('./package.json');

  // Load the SQLite Explorer cluster-level product (sidebar entry).
  // `internal` here is the second arg the extension manager passes directly to this
  // init function -- an object shaped `{ app, store, $axios, redirect, plugins }`, NOT
  // the Vuex store itself and NOT a `plugin.store` property (which doesn't exist on the
  // Plugin class at all). See @rancher/shell/core/extension-manager-impl.js's
  // `internal()` method and `p.default(plugin, this.internal())` call site. Passing the
  // wrong thing here silently broke DSL()/product registration with no visible error
  // beyond a swallowed console.error, which is why the sidebar entry never appeared.
  initProduct(plugin, internal.store);

  // Register the extension's Vue routes
  plugin.addRoutes(extensionRouting);
}
