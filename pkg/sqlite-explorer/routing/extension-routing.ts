import Page1 from '../pages/index.vue';
import { PRODUCT } from '../product';

const routes = [
  {
    name:      `c-cluster-${ PRODUCT }-page1`,
    path:      `/c/:cluster/${ PRODUCT }/page1`,
    component: Page1,
    meta:      {
      product: PRODUCT,
      cluster: true,
      pkg:     PRODUCT,
    },
  },
];

export default routes;
