/// <reference types="vite/client" />

// Only VITE_-prefixed variables reach client code. Everything declared here is
// readable by anyone who opens the shipped bundle.
interface ImportMetaEnv {
  readonly VITE_GEMINI_API_KEY: string | undefined;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module "*.json" {
  const value: any;
  export default value;
}
