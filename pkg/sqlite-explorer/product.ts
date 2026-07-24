import { IPlugin } from '@shell/core/types';

const PRODUCT_NAME = 'sqliteExplorer';

export function init($plugin: IPlugin, store: any) {
  const {
    product, virtualType, basicType, weightGroup
  } = $plugin.DSL(store, PRODUCT_NAME);

  product({
    icon:    'database',
    inStore: 'cluster',
    // Low weight so this sits near the bottom of the Cluster Explorer's top-level
    // slide-in menu, below built-in products (Cluster Management, Continuous
    // Delivery, etc. all use weight 100+) -- this is a troubleshooting tool, not a
    // primary workflow, so it shouldn't compete for top billing.
    weight:  -100,
    to: {
      name:   `c-cluster-${ PRODUCT_NAME }-page1`,
      params: { product: PRODUCT_NAME },
    },
  });

  virtualType({
    labelKey: 'sqliteExplorer.page1.label',
    name:     'page1',
    route:    {
      name:   `c-cluster-${ PRODUCT_NAME }-page1`,
      params: { product: PRODUCT_NAME },
    },
  });

  // Group label ("Troubleshooting") comes from the `product.sqliteExplorer` l10n key
  // (see side-menu.md's "Customizing the Product Side-Menu Entry" doc); the page label
  // ("SQLite Explorer") comes from virtualType's labelKey above -- two distinct names
  // instead of "SqliteExplorer > SqliteExplorer".
  basicType(['page1']);

  // Sink this group itself below the pseudo-group "root" (default weight 1000) in the
  // side-menu, consistent with the product-level weight above.
  weightGroup(PRODUCT_NAME, 1, true);
}

export const PRODUCT = PRODUCT_NAME;

