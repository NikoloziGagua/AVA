import { Router, type RequestHandler } from "express";
import { listPeople } from "../apps/people.js";

/** Read surface for the people map — powers the People panel in the UI. */
export function peopleRoutes(auth: RequestHandler, deps: { memoryDir: string }): Router {
  const r = Router();
  r.get("/", auth, (_req, res) => {
    res.json({ people: listPeople(deps.memoryDir) });
  });
  return r;
}
