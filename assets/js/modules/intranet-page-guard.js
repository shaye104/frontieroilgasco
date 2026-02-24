import { initIntranetLayout } from './intranet-layout.js?v=20260222b';

export async function initIntranetPageGuard(config) {
  return initIntranetLayout(config);
}
