import { defineConfig } from "@neon/config/v1";

export default defineConfig({
  aiGateway: true,
  functions: {
    survey: {
      name: "Encuesta de satisfacción",
      source: "./functions/survey.ts",
      env: {
        ADMIN_KEY: process.env.ADMIN_KEY ?? "",
        HASH_PEPPER: process.env.HASH_PEPPER ?? ""
      }
    }
  }
});
