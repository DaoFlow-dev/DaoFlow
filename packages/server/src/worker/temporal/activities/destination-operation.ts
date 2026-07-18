import { eq } from "drizzle-orm";
import { db } from "../../../db/connection";
import { volumes } from "../../../db/schema/storage";
import { resolveTeamScopedDestinationForVolume } from "../../../db/services/backup-resource-team";
import { toDestinationConfig } from "../../../db/services/destination-shared";
import type { DestinationConfig } from "../../rclone-executor";

/**
 * Loads and decrypts destination credentials only within an activity that is
 * about to invoke a destination operation. Do not call this from a workflow
 * or a policy/context resolution activity: its result contains secrets.
 */
export async function decryptDestinationForVolumeOperation(input: {
  volumeId: string;
  destinationId: string;
}): Promise<DestinationConfig> {
  const [volume] = await db.select().from(volumes).where(eq(volumes.id, input.volumeId)).limit(1);
  if (!volume) {
    throw new Error("Backup volume is no longer available.");
  }

  const destinationScope = await resolveTeamScopedDestinationForVolume(volume, input.destinationId);
  if (!destinationScope) {
    throw new Error("Backup destination is no longer available for this volume's team.");
  }

  return toDestinationConfig(destinationScope.destination);
}
