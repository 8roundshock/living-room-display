import type { WidgetModule } from './types.ts';

// Retired (#74): rain timing lives in the adaptive Weather widget. The id stays in the catalog only
// so the previous release can read data (removal: #103); validation merges an enabled Rain into
// Weather, and this module never renders.
export const RainWidget: WidgetModule = { Renderer: () => null, visible: () => false };
