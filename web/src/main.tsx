import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import "./theme.css";
import { startDesignRuntime } from "./design/look.js";

startDesignRuntime();

// ?design-gallery shows the live design-system gallery instead of the app (no pairing needed).
const galleryRequested = new URLSearchParams(window.location.search).has("design-gallery");
const DesignGallery = lazy(async () => ({ default: (await import("./design/Gallery.js")).DesignGallery }));

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {galleryRequested ? <Suspense fallback={null}><DesignGallery /></Suspense> : <App />}
  </StrictMode>
);
