import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";

const inviteRoleOptions = [
  { value: "admin", label: "Admin" },
  { value: "operator", label: "Operator" },
  { value: "developer", label: "Developer" },
  { value: "viewer", label: "Viewer" }
] as const;

export type InviteRole = "admin" | "operator" | "developer" | "viewer";
export type InviteRequestStatus = "idle" | "pending" | "success" | "error";

interface UserInviteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  status: InviteRequestStatus;
  feedback: string | null;
  onInvite: (input: { email: string; role: InviteRole }) => void;
}

export function UserInviteDialog({
  open,
  onOpenChange,
  status,
  feedback,
  onInvite
}: UserInviteDialogProps) {
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<InviteRole>("viewer");
  const [localFeedback, setLocalFeedback] = useState<string | null>(null);
  const previousInvitePending = useRef(false);
  const isPending = status === "pending";
  const inviteError = status === "error" ? feedback : null;

  useEffect(() => {
    if (previousInvitePending.current && status === "success") {
      onOpenChange(false);
      setInviteEmail("");
      setInviteRole("viewer");
      setLocalFeedback(null);
    }
    previousInvitePending.current = isPending;
  }, [isPending, onOpenChange, status]);

  function submitInvite() {
    const email = inviteEmail.trim();
    if (!email) {
      setLocalFeedback("Email is required.");
      return;
    }

    setLocalFeedback(null);
    onInvite({
      email,
      role: inviteRole
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Invite user</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-1.5">
            <Label htmlFor="users-invite-email">Email</Label>
            <Input
              id="users-invite-email"
              type="email"
              value={inviteEmail}
              onChange={(event) => setInviteEmail(event.target.value)}
              data-testid="users-invite-email"
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="users-invite-role">Role</Label>
            <Select
              value={inviteRole}
              onValueChange={(value) => setInviteRole(value as InviteRole)}
            >
              <SelectTrigger id="users-invite-role" data-testid="users-invite-role-select">
                <SelectValue placeholder="Select role" />
              </SelectTrigger>
              <SelectContent>
                {inviteRoleOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {localFeedback ? (
            <p className="text-sm text-muted-foreground" data-testid="users-invite-local-feedback">
              {localFeedback}
            </p>
          ) : inviteError ? (
            <p className="text-sm text-muted-foreground" data-testid="users-invite-error-feedback">
              {inviteError}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={submitInvite}
            disabled={isPending}
            data-testid="users-invite-submit"
          >
            {isPending ? "Sending…" : "Send Invite"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
