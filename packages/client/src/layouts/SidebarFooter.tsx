import { useNavigate } from "react-router-dom";
import { useTheme } from "../components/theme-context";
import { authClient } from "../lib/auth-client";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { LogOut, User, ChevronsUpDown, Sun, Moon } from "lucide-react";

export function SidebarFooter({
  collapsed,
  userName,
  userEmail
}: {
  collapsed: boolean;
  userName: string;
  userEmail: string;
}) {
  const navigate = useNavigate();
  const themeCtx = useTheme();
  const userInitial = userName?.charAt(0).toUpperCase() ?? "U";

  return (
    <TooltipProvider delay={0}>
      <div className="sidebar__footer">
        {(() => {
          const btn = (
            <button
              className="sidebar__link"
              onClick={() => {
                const { resolved, setTheme } = themeCtx;
                setTheme(resolved === "dark" ? "light" : "dark");
              }}
            >
              {themeCtx.resolved === "dark" ? (
                <Sun size={18} className="sidebar__link-icon" />
              ) : (
                <Moon size={18} className="sidebar__link-icon" />
              )}
              {!collapsed && (
                <span>{themeCtx.resolved === "dark" ? "Light mode" : "Dark mode"}</span>
              )}
            </button>
          );
          return collapsed ? (
            <Tooltip>
              <TooltipTrigger render={btn} />
              <TooltipContent side="right">Toggle theme</TooltipContent>
            </Tooltip>
          ) : (
            btn
          );
        })()}
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button className="sidebar__user-card group">
                <Avatar className="h-8 w-8 ring-2 ring-transparent transition-all group-hover:ring-primary/20">
                  <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">
                    {userInitial}
                  </AvatarFallback>
                </Avatar>
                {!collapsed && (
                  <>
                    <div className="sidebar__user-info">
                      <p className="sidebar__user-name">{userName}</p>
                      <p className="sidebar__user-email">{userEmail}</p>
                    </div>
                    <ChevronsUpDown size={14} className="ml-auto opacity-50" />
                  </>
                )}
              </button>
            }
          />
          <DropdownMenuContent side="top" className="w-56 backdrop-blur-xl" align="start">
            <DropdownMenuLabel>
              <p className="font-medium">{userName}</p>
              <p className="text-xs text-muted-foreground">{userEmail}</p>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => void navigate("/profile")}>
              <User size={14} />
              Profile Settings
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => void authClient.signOut()}
              className="text-destructive"
            >
              <LogOut size={14} />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </TooltipProvider>
  );
}
