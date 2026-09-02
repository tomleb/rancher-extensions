const BLANK_CLUSTER = '_';

export function init($plugin: any, store: any) {
  const YOUR_PRODUCT_NAME = 'proxy-tester';
  const CUSTOM_PAGE_NAME = 'proxy-tester-page';

  const {
    product,
    virtualType,
    basicType
  } = $plugin.DSL(store, YOUR_PRODUCT_NAME);

  product({
    icon:    'compass',
    inStore: 'management',
    weight:  100,
    to:      {
      name:   `${ YOUR_PRODUCT_NAME }-c-cluster-${ CUSTOM_PAGE_NAME }`,
      params: {
        product: YOUR_PRODUCT_NAME,
        cluster: BLANK_CLUSTER
      }
    }
  });

  virtualType({
    labelKey: 'proxyTester.label',
    name:     CUSTOM_PAGE_NAME,
    route:    {
      name:   `${ YOUR_PRODUCT_NAME }-c-cluster-${ CUSTOM_PAGE_NAME }`,
      params: {
        product: YOUR_PRODUCT_NAME,
        cluster: BLANK_CLUSTER
      }
    }
  });

  basicType([CUSTOM_PAGE_NAME]);
}
