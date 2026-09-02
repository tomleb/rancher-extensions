import ProxyTesterPage from '../pages/proxyTesterPage.vue';

const BLANK_CLUSTER = '_';
const YOUR_PRODUCT_NAME = 'proxy-tester';
const CUSTOM_PAGE_NAME = 'proxy-tester-page';

const routes = [
  {
    name:      `${ YOUR_PRODUCT_NAME }-c-cluster-${ CUSTOM_PAGE_NAME }`,
    path:      `/${ YOUR_PRODUCT_NAME }/c/:cluster/${ CUSTOM_PAGE_NAME }`,
    component: ProxyTesterPage,
    meta:      {
      product: YOUR_PRODUCT_NAME,
      cluster: BLANK_CLUSTER
    },
  }
];

export default routes;
