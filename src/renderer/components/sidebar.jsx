import { NavLink } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const navItems = [
  { to: "/dashboard", label: "Dashboard", icon: "▦" },
  { to: "/workspace/1", label: "Workspace 1", icon: "◈" },
  { to: "/workspace/2", label: "Workspace 2", icon: "◈" },
  { to: "/settings", label: "Settings", icon: "⚙" },
];

export function Sidebar() {
  return (
    <aside className="flex h-full w-56 flex-col border-r bg-sidebar-background">
      <div className="flex h-14 items-center border-b px-4">
        <span className="text-lg font-bold">Covibe</span>
      </div>
      <nav className="flex-1 space-y-1 p-2">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )
            }
          >
            <span>{item.icon}</span>
            {item.label}
          </NavLink>
        ))}
      </nav>
      <div className="border-t p-2">
        <Button variant="ghost" className="w-full justify-start text-xs text-muted-foreground">
          ⌘K Commands
        </Button>
      </div>
    </aside>
  );
}
