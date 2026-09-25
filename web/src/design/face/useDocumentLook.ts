import { useEffect, useState } from "react";
import type { Look } from "../look.js";

function currentLook(): Look {
  if (typeof document === "undefined") return "ink";
  return document.documentElement.dataset.look === "paper" ? "paper" : "ink";
}

/** The look actually applied to <html data-look>, following every change. */
export function useDocumentLook(): Look {
  const [look, setLook] = useState<Look>(currentLook);
  useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() => setLook(currentLook()));
    observer.observe(root, { attributes: true, attributeFilter: ["data-look"] });
    setLook(currentLook());
    return () => observer.disconnect();
  }, []);
  return look;
}
