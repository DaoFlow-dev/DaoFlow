import { runRealInfraPreflight } from "./preflight";

export default async function globalSetup() {
  await runRealInfraPreflight();
}
