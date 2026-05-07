import { listManagedSshKeys } from "../db/services/access-assets";
import { listCertificateAssets } from "../db/services/certificate-assets";
import { serverReadProcedure, t } from "../trpc";
import { requireActorTeamId } from "./command-admin-shared";

export const accessAssetsReadRouter = t.router({
  managedSshKeys: serverReadProcedure.query(async ({ ctx }) => {
    const teamId = await requireActorTeamId(ctx.session.user.id);
    return listManagedSshKeys(teamId);
  }),

  certificateAssets: serverReadProcedure.query(async ({ ctx }) => {
    const teamId = await requireActorTeamId(ctx.session.user.id);
    return listCertificateAssets(teamId);
  })
});
