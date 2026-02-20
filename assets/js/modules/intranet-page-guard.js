import { hasPermission } from './nav.js';
import { initIntranetLayout } from './intranet-layout.js';

export async function initIntranetPageGuard(config) {
  return initIntranetLayout(config);
}
