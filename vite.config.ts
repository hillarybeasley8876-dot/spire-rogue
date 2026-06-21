import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

declare const process: { env: { GITHUB_REPOSITORY?: string } };

const repositoryName = process.env.GITHUB_REPOSITORY?.split("/")[1];

export default defineConfig({
  base: repositoryName ? `/${repositoryName}/` : "/",
  plugins: [react()],
});
