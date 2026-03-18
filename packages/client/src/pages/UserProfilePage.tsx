import { useState } from "react";
import { useSession } from "@/lib/auth-client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { User, Mail, Lock, Shield, Key, Clock, Save } from "lucide-react";

export default function UserProfilePage() {
  const session = useSession();
  const user = session.data?.user;

  const [displayName, setDisplayName] = useState(user?.name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const hasProfileChanges = displayName !== (user?.name ?? "") || email !== (user?.email ?? "");
  const hasPasswordFields = currentPassword && newPassword && confirmPassword;
  const passwordsMatch = newPassword === confirmPassword;

  if (!user) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        Loading user profile...
      </div>
    );
  }

  return (
    <main className="shell space-y-6 max-w-2xl">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Profile Settings</h1>
        <p className="text-muted-foreground text-sm">
          Manage your account settings and preferences.
        </p>
      </div>

      {/* Profile Info */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <User size={16} />
            Profile Information
          </CardTitle>
          <CardDescription>Update your display name and email address.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="text-sm font-medium mb-1.5 block">Display Name</label>
            <input
              type="text"
              className="w-full rounded-md border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Your display name"
            />
          </div>
          <div>
            <label className="text-sm font-medium mb-1.5 block flex items-center gap-1.5">
              <Mail size={14} />
              Email Address
            </label>
            <input
              type="email"
              className="w-full rounded-md border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </div>
          {hasProfileChanges && (
            <div className="flex justify-end">
              <Button size="sm">
                <Save size={14} className="mr-1" />
                Save Profile
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Change Password */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Lock size={16} />
            Change Password
          </CardTitle>
          <CardDescription>Update your password to keep your account secure.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="text-sm font-medium mb-1.5 block">Current Password</label>
            <input
              type="password"
              className="w-full rounded-md border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="••••••••"
            />
          </div>
          <div>
            <label className="text-sm font-medium mb-1.5 block">New Password</label>
            <input
              type="password"
              className="w-full rounded-md border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="••••••••"
            />
          </div>
          <div>
            <label className="text-sm font-medium mb-1.5 block">Confirm New Password</label>
            <input
              type="password"
              className="w-full rounded-md border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="••••••••"
            />
            {confirmPassword && !passwordsMatch && (
              <p className="text-xs text-destructive mt-1">Passwords do not match.</p>
            )}
          </div>
          {hasPasswordFields && (
            <div className="flex justify-end">
              <Button size="sm" disabled={!passwordsMatch}>
                <Lock size={14} className="mr-1" />
                Update Password
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Security */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Shield size={16} />
            Security
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <p className="text-sm font-medium">Two-Factor Authentication</p>
              <p className="text-xs text-muted-foreground">
                Add an extra layer of security to your account.
              </p>
            </div>
            <Badge variant="secondary">Not configured</Badge>
          </div>
        </CardContent>
      </Card>

      {/* API Tokens */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Key size={16} />
              API Tokens
            </CardTitle>
            <CardDescription>Manage personal access tokens for the CLI and API.</CardDescription>
          </div>
          <Button size="sm" variant="outline">
            <Key size={14} className="mr-1" />
            Generate Token
          </Button>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center py-6 text-muted-foreground text-sm">
            No tokens generated yet.
          </div>
        </CardContent>
      </Card>

      {/* Account Info (read-only) */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Clock size={16} />
            Account Information
          </CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <dt className="text-muted-foreground">User ID</dt>
              <dd className="font-mono text-xs mt-0.5">{user.id}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Role</dt>
              <dd className="mt-0.5">
                <Badge variant="outline">{(user as { role?: string }).role ?? "user"}</Badge>
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>
    </main>
  );
}
