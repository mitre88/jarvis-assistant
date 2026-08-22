import type { JarvisApi } from "../shared/types.js";

declare global {
  interface Window {
    jarvis: JarvisApi;
  }
}

export {};
