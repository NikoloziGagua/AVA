// Network resilience for dual-stack / IPv6-only networks (imported FIRST in
// index.ts so it runs before any OpenAI/realtime connection is made).
//
// On some networks one address family is dead — e.g. an iPhone Personal Hotspot
// is IPv6-only via NAT64, where native IPv4 connects hang ~15–42s before timing
// out. Without happy-eyeballs, every OpenAI HTTP call and the realtime WS tries
// the dead family first and stalls, making the whole agent feel broken.
//
// Enabling autoSelectFamily makes Node race IPv4 + IPv6 and use whichever
// connects first (RFC 8305), abandoning a hung family after a short attempt
// window. This is safe on every network — when both families work it just uses
// the faster one.
import net from "node:net";

const n = net as unknown as {
  setDefaultAutoSelectFamily?: (value: boolean) => void;
  setDefaultAutoSelectFamilyAttemptTimeout?: (ms: number) => void;
};

n.setDefaultAutoSelectFamily?.(true);
n.setDefaultAutoSelectFamilyAttemptTimeout?.(500);
