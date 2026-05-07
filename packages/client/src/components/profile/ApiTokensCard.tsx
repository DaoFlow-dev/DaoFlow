import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Key } from "lucide-react";

interface ApiTokensCardProps {
  onOpenTokens: () => void;
}

export function ApiTokensCard({ onOpenTokens }: ApiTokensCardProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <div>
          <CardTitle className="text-base flex items-center gap-2">
            <Key size={16} />
            API Tokens
          </CardTitle>
          <CardDescription>Scoped tokens for CLI automation and agent access.</CardDescription>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          data-testid="profile-open-tokens"
          onClick={onOpenTokens}
        >
          <Key size={14} className="mr-1" />
          Open Tokens
        </Button>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          Create tokens with the CLI, then review active credentials in token settings.
        </p>
      </CardContent>
    </Card>
  );
}
