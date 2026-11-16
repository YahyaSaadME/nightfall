import { defineConfig } from "cf/config";

// NIGHTFALL is a static Vite build (dist/), served by an assets-only Worker.
export default defineConfig({
	worker: {
		name: "nightfall",
		compatibilityDate: "2026-09-01",
		assets: {
			notFoundHandling: "single-page-application",
		},
	},
});
