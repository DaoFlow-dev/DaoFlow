import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Home, SearchX } from "lucide-react";

export default function NotFoundPage() {
  return (
    <main className="shell flex min-h-[60vh] items-center justify-center">
      <Card className="w-full max-w-md text-center">
        <CardHeader className="space-y-2 pb-4">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-muted">
            <SearchX size={32} className="text-muted-foreground" />
          </div>
          <CardTitle className="text-5xl font-extrabold text-muted-foreground/60">404</CardTitle>
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
