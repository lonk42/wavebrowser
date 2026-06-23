import ColorGate from "@/components/ColorGate";
import { gateConfig } from "@/lib/gate";

// Server component: reads the gate message from env and hands it to the client
// picker. The correct color is deliberately NOT passed — validation is
// server-side via /api/gate, so the answer never ships to the browser.
export const dynamic = "force-dynamic";

export default function GatePage() {
  const { message } = gateConfig();
  return <ColorGate message={message} />;
}
