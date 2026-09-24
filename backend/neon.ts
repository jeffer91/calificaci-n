import { defineConfig } from "@neon/config/v1";

export default defineConfig({
  aiGateway: true,
  functions: {
    survey: {
      name: "Encuesta de satisfacción",
      source: "./functions/survey.ts"
    }
  }
});