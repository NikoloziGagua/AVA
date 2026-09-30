import type { RequestHandler } from "express";

/**
 * Keep unknown API requests out of Express's HTML 404 path. The web client can
 * then distinguish a missing/stale backend route from malformed JSON or a
 * normal empty Explorer result without attempting to parse an HTML error page.
 */
export function apiNotFound(): RequestHandler {
  return (_req, res) => {
    res.status(404).json({
      error: "api_route_not_found",
      message: "The running AVA server does not provide this API route.",
      action:
        "If AVA's interface was just updated, rebuild and restart the AVA Desktop Runtime so the server matches it.",
      retryable: false,
    });
  };
}

