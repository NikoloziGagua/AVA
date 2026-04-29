import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { readMemoryView } from "../memory/file-view.js";
import { editLine, deleteLine, appendLineTo } from "../memory/edit-lines.js";

const PatchBody = z.object({
  file: z.enum(["preferences", "observations"]),
  oldLine: z.string().min(1),
  newLine: z.string().optional(),
});

const PostBody = z.object({
  file: z.literal("preferences"),
  line: z.string().min(1).max(2000),
});

export type MemoryRoutesDeps = { memoryDir: string };

export function memoryRoutes(auth: RequestHandler, deps: MemoryRoutesDeps): Router {
  const r = Router();

  r.get("/", auth, (_req, res) => {
    res.json(readMemoryView(deps.memoryDir));
  });

  r.patch("/lines", auth, (req, res) => {
    const parsed = PatchBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "bad_request" });
      return;
    }
    const { file, oldLine, newLine } = parsed.data;
    if (typeof newLine === "string" && newLine.length > 0) {
      const r1 = editLine({ memoryDir: deps.memoryDir, file, oldLine, newLine });
      if (r1.kind === "stale") {
        res.status(409).json({ error: "stale_line", current: r1.current });
        return;
      }
      res.json({ line: newLine });
      return;
    }
    const r2 = deleteLine({ memoryDir: deps.memoryDir, file, oldLine });
    if (r2.kind === "stale") {
      res.status(409).json({ error: "stale_line", current: r2.current });
      return;
    }
    res.json({ deleted: true });
  });

  r.post("/lines", auth, (req, res) => {
    const parsed = PostBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "bad_request" });
      return;
    }
    appendLineTo({
      memoryDir: deps.memoryDir, file: "preferences", line: parsed.data.line,
    });
    res.json({ line: parsed.data.line });
  });

  return r;
}
