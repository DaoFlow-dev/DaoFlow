import { useState } from "react";
import { MailPlus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { getInventoryBadgeVariant } from "@/lib/tone-utils";
import { UserInviteDialog, type InviteRequestStatus, type InviteRole } from "./UserInviteDialog";

interface Principal {
  id: string;
  name: string;
  email?: string | null;
  type: string;
  accessRole: string;
  status: string;
  createdAt: string;
}

interface PendingInvite {
  id: string;
  email: string;
  role: string;
  invitedByEmail: string;
  expiresAt: string;
}

interface UsersSettingsTabProps {
  isAdmin: boolean;
  isLoading: boolean;
  principals: Principal[];
  invites: PendingInvite[];
  inviteStatus: InviteRequestStatus;
  feedback: string | null;
  onInvite: (input: { email: string; role: InviteRole }) => void;
}

function formatAccessRole(type: string, accessRole: string) {
  if (type === "service") {
    return "service";
  }

  return accessRole;
}

export function UsersSettingsTab({
  isAdmin,
  isLoading,
  principals,
  invites,
  inviteStatus,
  feedback,
  onInvite
}: UsersSettingsTabProps) {
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <div className="mt-4 space-y-4">
      <Card data-testid="settings-users-access">
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2">
              <CardTitle className="text-base">Users & Principals</CardTitle>
              {!isAdmin ? <Badge variant="secondary">Admin only</Badge> : null}
            </div>
            {isAdmin ? (
              <Button data-testid="users-invite-trigger" onClick={() => setDialogOpen(true)}>
                <MailPlus size={14} className="mr-1" />
                Invite User
              </Button>
            ) : null}
          </div>
          <CardDescription>
            Invite teammates, review current access, and create automation identities from the
            Agents page.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {feedback ? (
            <p className="text-sm text-muted-foreground" data-testid="users-feedback">
              {feedback}
            </p>
          ) : null}

          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : (
            <>
              <section className="space-y-3" aria-label="Current access">
                <div>
                  <h3 className="text-sm font-medium" data-testid="users-access-title">
                    Current access
                  </h3>
                  <p
                    className="text-sm text-muted-foreground"
                    data-testid="users-access-description"
                  >
                    People on the team plus service and agent principals.
                  </p>
                </div>

                {principals.length === 0 ? (
                  <p
                    className="py-4 text-center text-sm text-muted-foreground"
                    data-testid="users-access-empty"
                  >
                    No users or principals registered yet.
                  </p>
                ) : (
                  <Table data-testid="users-access-table">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Role</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Created</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {principals.map((principal) => (
                        <TableRow
                          key={principal.id}
                          data-testid={`users-access-row-${principal.id}`}
                        >
                          <TableCell
                            className="font-medium"
                            data-testid={`users-access-name-${principal.id}`}
                          >
                            <div>{principal.name}</div>
                            {principal.email ? (
                              <div className="text-xs font-normal text-muted-foreground">
                                {principal.email}
                              </div>
                            ) : null}
                          </TableCell>
                          <TableCell>
                            <Badge variant={principal.type === "agent" ? "outline" : "secondary"}>
                              {principal.type}
                            </Badge>
                          </TableCell>
                          <TableCell data-testid={`users-access-role-${principal.id}`}>
                            {formatAccessRole(principal.type, principal.accessRole)}
                          </TableCell>
                          <TableCell>
                            <Badge variant={getInventoryBadgeVariant(principal.status)}>
                              {principal.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {new Date(principal.createdAt).toLocaleDateString()}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </section>

              <section className="space-y-3" aria-label="Pending invites">
                <div>
                  <h3 className="text-sm font-medium" data-testid="users-invites-title">
                    Pending invites
                  </h3>
                  <p
                    className="text-sm text-muted-foreground"
                    data-testid="users-invites-description"
                  >
                    Invited people can sign up with the same email address before the invite
                    expires.
                  </p>
                </div>

                {invites.length === 0 ? (
                  <p
                    className="py-4 text-center text-sm text-muted-foreground"
                    data-testid="users-invites-empty"
                  >
                    No pending invites.
                  </p>
                ) : (
                  <Table data-testid="users-invites-table">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Email</TableHead>
                        <TableHead>Role</TableHead>
                        <TableHead>Invited By</TableHead>
                        <TableHead>Expires</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {invites.map((invite) => (
                        <TableRow key={invite.id} data-testid={`users-invite-row-${invite.id}`}>
                          <TableCell className="font-medium">{invite.email}</TableCell>
                          <TableCell>{invite.role}</TableCell>
                          <TableCell className="text-muted-foreground">
                            {invite.invitedByEmail}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {new Date(invite.expiresAt).toLocaleDateString()}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </section>
            </>
          )}
        </CardContent>
      </Card>

      <UserInviteDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        status={inviteStatus}
        feedback={feedback}
        onInvite={onInvite}
      />
    </div>
  );
}
