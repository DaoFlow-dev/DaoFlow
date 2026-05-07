import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SignInTab } from "@/components/auth/SignInTab";
import { SignUpTab } from "@/components/auth/SignUpTab";

type LoginTab = "sign-in" | "sign-up";

function isLoginTab(value: unknown): value is LoginTab {
  return value === "sign-in" || value === "sign-up";
}

export function LoginFormTabs({
  onAuthenticated
}: {
  onAuthenticated: () => Promise<void> | void;
}) {
  const [activeTab, setActiveTab] = useState<LoginTab>("sign-in");

  return (
    <Tabs
      value={activeTab}
      onValueChange={(value) => {
        if (isLoginTab(value)) {
          setActiveTab(value);
        }
      }}
    >
      <TabsList className="grid w-full grid-cols-2">
        <TabsTrigger value="sign-in" data-testid="login-tab-sign-in">
          Sign in
        </TabsTrigger>
        <TabsTrigger value="sign-up" data-testid="login-tab-sign-up">
          Sign up
        </TabsTrigger>
      </TabsList>

      <TabsContent value="sign-in">
        <SignInTab onAuthenticated={onAuthenticated} />
      </TabsContent>

      <TabsContent value="sign-up">
        <SignUpTab onAuthenticated={onAuthenticated} />
      </TabsContent>
    </Tabs>
  );
}
