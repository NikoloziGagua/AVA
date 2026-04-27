import treeKill from "tree-kill";

export function killTree(pid: number, signal: string = "SIGKILL"): Promise<boolean> {
  return new Promise((resolve) => {
    treeKill(pid, signal, (err) => {
      if (err) resolve(false);
      else resolve(true);
    });
  });
}
