import { NextRequest, NextResponse } from "next/server";
import { db, pool } from "@/db";
import { tasks } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const taskId = parseInt(id, 10);
  if (isNaN(taskId)) return NextResponse.json({ error: "Invalid ID" }, { status: 400 });

  // Toggle completed
  const existing = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.userId, session.user.id)))
    .limit(1);

  if (existing.length === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const [updated] = await db
    .update(tasks)
    .set({ completed: !existing[0].completed })
    .where(eq(tasks.id, taskId))
    .returning();

  return NextResponse.json(updated);
}
