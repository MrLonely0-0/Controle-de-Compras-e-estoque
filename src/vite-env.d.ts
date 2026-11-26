/// <reference types="vite/client" />
interface Window {
  estoqueDesktop?: { version: () => Promise<string> };
}
