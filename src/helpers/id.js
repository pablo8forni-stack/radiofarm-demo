let _uidCounter = 0;
export const uid = () =>
  `${Date.now().toString(36)}${(_uidCounter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
