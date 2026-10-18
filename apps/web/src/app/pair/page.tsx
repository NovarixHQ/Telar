import { PairClient } from "./pair-client";

/**
 * The pairing landing page — never gated (a caller here is by definition not
 * yet paired). The token rides the URL FRAGMENT, which never reaches this
 * server; all the work happens client-side in PairClient.
 */
export default function PairPage() {
  return <PairClient />;
}
