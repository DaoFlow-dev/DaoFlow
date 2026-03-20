import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Home, SearchX } from "lucide-react";

export default function NotFoundPage() {
  return (
    <main className="shell flex min-h-[60vh] items-center justify-center">
      <Card className="w-full max-w-md text-center">
        <CardHeader className="space-y-2 pb-4">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/10 to-primary/5">
            <SearchX size={32} className="text-primary/50" />
          </div>
          <CardTitle className="text-5xl font-extrabold tracking-tighter text-muted-foreground/40">
            404
          </CardTitle>
          <CardDescription className="text-base">
            This page doesn&apos;t exist or has been moved.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link to="/">
            <Button size="lg">
              <Home size={16} className="mr-2" />
              Back to Dashboard
            </Button>
          </Link>
        </CardContent>
      </Card>
    </main>
  );
}
